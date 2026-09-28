/**
 * Bot Event Processor - engine event handling and supervision sweeps
 *
 * Consumes engine events (COMMAND_ACCEPTED / COMMAND_FAILED /
 * STATE_CHANGED) and applies them to the persisted lifecycle state:
 * - validates transitions against the shared state machine,
 * - rejects stale generations (events whose correlationId refers to a
 *   TIMED_OUT/FAILED command or a different bot),
 * - rejects events from a non-authoritative engine id.
 *
 * Also owns the supervision sweeps: command-timeout processing and
 * marking bots UNKNOWN when an engine's heartbeat is lost.
 *
 * @format
 */

import {
  BotActualState,
  BotEvent,
  assertTransition,
  canTransition,
} from "@trade-bot/shared";
import { contextLogger as logger } from "../../logging";
import { BotLifecycleRepository } from "./bot-lifecycle.repository";
import { BotLifecycleNotifier } from "./bot-lifecycle-notifier";
import { syncStrategyActive } from "./strategy-active-sync";
import {
  BOT_COMMAND_TIMEOUT_MS,
  getTimeoutReason,
  getTimeoutTargetState,
  TimeoutReason,
} from "./types";

/**
 * Actual states from which a bot must NOT be trading. A healthy engine that
 * still lists such a bot in its heartbeat inventory is unsafe drift (the
 * authority has already concluded the bot is not running), not a
 * mid-transition race like RUNNING/STARTING/STOPPING (L24).
 */
export const TERMINAL_ACTUAL_STATES: ReadonlySet<BotActualState> = new Set([
  "ERROR",
  "STOPPED",
  "UNKNOWN",
]);

/** True when a bot in this actual state must not be trading on the engine. */
export function isTerminalActualState(state: BotActualState): boolean {
  return TERMINAL_ACTUAL_STATES.has(state);
}

export type EngineLifecycleEventHandler = (event: BotEvent) => Promise<boolean>;
/** Validates that (engineId, epoch) is the authoritative engine process. */
export type EngineAuthorityChecker = (
  engineId: string,
  epoch?: number
) => Promise<boolean>;
/**
 * Repairs a bot whose engine-side runner must be torn down because the
 * authority has declared the bot terminal (ERROR/STOPPED/UNKNOWN) while the
 * engine still reports it active (L24). Resolves true when a stop was actually
 * dispatched (false when the repair was skipped, refused or failed).
 */
export type TerminalBotStopRepair = (
  botId: string,
  reason: string
) => Promise<boolean>;

export class BotEventProcessor {
  private engineLifecycleHandler: EngineLifecycleEventHandler | null = null;
  /** Fail-closed authority check - must be wired for runtime events to apply. */
  private authorityChecker: EngineAuthorityChecker | null = null;
  /** Terminal-state stop repair - wired to BotLifecycleService (L24). */
  private terminalBotStopRepair: TerminalBotStopRepair | null = null;

  constructor(
    private repository: BotLifecycleRepository,
    private notifier: BotLifecycleNotifier
  ) {}

  /** Injected to avoid a circular dependency with EngineRegistryService. */
  setEngineLifecycleHandler(handler: EngineLifecycleEventHandler): void {
    this.engineLifecycleHandler = handler;
  }

  /**
   * Inject the engine-authority checker (EngineRegistryService). Without a
   * wired checker no runtime event is trusted: fail closed.
   */
  setAuthorityChecker(checker: EngineAuthorityChecker): void {
    this.authorityChecker = checker;
  }

  /**
   * Inject the terminal-state stop repair (BotLifecycleService), injected to
   * avoid a circular dependency. Without it a sweep can only log that the
   * engine may still be trading - it cannot stop the runner (L24).
   */
  setTerminalBotStopRepair(repair: TerminalBotStopRepair): void {
    this.terminalBotStopRepair = repair;
  }

