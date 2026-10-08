/**
 * Bot Lifecycle Service - desired/actual state machine owner (orchestrator)
 *
 * The ONLY component allowed to mutate bot lifecycle state in PostgreSQL.
 * Validates every transition against the central state machine from
 * `@trade-bot/shared`, persists desired/actual state plus a lifecycle
 * audit trail, sends protocol commands to the engine, and processes
 * engine events (acknowledgements / failures / state changes).
 *
 * The service is pure orchestration; the actual work lives in focused
 * components under `lifecycle/`:
 * - BotLifecycleRepository  - all PostgreSQL persistence (CAS transitions,
 *                             audit trail, command tracking)
 * - BotCommandDispatcher    - command payloads + pending-command tracking
 * - BotLifecycleNotifier    - Socket.IO `bot.stateChanged` bridge
 * - BotEventProcessor       - engine event handling + supervision sweeps
 *
 * API routes must not touch `bot_instances.status` or stream messages
 * directly; they call this service and return 202 Accepted.
 *
 * @format
 */

import {
  assertTransition,
  BotActualState,
  BotEvent,
  EmergencyStopAction,
  InvalidStateTransitionError,
} from "@trade-bot/shared";
import { contextLogger as logger } from "../logging";
import {
  EngineProtocolService,
  engineProtocolService,
} from "./engine-protocol.service";
import { BotCommandDispatcher } from "./lifecycle/bot-command-dispatcher";
import { BotLifecycleNotifier } from "./lifecycle/bot-lifecycle-notifier";
import {
  BotEventProcessor,
  EngineAuthorityChecker,
  EngineLifecycleEventHandler,
  TradeLedgerEventHandler,
  isTerminalActualState,
} from "./lifecycle/bot-event-processor";
import { BotLifecycleRepository } from "./lifecycle/bot-lifecycle.repository";
import { exchangeAccountRepositoryAdapter } from "../../infrastructure/adapters/repositories/exchange-account-repository.adapter";
import { assertSymbolSupported } from "../../infrastructure/external/venue-symbols";
import { query } from "../../database/pool";
import { syncSessionStrategiesActive } from "./lifecycle/strategy-active-sync";
import {
  BotLifecycleResult,
  BotRow,
  BOT_COMMAND_TIMEOUT_MS,
  MAX_STOP_REISSUES_PER_HOUR,
} from "./lifecycle/types";

// Re-exported for existing consumers (timeout sweeper, tests).
export { BOT_COMMAND_TIMEOUT_MS };
export type { BotLifecycleResult };

export class BotLifecycleService {
  private repository = new BotLifecycleRepository();
  private notifier = new BotLifecycleNotifier();
  private dispatcher: BotCommandDispatcher;
  private eventProcessor: BotEventProcessor;

  constructor(engineProtocol: EngineProtocolService) {
    this.dispatcher = new BotCommandDispatcher(engineProtocol, this.repository);
    this.eventProcessor = new BotEventProcessor(this.repository, this.notifier);
    // L24: when a supervision sweep declares a bot terminal (timeout → ERROR/
    // UNKNOWN, heartbeat drift), the engine-side runner must be stopped too -
    // this service owns command dispatch, so the repair is wired back in here.
    this.eventProcessor.setTerminalBotStopRepair((botId, reason) =>
      this.stopEngineRunnerForTerminalBot(botId, reason)
    );
  }

  /** Register the Socket.IO server for frontend `bot.stateChanged` events. */
  setSocketServer(
    io: Parameters<BotLifecycleNotifier["setSocketServer"]>[0]
  ): void {
    this.notifier.setSocketServer(io);
  }

  /**
   * Register the handler for ENGINE_REGISTER / ENGINE_HEARTBEAT events
   * (injected to avoid a circular dependency with EngineRegistryService).
   */
  setEngineLifecycleHandler(handler: EngineLifecycleEventHandler): void {
    this.eventProcessor.setEngineLifecycleHandler(handler);
  }

