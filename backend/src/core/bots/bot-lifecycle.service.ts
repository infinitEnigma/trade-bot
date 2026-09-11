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
import { BotEventProcessor, EngineLifecycleEventHandler } from "./lifecycle/bot-event-processor";
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

        // Track the command so the timeout sweeper can detect an engine that
        // never processes it (Redis accepted the message but the engine is down).
        await this.dispatcher.trackPending(botId, sendResult, "BOT_START");

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

        // Track the command for timeout supervision (same as BOT_START).
        await this.dispatcher.trackPending(botId, sendResult, "BOT_STOP");

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

// Singleton instance (same pattern as botReconciliationWorker)
export const botLifecycleService = new BotLifecycleService(engineProtocolService);
