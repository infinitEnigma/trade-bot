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

import { assertTransition, BotActualState, BotDesiredState, BotEvent } from "@trade-bot/shared";
import { contextLogger as logger } from "../logging";
import { EngineProtocolService, engineProtocolService } from "./engine-protocol.service";
import { BotCommandDispatcher } from "./lifecycle/bot-command-dispatcher";
import { BotLifecycleNotifier } from "./lifecycle/bot-lifecycle-notifier";
import { BotEventProcessor, EngineAuthorityChecker, EngineLifecycleEventHandler } from "./lifecycle/bot-event-processor";
import { BotLifecycleRepository } from "./lifecycle/bot-lifecycle.repository";
import { BotLifecycleResult, BotRow, BOT_COMMAND_TIMEOUT_MS } from "./lifecycle/types";

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
    }

    /** Register the Socket.IO server for frontend `bot.stateChanged` events. */
    setSocketServer(io: Parameters<BotLifecycleNotifier["setSocketServer"]>[0]): void {
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
        if (bot.desired_state === "RUNNING" && (bot.actual_state === "STARTING" || bot.actual_state === "RUNNING")) {
            logger.info("Start requested but bot already starting/running - no-op", { botId, actualState: bot.actual_state });
            return { botId, desiredState: "RUNNING", actualState: bot.actual_state };
        }

        // Validate the transition (throws InvalidStateTransitionError on illegal
        // moves, e.g. STOPPING -> STARTING).
        const nextState = assertTransition(bot.actual_state, "STARTING");

        // Compare-and-set: only persist if actual_state is still what we read.
        const persisted = await this.repository.persistTransition(
            botId,
            { desiredState: "RUNNING", actualState: nextState },
            bot.actual_state
        );
        if (!persisted) {
            const error = new Error("Bot lifecycle state changed concurrently - retry");
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

        const sendResult = await this.dispatcher.sendStartCommand(bot.id, userId, bot.strategy_id);
        if (!sendResult.success) {
            // Roll back to STOPPED so the bot is not stuck in STARTING with no command in flight.
            await this.repository.persistTransition(botId, { desiredState: "STOPPED", actualState: "STOPPED" }, nextState);
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

        return { botId, desiredState: "RUNNING", actualState: nextState, correlationId: sendResult.correlationId };
    }

    // ===========================================
    // CREATE AND START
    // ===========================================

    /**
     * Create a new bot instance for a strategy and start it.
     * The instance is created in actual STOPPED, then transitioned to STARTING.
     */
    async createAndStart(userId: string, strategyId: string, notionalAmount: number): Promise<BotLifecycleResult> {
        // Strategy must exist and belong to the user.
        const strategyExists = await this.repository.strategyExistsForUser(strategyId, userId);
        if (!strategyExists) {
            const error = new Error("Strategy not found");
            (error as Error & { statusCode?: number }).statusCode = 404;
            throw error;
        }

        // One active bot per strategy.
        const activeBot = await this.repository.findActiveBotForStrategy(strategyId);
        if (activeBot) {
            const error = new Error("Bot is already running for this strategy");
            (error as Error & { statusCode?: number }).statusCode = 409;
            throw error;
        }

        // Create the instance in the deterministic initial state.
        const botId = await this.repository.insertBotInstance(strategyId, userId);

        await this.repository.recordLifecycleEvent(botId, {
            eventType: "BOT_CREATED",
            fromState: null,
            toState: "STOPPED",
            correlationId: null,
            messageId: null,
            metadata: { userId, strategyId, notionalAmount },
        });

        // Delegate to start() so the transition/command logic has a single home.
        return this.start(botId, userId);
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
        if (bot.desired_state === "STOPPED" && (bot.actual_state === "STOPPED" || bot.actual_state === "STOPPING")) {
            logger.info("Stop requested but bot already stopped/stopping - no-op", { botId, actualState: bot.actual_state });
            return { botId, desiredState: "STOPPED", actualState: bot.actual_state };
        }

        // RUNNING goes through STOPPING; STARTING/ERROR go straight to STOPPED.
        const targetState: "STOPPING" | "STOPPED" = bot.actual_state === "RUNNING" ? "STOPPING" : "STOPPED";
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
            const error = new Error("Bot lifecycle state changed concurrently - retry");
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

        return { botId, desiredState: "STOPPED", actualState: nextState, correlationId: sendResult.correlationId };
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
    reconcileHeartbeatInventory(engineId: string, activeBotIds: string[]): Promise<{ unlisted: number; drift: number }> {
        return this.eventProcessor.reconcileHeartbeatInventory(engineId, activeBotIds);
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
    async reissueStopForReconciliation(botId: string, reason: string): Promise<BotLifecycleResult> {
        const bot = await this.repository.findBot(botId);
        if (!bot) {
            const error = new Error("Bot not found");
            (error as Error & { statusCode?: number }).statusCode = 404;
            throw error;
        }

        if (bot.desired_state !== "STOPPED") {
            throw new Error(`Refusing reconcile stop-reissue: desired_state is ${bot.desired_state}`);
        }
        if (bot.actual_state === "STOPPED" || bot.actual_state === "ERROR" || bot.actual_state === "UNKNOWN") {
            throw new Error(`Refusing reconcile stop-reissue: actual_state is ${bot.actual_state}`);
        }

        const sendResult = await this.dispatcher.sendStopCommand(botId);
        await this.repository.recordLifecycleEvent(botId, {
            eventType: sendResult.success ? "RECONCILE_STOP_REISSUED" : "RECONCILE_STOP_REISSUE_FAILED",
            fromState: bot.actual_state,
            toState: bot.actual_state,
            correlationId: sendResult.correlationId ?? null,
            messageId: sendResult.messageId ?? null,
            metadata: { reason, dispatchError: sendResult.error ?? null },
        });

        if (!sendResult.success) {
            throw new Error(`Reconcile stop-reissue dispatch failed: ${sendResult.error ?? "unknown"}`);
        }

        // Surface the reconciliation to the frontend without a fake transition.
        this.notifier.emitStateChanged(botId, bot.user_id, bot.actual_state, bot.actual_state, sendResult.correlationId ?? "");

        return {
            botId,
            desiredState: "STOPPED",
            actualState: bot.actual_state,
            correlationId: sendResult.correlationId,
        };
    }

    /**
     * Degrade a transitional bot whose actual state can no longer be confirmed
     * (no PENDING command, no recent state change) to UNKNOWN via a
     * compare-and-set transition. UNKNOWN tells the user/reconciliation that
     * the engine state is unverified, without fabricating a terminal state.
     */
    async reconcileStuckTransitionToUnknown(botId: string, reason: string): Promise<boolean> {
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
            this.notifier.emitStateChanged(botId, bot.user_id, bot.actual_state, "UNKNOWN", `reconcile-${reason}`);
        }

        return persisted;
    }

    /** Audit-only marker: desired RUNNING but engine state is unconfirmed. No auto-start is performed. */
    async recordReconcileNeedsUserAction(botId: string, reason: string): Promise<void> {
        const bot = await this.repository.findBot(botId);
        if (!bot) {
            return;
        }
        await this.repository.recordLifecycleEvent(botId, {
            eventType: "RECONCILE_NEEDS_USER_ACTION",
            fromState: bot.actual_state,
            toState: bot.actual_state,
            correlationId: null,
            messageId: null,
            metadata: { reason, desiredState: bot.desired_state },
        });
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
export const botLifecycleService = new BotLifecycleService(engineProtocolService);