  /**
   * Ask the engine to tear down the runner of a bot the authority has already
   * declared terminal. Best-effort: a failure is logged, never thrown, so a
   * supervision sweep is not aborted by an unreachable engine.
   */
  private async repairTerminalBotStop(
    botId: string,
    reason: string
  ): Promise<boolean> {
    if (!this.terminalBotStopRepair) {
      logger.warn(
        "Terminal-state stop repair not wired - engine runner may still be trading",
        { botId, reason }
      );
      return false;
    }
    try {
      return await this.terminalBotStopRepair(botId, reason);
    } catch (error) {
      logger.error("Terminal-state stop repair failed", undefined, {
        botId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Fail-closed authority gate for runtime (bot lifecycle) events: an epoch
   * must be present and the (engineId, epoch) pair must pass the registry
   * check. DB failures inside the checker THROW (the message stays unacked for
   * redelivery); unproven authority returns false (the event is stale/dropped
   * and the message is acked).
   *
   * A rejected runtime event is logged at error level with its command context:
   * dropping it is not a no-op - it leaves the tracked command PENDING until
   * the timeout sweep burns the bot to ERROR. L21: an epoch type skew silently
   * rejected every accept/fail/state-change event, so a healthy engine that had
   * answered and was actively trading was reported as ENGINE_NO_RESPONSE.
   */
  private async isAuthoritativeRuntimeEvent(
    event: BotEvent,
    payload: {
      botId?: string;
      commandType?: string;
      engineId?: unknown;
      engineEpoch?: unknown;
    }
  ): Promise<boolean> {
    const engineId = payload.engineId;
    const engineEpoch = payload.engineEpoch;

    if (!this.authorityChecker) {
      logger.error(
        "No engine authority checker wired - rejecting runtime event",
        undefined,
        { eventType: event.type, correlationId: event.correlationId, engineId }
      );
      return false;
    }
    if (typeof engineId !== "string" || engineId === "") {
      logger.error("Runtime event without engineId - rejecting", undefined, {
        eventType: event.type,
        correlationId: event.correlationId,
      });
      return false;
    }
    if (typeof engineEpoch !== "number") {
      logger.error("Runtime event without engineEpoch - rejecting", undefined, {
        eventType: event.type,
        correlationId: event.correlationId,
        engineId,
      });
      return false;
    }
    if (await this.authorityChecker(engineId, engineEpoch)) {
      return true;
    }

    logger.error(
      "Runtime event rejected (engine not authoritative) - tracked command will time out",
      undefined,
      {
        eventType: event.type,
        correlationId: event.correlationId,
        botId: payload.botId,
        commandType: payload.commandType,
        engineId,
        engineEpoch,
      }
    );
    return false;
  }

  /**
   * Process one event from the engine. Business-level issues (unknown bot,
   * duplicate event, illegal transition report, stale generation) are
   * logged and swallowed so the message is acked; only unexpected
   * persistence failures throw, which leaves the message unacked for
   * redelivery.
   */
  async handleEngineEvent(event: BotEvent): Promise<void> {
    // Engine registration/heartbeat events go to the registry (if wired).
    if (
      (event.type === "ENGINE_REGISTER" || event.type === "ENGINE_HEARTBEAT") &&
      this.engineLifecycleHandler
    ) {
      const handled = await this.engineLifecycleHandler(event);
      if (handled) {
        return;
      }
    }
    switch (event.type) {
      case "COMMAND_ACCEPTED":
        await this.handleCommandAccepted(event);
        break;
      case "COMMAND_FAILED":
        await this.handleCommandFailed(event);
        break;
      case "STATE_CHANGED":
        await this.handleStateChanged(event);
        break;
      default:
        logger.warn("Unknown bot event type", {
          type: event.type,
          messageId: event.messageId,
        });
    }
  }

  /**
   * Stale-generation check: if the event's correlationId maps to a tracked
   * command that is resolved/timed out or belongs to a different bot, the
   * event is from a superseded lifecycle operation and must be ignored.
   * Untracked correlationIds (legacy commands, status snapshots) pass through.
   */
  private async isStaleGeneration(
    botId: string,
    correlationId: string
  ): Promise<boolean> {
    const tracked = await this.repository.findTrackedCommand(correlationId);
    if (!tracked) {
      return false;
    }
    if (
      tracked.bot_id !== botId ||
      tracked.state === "TIMED_OUT" ||
      tracked.state === "FAILED"
    ) {
      logger.warn("Engine event from stale lifecycle generation - ignoring", {
        botId,
        correlationId,
        trackedBotId: tracked.bot_id,
        trackedState: tracked.state,
      });
      return true;
    }
    return false;
  }

  private async handleCommandAccepted(event: BotEvent): Promise<void> {
    const payload = event.payload as {
      botId: string;
      commandType: string;
      engineId: string;
      engineEpoch?: number;
    };

    if (!(await this.isAuthoritativeRuntimeEvent(event, payload))) {
      return;
    }

    if (await this.isStaleGeneration(payload.botId, event.correlationId)) {
      return;
    }

    logger.info("Command accepted by engine", {
      botId: payload.botId,
      commandType: payload.commandType,
      correlationId: event.correlationId,
      engineId: payload.engineId,
    });
    await this.repository.resolveCommand(event.correlationId, "ACCEPTED");
    await this.repository.recordLifecycleEvent(payload.botId, {
      eventType: `${payload.commandType}_ACCEPTED`,
      fromState: null,
      toState: null,
      correlationId: event.correlationId,
      messageId: event.messageId,
      metadata: { engineId: payload.engineId },
    });
  }

  private async handleCommandFailed(event: BotEvent): Promise<void> {
    const payload = event.payload as {
      botId: string;
      commandType: string;
      engineId: string;
      engineEpoch?: number;
      errorCode: string;
      message: string;
    };
    logger.error("Command failed in engine", undefined, {
      botId: payload.botId,
      commandType: payload.commandType,
      errorCode: payload.errorCode,
      message: payload.message,
      correlationId: event.correlationId,
    });

    if (!(await this.isAuthoritativeRuntimeEvent(event, payload))) {
      return;
    }

    if (await this.isStaleGeneration(payload.botId, event.correlationId)) {
      return;
    }

    const bot = await this.repository.findBot(payload.botId);
    if (!bot) {
      logger.warn("Command failed for unknown bot - ignoring", {
        botId: payload.botId,
      });
      return;
    }

    if (bot.actual_state !== "ERROR") {
      const nextState = assertTransition(bot.actual_state, "ERROR");
      const persisted = await this.repository.persistTransition(
        bot.id,
        {
          desiredState: "STOPPED",
          actualState: nextState,
          errorCode: payload.errorCode,
          errorMessage: payload.message,
        },
        bot.actual_state
      );
      if (!persisted) {
        logger.warn(
          "Command failed processed against stale bot state - skipping",
          {
            botId: bot.id,
            actualState: bot.actual_state,
            correlationId: event.correlationId,
          }
        );
        return;
      }
    }

    // Strategy badge (Phase 2): a failed command lands the bot in ERROR.
    await syncStrategyActive(bot.strategy_id, false);

    await this.repository.resolveCommand(
      event.correlationId,
      "FAILED",
      payload.errorCode,
      payload.message
    );

    await this.repository.recordLifecycleEvent(bot.id, {
      eventType: "COMMAND_FAILED",
      fromState: bot.actual_state,
      toState: "ERROR",
      correlationId: event.correlationId,
      messageId: event.messageId,
      metadata: {
        commandType: payload.commandType,
        errorCode: payload.errorCode,
        message: payload.message,
      },
    });

    this.notifier.emitStateChanged(
      bot.id,
      bot.user_id,
      bot.actual_state,
      "ERROR",
      event.correlationId
    );
  }

  private async handleStateChanged(event: BotEvent): Promise<void> {
    const payload = event.payload as {
      botId: string;
      engineId: string;
      engineEpoch?: number;
      from: BotActualState;
      to: BotActualState;
      reason?: string;
    };

    if (!(await this.isAuthoritativeRuntimeEvent(event, payload))) {
      return;
    }

    const bot = await this.repository.findBot(payload.botId);
    if (!bot) {
      logger.warn("State changed for unknown bot - ignoring", {
        botId: payload.botId,
      });
      return;
    }

    // Duplicate/delayed events: nothing to do.
    if (bot.actual_state === payload.to) {
      logger.debug("State change matches current state - no-op", {
        botId: payload.botId,
        state: payload.to,
      });
      return;
    }

    // Reject events from a superseded engine process (Engine A crashed,
    // Engine B took over, A's delayed event arrives).
    if (
      bot.engine_id &&
      payload.engineId &&
      bot.engine_id !== payload.engineId
    ) {
      logger.warn("State change from non-authoritative engine - ignoring", {
        botId: payload.botId,
        registeredEngineId: bot.engine_id,
        eventEngineId: payload.engineId,
        correlationId: event.correlationId,
      });
      return;
    }

    // Reject stale generations: the correlationId references a timed-out
    // or failed command from a superseded lifecycle operation.
    if (await this.isStaleGeneration(payload.botId, event.correlationId)) {
      return;
    }

    // Never trust illegal engine reports.
    if (!canTransition(bot.actual_state, payload.to)) {
      logger.warn("Engine reported illegal state transition - ignoring", {
        botId: payload.botId,
        from: bot.actual_state,
        to: payload.to,
        correlationId: event.correlationId,
      });
      return;
    }

    const isRunning = payload.to === "RUNNING";
    const isStopped = payload.to === "STOPPED";

    // Compare-and-set against the state we just read: if another actor
    // changed it meanwhile, this event is stale and must not be applied.
    const persisted = await this.repository.persistTransition(
      bot.id,
      {
        desiredState: bot.desired_state,
        actualState: payload.to,
        engineId: payload.engineId,
        startedAt: isRunning ? new Date() : null,
        stoppedAt: isStopped ? new Date() : null,
        errorCode: isRunning || isStopped ? null : undefined,
        errorMessage: isRunning || isStopped ? null : undefined,
      },
      bot.actual_state
    );
    if (!persisted) {
      logger.warn(
        "State changed event processed against stale bot state - skipping",
        {
          botId: bot.id,
          from: bot.actual_state,
          to: payload.to,
          correlationId: event.correlationId,
        }
      );
      return;
    }

    // Strategy badge (Phase 2): keep strategies.active mirroring the bot —
    // RUNNING proves the strategy is executing, STOPPED/ERROR ends it.
    if (payload.to === "RUNNING") {
      await syncStrategyActive(bot.strategy_id, true);
    } else if (payload.to === "STOPPED" || payload.to === "ERROR") {
      await syncStrategyActive(bot.strategy_id, false);
    }

    await this.repository.recordLifecycleEvent(bot.id, {
      eventType: "STATE_CHANGED",
      fromState: bot.actual_state,
      toState: payload.to,
      correlationId: event.correlationId,
      messageId: event.messageId,
      metadata: { engineId: payload.engineId, reason: payload.reason ?? null },
    });

    logger.info("Bot state changed", {
      botId: bot.id,
      from: bot.actual_state,
      to: payload.to,
      correlationId: event.correlationId,
    });

    this.notifier.emitStateChanged(
      bot.id,
      bot.user_id,
      bot.actual_state,
      payload.to,
      event.correlationId
    );
  }

  // ===========================================
  // SUPERVISION SWEEPS
  // ===========================================

  /**
   * Transition all RUNNING bots owned by `engineId` to UNKNOWN (called by
   * EngineRegistryService when an engine's heartbeat times out). UNKNOWN
   * means "engine unreachable, actual state untrusted" - the state machine
   * allows recovery to RUNNING/STOPPED/ERROR once truth is re-established.
   * Also notifies the frontend for each affected bot.
   */
  async markBotsUnknownForEngine(engineId: string): Promise<number> {
    const bots = await this.repository.findRunningBotsForEngine(engineId);

    for (const bot of bots) {
      const persisted = await this.repository.persistTransition(
        bot.id,
        {
          desiredState: bot.desired_state,
          actualState: "UNKNOWN",
          errorCode: "ENGINE_HEARTBEAT_LOST",
          errorMessage: `Engine ${engineId} heartbeat timed out; actual state untrusted`,
        },
        bot.actual_state
      );
      if (persisted) {
        await this.repository.recordLifecycleEvent(bot.id, {
          eventType: "ENGINE_HEARTBEAT_LOST",
          fromState: bot.actual_state,
          toState: "UNKNOWN",
          correlationId: null,
          messageId: null,
          metadata: { engineId },
        });
        this.notifier.emitStateChanged(
          bot.id,
          bot.user_id,
          bot.actual_state,
          "UNKNOWN",
          `engine-offline-${engineId}`
        );
        logger.error(
          "Bot marked UNKNOWN after engine heartbeat loss",
          undefined,
          {
            botId: bot.id,
            engineId,
          }
        );
      }
    }

    return bots.length;
  }

  /**
   * Reconcile a healthy engine's heartbeat inventory (`activeBotIds`)
   * against persisted lifecycle state:
   * - backend says RUNNING (assigned to this engine) but the engine does
   *   not list the bot → the engine is healthy and does NOT run it →
   *   transition the bot to UNKNOWN (drift-safe: not ERROR, because the
   *   engine did not report a failure).
   * - the engine lists a bot the backend does not consider running → drift
   *   warning. When the backend state is terminal (ERROR/STOPPED/UNKNOWN -
   *   i.e. the authority has concluded the bot must not trade) the drift is
   *   also REPAIRED: a bounded BOT_STOP is dispatched so the engine tears down
   *   the runner. Warning alone left the engine trading a bot the backend had
   *   already declared dead (L24).
   */
  async reconcileHeartbeatInventory(
    engineId: string,
    activeBotIds: string[]
  ): Promise<{ unlisted: number; drift: number; stopReissued: number }> {
    const activeSet = new Set(activeBotIds);

    // 1) Backend RUNNING bots missing from the engine's inventory.
    const runningBots =
      await this.repository.findRunningBotsForEngine(engineId);
    let unlisted = 0;
    for (const bot of runningBots) {
      if (activeSet.has(bot.id)) {
        continue;
      }
      const persisted = await this.repository.persistTransition(
        bot.id,
        {
          desiredState: bot.desired_state,
          actualState: "UNKNOWN",
          errorCode: "HEARTBEAT_INVENTORY_DRIFT",
          errorMessage: `Healthy engine ${engineId} does not report running this bot; persisted RUNNING state untrusted`,
        },
        bot.actual_state
      );
      if (persisted) {
        unlisted++;
        await this.repository.recordLifecycleEvent(bot.id, {
          eventType: "HEARTBEAT_RECONCILED",
          fromState: bot.actual_state,
          toState: "UNKNOWN",
          correlationId: null,
          messageId: null,
          metadata: { engineId, activeBotIds },
        });
        this.notifier.emitStateChanged(
          bot.id,
          bot.user_id,
          bot.actual_state,
          "UNKNOWN",
          `heartbeat-reconcile-${engineId}`
        );
        logger.error(
          "Bot marked UNKNOWN via heartbeat inventory reconciliation",
          undefined,
          {
            botId: bot.id,
            engineId,
          }
        );
      }
    }

    // 2) Engine-listed bots the backend does not consider active (drift warning).
    const listed = activeBotIds.filter(id => id !== "");
    const backendBots = await this.repository.findBotsByIds(listed);
    const backendById = new Map(backendBots.map(b => [b.id, b]));
    let drift = 0;
    let stopReissued = 0;
    for (const botId of listed) {
      const backend = backendById.get(botId);
      if (
        !backend ||
        (backend.actual_state !== "RUNNING" &&
          backend.actual_state !== "STARTING" &&
          backend.actual_state !== "STOPPING")
      ) {
        drift++;
        logger.warn(
          "Heartbeat inventory drift: engine reports active bot the backend does not track as running",
          {
            engineId,
            botId,
            backendState: backend?.actual_state ?? "not-found",
          }
        );

        // L24: a terminal backend state is not a mid-transition race - the
        // authority has concluded this bot must not trade, yet the engine still
        // runs it. Stop the engine-side runner (bounded) instead of only
        // warning: a timeout/ERROR must never leave orphaned exposure.
        if (backend && isTerminalActualState(backend.actual_state)) {
          const repaired = await this.repairTerminalBotStop(
            botId,
            "heartbeat-inventory-drift"
          );
          if (repaired) {
            stopReissued++;
            logger.error(
              "Unsafe drift repair: engine stopped for a bot the backend reports terminal",
              undefined,
              {
                engineId,
                botId,
                backendState: backend.actual_state,
              }
            );
          }
        }
      }
    }

    return { unlisted, drift, stopReissued };
  }

  /**
   * Timeout supervision sweep: every PENDING command past its expiry is
   * marked TIMED_OUT and the bot is transitioned to ERROR (the engine
   * never confirmed the operation, so the actual state is unreliable).
   * Returns the number of commands timed out.
   *
   * Called periodically by the CommandTimeoutSweeper; also safe to call
   * manually (e.g. from tests or an admin endpoint).
   */
  async sweepTimedOutCommands(): Promise<number> {
    const pending = await this.repository.findExpiredPendingCommands();
    let timedOut = 0;

    for (const cmd of pending) {
      // Claim the command first so concurrent sweeps cannot double-process.
      const claimed = await this.repository.claimTimedOutCommand(
        cmd.correlation_id
      );
      if (!claimed) {
        continue;
      }
      timedOut++;

      const bot = await this.repository.findBot(cmd.bot_id);
      if (!bot) {
        logger.warn("Timed-out command references unknown bot", {
          botId: cmd.bot_id,
          correlationId: cmd.correlation_id,
        });
        continue;
      }

      // Determine timeout reason and appropriate target state
      const reason = getTimeoutReason(cmd.command_type, bot.actual_state);
      const targetState = getTimeoutTargetState(reason, cmd.command_type);

      // Handle based on bot state and timeout reason
      if (
        bot.actual_state === "STARTING" ||
        bot.actual_state === "STOPPING" ||
        bot.actual_state === "RUNNING"
      ) {
        // Validate the transition is legal
        if (canTransition(bot.actual_state, targetState)) {
          const persisted = await this.repository.persistTransition(
            bot.id,
            {
              desiredState:
                targetState === "UNKNOWN" ? bot.desired_state : "STOPPED",
              actualState: targetState,
              errorCode: `COMMAND_TIMEOUT_${reason}`,
              errorMessage: this.formatTimeoutMessage(cmd, reason),
            },
            bot.actual_state
          );
          if (persisted) {
            // Strategy badge (Phase 2): a timed-out command that lands the
            // bot terminal ends the strategy; UNKNOWN keeps the badge.
            if (targetState === "STOPPED" || targetState === "ERROR") {
              await syncStrategyActive(bot.strategy_id, false);
            }
            this.notifier.emitStateChanged(
              bot.id,
              bot.user_id,
              bot.actual_state,
              targetState,
              cmd.correlation_id
            );

            // L24: the timeout is backend bookkeeping only - the engine may
            // still be running (and filling) this bot. The authority has just
            // declared it terminal, so make the engine tear the runner down
            // instead of leaving orphaned exposure that only a manual stop ends.
            await this.repairTerminalBotStop(
              bot.id,
              `command-timeout:${cmd.command_type}`
            );
          }
        }
      }

      await this.repository.recordLifecycleEvent(bot.id, {
        eventType: "COMMAND_TIMED_OUT",
        fromState: bot.actual_state,
        toState: targetState,
        correlationId: cmd.correlation_id,
        messageId: null,
        metadata: {
          commandType: cmd.command_type,
          timeoutMs: BOT_COMMAND_TIMEOUT_MS,
          timeoutReason: reason,
        },
      });

      logger.error("Lifecycle command timed out", undefined, {
        botId: cmd.bot_id,
        commandType: cmd.command_type,
        fromState: bot.actual_state,
        targetState,
        timeoutReason: reason,
        correlationId: cmd.correlation_id,
      });
    }

    return timedOut;
  }

  private formatTimeoutMessage(
    cmd: { command_type: string },
    reason: TimeoutReason
  ): string {
    const seconds = Math.round(BOT_COMMAND_TIMEOUT_MS / 1000);
    switch (reason) {
      case TimeoutReason.STATE_MISMATCH:
        return `${cmd.command_type} command timed out after ${seconds}s - bot is in unexpected state (likely event loss)`;
      case TimeoutReason.STOP_INCOMPLETE:
        return `${cmd.command_type} command timed out after ${seconds}s - stop operation did not complete`;
      case TimeoutReason.ENGINE_NO_RESPONSE:
        return `${cmd.command_type} command timed out after ${seconds}s - engine received command but never responded`;
      case TimeoutReason.COMMAND_NEVER_DELIVERED:
      default:
        return `${cmd.command_type} command timed out after ${seconds}s - engine never received command`;
    }
  }
}