  /**
   * Register the durable financial-state ingest (Phase 4 / N7):
   * ORDER_INTENT / TRADE_EXECUTED / POSITION_UPDATED / PERFORMANCE_SNAPSHOT
   * (injected to avoid a circular dependency with TradeLedgerService).
   */
  setTradeLedgerHandler(handler: TradeLedgerEventHandler): void {
    this.eventProcessor.setTradeLedgerHandler(handler);
  }

  /**
   * Inject the fail-closed engine-authority checker (EngineRegistryService).
   * Must be wired at startup, otherwise no runtime event is trusted.
   */
  setAuthorityChecker(checker: EngineAuthorityChecker): void {
    this.eventProcessor.setAuthorityChecker(checker);
  }

  // ===========================================
  // START
  // ===========================================

  /**
   * Desired-state transition to RUNNING for an existing bot instance.
   * Idempotent: starting an already STARTING/RUNNING bot is a no-op success.
   */
  async start(botId: string, userId: string): Promise<BotLifecycleResult> {
    const bot = await this.getOwnedBot(botId, userId);

    // Idempotency: already starting or running with the same desired state.
    if (
      bot.desired_state === "RUNNING" &&
      (bot.actual_state === "STARTING" || bot.actual_state === "RUNNING")
    ) {
      logger.info("Start requested but bot already starting/running - no-op", {
        botId,
        actualState: bot.actual_state,
      });
      return { botId, desiredState: "RUNNING", actualState: bot.actual_state };
    }

    // Validate the transition (throws InvalidStateTransitionError on illegal
    // moves, e.g. STOPPING -> STARTING). The error carries no statusCode, so
    // tag it 409 here — otherwise every HTTP caller would surface an illegal
    // transition as a 500. Same convention as the CAS conflict below.
    let nextState: BotActualState;
    try {
      nextState = assertTransition(bot.actual_state, "STARTING");
    } catch (err) {
      if (err instanceof InvalidStateTransitionError) {
        (err as Error & { statusCode?: number }).statusCode = 409;
      }
      throw err;
    }

    // Compare-and-set: only persist if actual_state is still what we read.
    const persisted = await this.repository.persistTransition(
      botId,
      { desiredState: "RUNNING", actualState: nextState },
      bot.actual_state
    );
    if (!persisted) {
      const error = new Error(
        "Bot lifecycle state changed concurrently - retry"
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    await this.repository.recordLifecycleEvent(botId, {
      eventType: "START_REQUESTED",
      fromState: bot.actual_state,
      toState: nextState,
      correlationId: null,
      messageId: null,
      metadata: { userId },
    });

    // Session start (022 shim-drop): the dispatch payload fans the session's
    // attached runs out to N engine runners. The legacy top-level
    // strategyId predates sessions — derive it from the oldest run so the
    // engine's legacy single-run path keeps working; a session with no
    // runs yet carries the empty string and runs `[]`.
    const bootRuns = await this.repository.getRunsForBot(botId);
    const sendResult = await this.dispatcher.sendStartCommand(
      bot.id,
      userId,
      bootRuns[0]?.strategy_id ?? ""
    );
    if (!sendResult.success) {
      // Roll back to STOPPED so the bot is not stuck in STARTING with no command in flight.
      await this.repository.persistTransition(
        botId,
        { desiredState: "STOPPED", actualState: "STOPPED" },
        nextState
      );
      await this.repository.recordLifecycleEvent(botId, {
        eventType: "START_FAILED",
        fromState: nextState,
        toState: "STOPPED",
        correlationId: sendResult.correlationId ?? null,
        messageId: sendResult.messageId ?? null,
        metadata: { reason: sendResult.error ?? "unknown" },
      });
      const error = new Error("Failed to deliver start command to engine");
      (error as Error & { statusCode?: number }).statusCode = 503;
      throw error;
    }

    // Dispatch already tracked the command as PENDING (record-before-publish),
    // so the timeout sweeper can detect an engine that never processes it.
    await this.repository.recordLifecycleEvent(botId, {
      eventType: "START_COMMAND_SENT",
      fromState: nextState,
      toState: nextState,
      correlationId: sendResult.correlationId ?? null,
      messageId: sendResult.messageId ?? null,
      metadata: {},
    });

    // Strategy badge (Phase 2, 022 shim-drop): the session's runs are
    // starting with this bot — badge follows the runs, not the retired
    // `bot_instances.strategy_id` column.
    await syncSessionStrategiesActive(this.repository, botId, true);

    return {
      botId,
      desiredState: "RUNNING",
      actualState: nextState,
      correlationId: sendResult.correlationId,
    };
  }

  // ===========================================
  // CREATE AND START
  // ===========================================

  /**
   * Create a new bot instance for a strategy and start it.
   * The instance is created in actual STOPPED, then transitioned to STARTING.
   *
   * C3a: the caller supplies the ACTIVE venue account the bot trades on.
   * Ownership + ACTIVE status are validated here (defence in depth — the
   * route also checks) so a bot can never be created unbound or against
   * another user's / unverified account.
   */
  async createAndStart(
    userId: string,
    strategyId: string,
    notionalAmount: number,
    exchangeAccountId: string
  ): Promise<BotLifecycleResult> {
    // Strategy must exist and belong to the user.
    const strategyExists = await this.repository.strategyExistsForUser(
      strategyId,
      userId
    );
    if (!strategyExists) {
      const error = new Error("Strategy not found");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    // Account must exist, belong to the user, and be ACTIVE (verified).
    const account = await exchangeAccountRepositoryAdapter.getAccountWithSecret(
      userId,
      exchangeAccountId
    );
    if (!account) {
      const error = new Error(
        "Exchange account not found. Connect an account in Settings first."
      );
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    if (account.status !== "ACTIVE") {
      const error = new Error(
        `Exchange account is ${account.status}. Verify it before starting a bot.`
      );
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }

    // One live run per strategy (022 shim-drop, runs-only): the retired
    // bot-level `strategy_id` guard is gone — `findLiveRunForStrategy` is
    // the authority.
    const liveRun = await this.repository.findLiveRunForStrategy(strategyId);
    if (liveRun) {
      const error = new Error("Strategy is already running in another session");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    // One live session per account (migration 019): a second POST /start on
    // the same account is refused — attach via POST /runs instead.
    const liveSession =
      await this.repository.findLiveSessionForAccount(exchangeAccountId);
    if (liveSession) {
      const error = new Error(
        "A live session already exists for this exchange account. Attach the strategy to it instead."
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    // L20: the strategy's symbol must be listed on the bound venue. Rejected
    // here — before any state change or BOT_START dispatch — with a
    // user-facing reason (start route passes 400 messages through). Fail-open
    // when the venue catalog cannot be fetched: the engine's own market
    // resolution stays the authority.
    const config = await this.repository.findStrategyConfig(strategyId);
    if (typeof config.symbol === "string" && config.symbol) {
      await assertSymbolSupported(
        config.symbol,
        account.exchange,
        account.environment
      );
    }

    // Create the instance in the deterministic initial state, bound to the
    // venue account (C3a, migration 013).
    const botId = await this.repository.insertBotInstance(
      strategyId,
      userId,
      exchangeAccountId
    );

    // Attach the initial run (plan §D, migration 019): snapshot the live
    // strategy config, size the run. The partial unique index refuses a
    // strategy live elsewhere — map the 23505 to the 409 above. A failed
    // attach rolls back the just-created session so no orphan bot remains.
    const bootConfig = await this.repository.findStrategyConfig(strategyId);
    try {
      await this.repository.attachRun(
        botId,
        strategyId,
        bootConfig,
        notionalAmount
      );
    } catch (error) {
      await query(`DELETE FROM bot_instances WHERE id = $1`, [botId]);
      const err = error as Error & { code?: string };
      if (err?.code === "23505") {
        const conflict = new Error(
          "Strategy is already running in another session"
        );
        (conflict as Error & { statusCode?: number }).statusCode = 409;
        throw conflict;
      }
      throw error;
    }

    await this.repository.recordLifecycleEvent(botId, {
      eventType: "BOT_CREATED",
      fromState: null,
      toState: "STOPPED",
      correlationId: null,
      messageId: null,
      metadata: { userId, strategyId, notionalAmount, exchangeAccountId },
    });

    // Delegate to start() so the transition/command logic has a single home.
    return this.start(botId, userId);
  }

  // ===========================================
  // STRATEGY RUNS (account sessions, plan §D)
  // ===========================================

  /**
   * Attach a strategy to a live session as a new run (POST /runs).
   * Guards: ownership, session live, strategy not live elsewhere,
   * per-run sizing via the existing position validator + derived
   * session cap (sum of live runs + new <= balance × leverage).
   * Returns the new run id. Engine wiring (START_STRATEGY) lands in D3;
   * until then the run is STOPPED and starts with the next session start.
   */
  async attachStrategyRun(
    botId: string,
    userId: string,
    strategyId: string,
    notionalAmount: number
  ): Promise<string> {
    const bot = await this.getOwnedBot(botId, userId);
    if (bot.actual_state !== "RUNNING" && bot.actual_state !== "STARTING") {
      const error = new Error("Session must be live to attach a strategy");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    const strategyExists = await this.repository.strategyExistsForUser(
      strategyId,
      userId
    );
    if (!strategyExists) {
      const error = new Error("Strategy not found");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    const liveRun = await this.repository.findLiveRunForStrategy(strategyId);
    if (liveRun) {
      const error = new Error("Strategy is already running in another session");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    // Per-run sizing: reuse the validator's single-position check via the
    // derived session cap — sum(live) + new must fit balance × leverage.
    // Full venue-limit validation already ran at session create; here we
    // guard the aggregate only (Act-mode decision 4).
    const liveTotal = await this.repository.sumLiveRunNotional(botId);
    const sessionCap = await this.getSessionCap(userId);
    if (sessionCap !== null && liveTotal + notionalAmount > sessionCap) {
      const error = new Error(
        `Session cap exceeded: live $${liveTotal} + new $${notionalAmount} > $${sessionCap}`
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    const snapConfig = await this.repository.findStrategyConfig(strategyId);
    const runId = await this.repository.attachRun(
      botId,
      strategyId,
      snapConfig,
      notionalAmount
    );
    await this.repository.recordLifecycleEvent(botId, {
      eventType: "RUN_ATTACHED",
      fromState: bot.actual_state,
      toState: bot.actual_state,
      correlationId: null,
      messageId: null,
      metadata: { runId, strategyId, notionalAmount },
    });
    return runId;
  }

  /**
   * Detach a STOPPED run (DELETE /runs/:runId). Live runs must be stopped
   * first via stopStrategyRun.
   */
  async detachStrategyRun(
    botId: string,
    userId: string,
    runId: string
  ): Promise<void> {
    const bot = await this.getOwnedBot(botId, userId);
    const run = await this.repository.findRun(runId);
    if (!run || run.bot_id !== bot.id) {
      const error = new Error("Run not found in this session");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    if (run.state === "STARTING" || run.state === "RUNNING") {
      const error = new Error("Stop the run before detaching it");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    await this.repository.detachRun(runId);
    await this.repository.recordLifecycleEvent(botId, {
      eventType: "RUN_DETACHED",
      fromState: bot.actual_state,
      toState: bot.actual_state,
      correlationId: null,
      messageId: null,
      metadata: { runId, strategyId: run.strategy_id },
    });
  }

  /**
   * Derived session cap (Act-mode decision 4): balance × maxLeverage.
   * Fail-open null for now — the position validator owns the Redis-backed
   * account-info lookup and the service has no cache dep; D3 wires the real
   * aggregate check once the engine reports per-run exposure. Until then the
   * per-run validator at session create is the active guard.
   */
  private async getSessionCap(_userId: string): Promise<number | null> {
    return null;
  }

  // ===========================================
  // STOP
  // ===========================================

  /**
   * Desired-state transition to STOPPED. Idempotent: stopping a STOPPED or
   * STOPPING bot is a no-op success. Stopping a STARTING bot transitions
   * directly to STOPPED (STARTING -> STOPPING is not a legal transition)
   * while still notifying the engine so an in-flight initialization aborts.
   */
  async stop(botId: string, userId: string): Promise<BotLifecycleResult> {
    const bot = await this.getOwnedBot(botId, userId);

    // Idempotency: already stopped or stopping with the same desired state.
    if (
      bot.desired_state === "STOPPED" &&
      (bot.actual_state === "STOPPED" || bot.actual_state === "STOPPING")
    ) {
      logger.info("Stop requested but bot already stopped/stopping - no-op", {
        botId,
        actualState: bot.actual_state,
      });
      return { botId, desiredState: "STOPPED", actualState: bot.actual_state };
    }

    // RUNNING goes through STOPPING; STARTING/ERROR go straight to STOPPED.
    const targetState: "STOPPING" | "STOPPED" =
      bot.actual_state === "RUNNING" ? "STOPPING" : "STOPPED";
    const nextState = assertTransition(bot.actual_state, targetState);

    const persisted = await this.repository.persistTransition(
      botId,
      {
        desiredState: "STOPPED",
        actualState: nextState,
        stoppedAt: nextState === "STOPPED" ? new Date() : null,
      },
      bot.actual_state
    );
    if (!persisted) {
      const error = new Error(
        "Bot lifecycle state changed concurrently - retry"
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }
    await this.repository.recordLifecycleEvent(botId, {
      eventType: "STOP_REQUESTED",
      fromState: bot.actual_state,
      toState: nextState,
      correlationId: null,
      messageId: null,
      metadata: { userId },
    });

    const sendResult = await this.dispatcher.sendStopCommand(botId);
    if (!sendResult.success) {
      // Desired state stays STOPPED; reconciliation will re-send the stop later.
      await this.repository.recordLifecycleEvent(botId, {
        eventType: "STOP_FAILED",
        fromState: nextState,
        toState: nextState,
        correlationId: sendResult.correlationId ?? null,
        messageId: sendResult.messageId ?? null,
        metadata: { reason: sendResult.error ?? "unknown" },
      });
      const error = new Error("Failed to deliver stop command to engine");
      (error as Error & { statusCode?: number }).statusCode = 503;
      throw error;
    }

    // Dispatch already tracked the command as PENDING (record-before-publish),
    // giving the timeout sweeper a row to detect an engine that never stops it.
    await this.repository.recordLifecycleEvent(botId, {
      eventType: "STOP_COMMAND_SENT",
      fromState: nextState,
      toState: nextState,
      correlationId: sendResult.correlationId ?? null,
      messageId: sendResult.messageId ?? null,
      metadata: {},
    });

    // Strategy badge (Phase 2, 022 shim-drop): the session's runs stop with
    // this bot — badge follows the runs.
    await syncSessionStrategiesActive(this.repository, botId, false);

    return {
      botId,
      desiredState: "STOPPED",
      actualState: nextState,
      correlationId: sendResult.correlationId,
    };
  }

  // ===========================================
  // EMERGENCY STOP (M1)
  // ===========================================

  /**
   * Emergency stop: dispatch a real, audited EMERGENCY_STOP command to the
   * engine (which stops the runner and performs the venue-side cleanup
   * selected by `action`) and badge the row FORCE_STOPPING.
   *
   * `status` is set to FORCE_STOPPING *after* the CAS transition (which
   * mirrors status to actual_state); the engine's terminal STATE_CHANGED
   * converges the row back to STOPPED through the normal event path, so the
   * badge can never outlive the engine work it describes.
   *
   * Only a RUNNING bot can be emergency-stopped: anything else has no runner
   * to kill, and reporting success would leave a FORCE_STOPPING row with no
   * command behind it (409 instead).
   */
  async emergencyStop(
    botId: string,
    userId: string,
    action: EmergencyStopAction
  ): Promise<BotLifecycleResult> {
    const bot = await this.getOwnedBot(botId, userId);

    if (bot.actual_state !== "RUNNING") {
      const error = new Error(
        `Bot is not running (actual state: ${bot.actual_state})`
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    const fromState = bot.actual_state;
    const nextState = assertTransition(fromState, "STOPPING");

    const persisted = await this.repository.persistTransition(
      botId,
      { desiredState: "STOPPED", actualState: nextState, stoppedAt: null },
      fromState
    );
    if (!persisted) {
      const error = new Error(
        "Bot lifecycle state changed concurrently - retry"
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    await this.repository.recordLifecycleEvent(botId, {
      eventType: "EMERGENCY_STOP_REQUESTED",
      fromState,
      toState: nextState,
      correlationId: null,
      messageId: null,
      metadata: { userId, action },
    });

    // Badge only after the transition (persistTransition mirrors status).
    await this.repository.updateStatus(botId, "FORCE_STOPPING");

    const sendResult = await this.dispatcher.sendEmergencyStopCommand(
      botId,
      action
    );
    if (!sendResult.success) {
      // No engine work is in flight: drop the badge so the row reflects the
      // graceful STOPPING recovery path (reconciliation re-issues BOT_STOP).
      await this.repository.updateStatus(botId, nextState);
      await this.repository.recordLifecycleEvent(botId, {
        eventType: "EMERGENCY_STOP_FAILED",
        fromState: nextState,
        toState: nextState,
        correlationId: sendResult.correlationId ?? null,
        messageId: sendResult.messageId ?? null,
        metadata: { action, reason: sendResult.error ?? "unknown" },
      });
      const error = new Error(
        "Failed to deliver emergency stop command to engine"
      );
      (error as Error & { statusCode?: number }).statusCode = 503;
      throw error;
    }

    await this.repository.recordLifecycleEvent(botId, {
      eventType: "EMERGENCY_STOP_COMMAND_SENT",
      fromState: nextState,
      toState: nextState,
      correlationId: sendResult.correlationId ?? null,
      messageId: sendResult.messageId ?? null,
      metadata: { action },
    });

    // Strategy badge (Phase 2, 022 shim-drop): the session's runs stop with
    // this bot — badge follows the runs.
    await syncSessionStrategiesActive(this.repository, botId, false);

    logger.warn("Emergency stop dispatched", {
      botId,
      action,
      fromState,
      toState: nextState,
      correlationId: sendResult.correlationId,
    });

    return {
      botId,
      desiredState: "STOPPED",
      actualState: nextState,
      correlationId: sendResult.correlationId,
    };
  }

  // ===========================================
  // ENGINE EVENTS & SUPERVISION (delegated)
  // ===========================================

  /** Process one event from the engine (see BotEventProcessor). */
  handleEngineEvent(event: BotEvent): Promise<void> {
    return this.eventProcessor.handleEngineEvent(event);
  }

  /** Timeout supervision sweep (see BotEventProcessor). */
  sweepTimedOutCommands(): Promise<number> {
    return this.eventProcessor.sweepTimedOutCommands();
  }

  /** Mark an offline engine's RUNNING bots as UNKNOWN (see BotEventProcessor). */
  markBotsUnknownForEngine(engineId: string): Promise<number> {
    return this.eventProcessor.markBotsUnknownForEngine(engineId);
  }

  /** Reconcile a heartbeat's runtime inventory against backend state. */
  reconcileHeartbeatInventory(
    engineId: string,
    activeBotIds: string[]
  ): Promise<{ unlisted: number; drift: number; stopReissued: number }> {
    return this.eventProcessor.reconcileHeartbeatInventory(
      engineId,
      activeBotIds
    );
  }

  // ===========================================
  // LIFECYCLE RECONCILIATION (authoritative repairs)
  // ===========================================

  /**
   * Re-send a BOT_STOP command for a bot whose desired state is STOPPED but
   * whose engine still reports an active lifecycle. This is the ONLY
   * automatic-repair path for stop drift; the command is tracked PENDING so
   * the timeout sweeper continues to supervise it.
   *
   * Returns the dispatch result so the reconciler can bound retry attempts.
   */
  async reissueStopForReconciliation(
    botId: string,
    reason: string
  ): Promise<BotLifecycleResult> {
    const bot = await this.repository.findBot(botId);
    if (!bot) {
      const error = new Error("Bot not found");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    if (bot.desired_state !== "STOPPED") {
      throw new Error(
        `Refusing reconcile stop-reissue: desired_state is ${bot.desired_state}`
      );
    }
    if (
      bot.actual_state === "STOPPED" ||
      bot.actual_state === "ERROR" ||
      bot.actual_state === "UNKNOWN"
    ) {
      throw new Error(
        `Refusing reconcile stop-reissue: actual_state is ${bot.actual_state}`
      );
    }

    const sendResult = await this.dispatcher.sendStopCommand(botId);
    await this.repository.recordLifecycleEvent(botId, {
      eventType: sendResult.success
        ? "RECONCILE_STOP_REISSUED"
        : "RECONCILE_STOP_REISSUE_FAILED",
      fromState: bot.actual_state,
      toState: bot.actual_state,
      correlationId: sendResult.correlationId ?? null,
      messageId: sendResult.messageId ?? null,
      metadata: { reason, dispatchError: sendResult.error ?? null },
    });

    if (!sendResult.success) {
      throw new Error(
        `Reconcile stop-reissue dispatch failed: ${sendResult.error ?? "unknown"}`
      );
    }

    // Surface the reconciliation to the frontend without a fake transition.
    this.notifier.emitStateChanged(
      botId,
      bot.user_id,
      bot.actual_state,
      bot.actual_state,
      sendResult.correlationId ?? ""
    );

    return {
      botId,
      desiredState: "STOPPED",
      actualState: bot.actual_state,
      correlationId: sendResult.correlationId,
    };
  }

  /**
   * L24 repair: stop the engine-side runner of a bot the authority has already
   * declared terminal (ERROR/STOPPED/UNKNOWN) but which a healthy engine still
   * reports as active.
   *
   * A command timeout is backend bookkeeping only. Without this repair a
   * timed-out BOT_START left the engine placing and filling orders for a bot
   * the backend had marked ERROR - exposure that ended only on a manual stop.
   * The stop goes through the normal tracked dispatch path
   * (record-before-publish) so it is supervised like any other command, and is
   * bounded per bot per hour so an unreachable engine cannot be spammed.
   *
   * Best-effort by contract: it is called from supervision sweeps, so it never
   * throws and returns true only when a stop was actually dispatched.
   */
  async stopEngineRunnerForTerminalBot(
    botId: string,
    reason: string
  ): Promise<boolean> {
    try {
      const bot = await this.repository.findBot(botId);
      if (!bot) {
        logger.warn("Terminal-stop repair skipped: unknown bot", {
          botId,
          reason,
        });
        return false;
      }

      // Only repair states where the authority has concluded the bot must not
      // trade. RUNNING/STARTING/STOPPING describe a live lifecycle: there the
      // engine inventory is simply ahead of the backend and must not be
      // second-guessed.
      if (!isTerminalActualState(bot.actual_state)) {
        logger.debug("Terminal-stop repair skipped: bot is mid-lifecycle", {
          botId,
          actualState: bot.actual_state,
          reason,
        });
        return false;
      }

      if (!bot.engine_id) {
        logger.warn("Terminal-stop repair skipped: bot has no engine binding", {
          botId,
          actualState: bot.actual_state,
          reason,
        });
        return false;
      }

      const reissues = await this.repository.countRecentStopReissues(botId);
      if (reissues >= MAX_STOP_REISSUES_PER_HOUR) {
        logger.error(
          "Terminal-stop repair budget exhausted - engine may still be trading",
          undefined,
          {
            botId,
            actualState: bot.actual_state,
            engineId: bot.engine_id,
            reissuesLastHour: reissues,
            reason,
          }
        );
        return false;
      }

      const sendResult = await this.dispatcher.sendStopCommand(botId);
      await this.repository.recordLifecycleEvent(botId, {
        eventType: sendResult.success
          ? "RECONCILE_STOP_REISSUED"
          : "RECONCILE_STOP_REISSUE_FAILED",
        fromState: bot.actual_state,
        toState: bot.actual_state,
        correlationId: sendResult.correlationId ?? null,
        messageId: sendResult.messageId ?? null,
        metadata: {
          reason,
          source: "terminal-state-drift",
          dispatchError: sendResult.error ?? null,
        },
      });

      if (!sendResult.success) {
        logger.error(
          "Terminal-stop repair dispatch failed - engine may still be trading",
          undefined,
          {
            botId,
            actualState: bot.actual_state,
            engineId: bot.engine_id,
            error: sendResult.error,
            reason,
          }
        );
        return false;
      }

      logger.error(
        "Terminal-stop repair dispatched: engine must tear down a terminal bot",
        undefined,
        {
          botId,
          actualState: bot.actual_state,
          engineId: bot.engine_id,
          correlationId: sendResult.correlationId,
          reason,
        }
      );
      return true;
    } catch (error) {
      logger.error("Terminal-stop repair failed", undefined, {
        botId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Degrade a transitional bot whose actual state can no longer be confirmed
   * (no PENDING command, no recent state change) to UNKNOWN via a
   * compare-and-set transition. UNKNOWN tells the user/reconciliation that
   * the engine state is unverified, without fabricating a terminal state.
   */
  async reconcileStuckTransitionToUnknown(
    botId: string,
    reason: string
  ): Promise<boolean> {
    const bot = await this.repository.findBot(botId);
    if (!bot) {
      return false;
    }
    if (bot.actual_state !== "STARTING" && bot.actual_state !== "STOPPING") {
      return false;
    }

    const persisted = await this.repository.persistTransition(
      botId,
      {
        desiredState: bot.desired_state,
        actualState: "UNKNOWN",
        errorCode: "RECONCILE_STATE_UNCONFIRMED",
        errorMessage: `Lifecycle reconciliation could not confirm ${bot.actual_state} state (${reason})`,
      },
      bot.actual_state
    );

    if (persisted) {
      await this.repository.recordLifecycleEvent(botId, {
        eventType: "RECONCILE_MARKED_UNKNOWN",
        fromState: bot.actual_state,
        toState: "UNKNOWN",
        correlationId: null,
        messageId: null,
        metadata: { reason },
      });
      this.notifier.emitStateChanged(
        botId,
        bot.user_id,
        bot.actual_state,
        "UNKNOWN",
        `reconcile-${reason}`
      );
    }

    return persisted;
  }

  /**
   * Audit-only marker: desired RUNNING but engine state is unconfirmed. No
   * auto-start is performed — recovery is the operator's explicit call
   * (`POST /management/resume`).
   *
   * P0-3: returns `true` only when a NEW marker row was written. The
   * reconciler runs every ~60 s, and recording unconditionally buried the audit
   * trail under duplicates: 794 `RECONCILE_NEEDS_USER_ACTION` rows against 24
   * `STATE_CHANGED` in this database, 725 of them for a single bot. An identical
   * marker already sitting at the tail of the trail means the episode is already
   * recorded, so we skip. Any real transition becomes the new tail, so a bot that
   * parks again later is still marked.
   */
  async recordReconcileNeedsUserAction(
    botId: string,
    reason: string
  ): Promise<boolean> {
    const bot = await this.repository.findBot(botId);
    if (!bot) {
      return false;
    }

    const latest = await this.repository.findLatestLifecycleEvent(botId);
    if (
      latest?.event_type === "RECONCILE_NEEDS_USER_ACTION" &&
      latest.from_state === bot.actual_state &&
      latest.metadata?.reason === reason
    ) {
      return false;
    }

    await this.repository.recordLifecycleEvent(botId, {
      eventType: "RECONCILE_NEEDS_USER_ACTION",
      fromState: bot.actual_state,
      toState: bot.actual_state,
      correlationId: null,
      messageId: null,
      metadata: { reason, desiredState: bot.desired_state },
    });
    return true;
  }

  // ===========================================
  // HELPERS
  // ===========================================

  private async getOwnedBot(botId: string, userId: string): Promise<BotRow> {
    const bot = await this.repository.findBot(botId);
    if (!bot || bot.user_id !== userId) {
      const error = new Error("Bot not found");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    return bot;
  }
}

// ===========================================
// SINGLETON
// ===========================================

// Singleton instance
export const botLifecycleService = new BotLifecycleService(
  engineProtocolService
);
