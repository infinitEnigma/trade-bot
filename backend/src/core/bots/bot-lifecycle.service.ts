/**
 * Bot Lifecycle Service - desired/actual state machine owner
 *
 * The ONLY component allowed to mutate bot lifecycle state in PostgreSQL.
 * Validates every transition against the central state machine from
 * `@trade-bot/shared`, persists desired/actual state plus a lifecycle
 * audit trail, sends protocol commands to the engine, and processes
 * engine events (acknowledgements / failures / state changes).
 *
 * API routes must not touch `bot_instances.status` or stream messages
 * directly; they call this service and return 202 Accepted.
 *
 * @format
 */

import {
    BotActualState,
    BotDesiredState,
    BotEvent,
    assertTransition,
    canTransition,
} from "@trade-bot/shared";
import { query } from "../../database/pool";
import { contextLogger as logger } from "../logging";
import {
    EngineProtocolService,
    SendCommandResult,
    engineProtocolService,
} from "./engine-protocol.service";

// ===========================================
// TYPES
// ===========================================

export interface BotLifecycleResult {
    botId: string;
    desiredState: BotDesiredState;
    actualState: BotActualState;
    correlationId?: string;
}

export interface BotLifecycleServiceDependencies {
    engineProtocol: EngineProtocolService;
}

interface BotRow {
    id: string;
    user_id: string;
    strategy_id: string;
    status: string;
    desired_state: BotDesiredState;
    actual_state: BotActualState;
}

interface BotRowWithStrategy extends BotRow {
    config: Record<string, unknown> | null;
}

/** Map actual_state to the legacy single `status` column. */
const STATUS_BY_ACTUAL: Record<BotActualState, string> = {
    STOPPED: "STOPPED",
    STARTING: "STARTING",
    RUNNING: "RUNNING",
    STOPPING: "STOPPING",
    ERROR: "ERROR",
    UNKNOWN: "ERROR",
};

interface PersistTransitionInput {
    desiredState: BotDesiredState;
    actualState: BotActualState;
    engineId?: string | null;
    startedAt?: Date | null;
    stoppedAt?: Date | null;
    errorCode?: string | null;
    errorMessage?: string | null;
}

interface LifecycleEventInput {
    eventType: string;
    fromState: string | null;
    toState: string | null;
    correlationId: string | null;
    messageId: string | null;
    metadata: Record<string, unknown>;
}

export class BotLifecycleService {
    private engineProtocol: EngineProtocolService;
    private socketServer: { to: (room: string) => { emit: (event: string, data: unknown) => void } } | null = null;

    constructor(engineProtocol: EngineProtocolService) {
        this.engineProtocol = engineProtocol;
    }

    /**
     * Register the Socket.IO server so lifecycle changes reach the frontend
     * as `bot.stateChanged` events (internal protocol never leaks to the browser).
     */
    setSocketServer(io: NonNullable<BotLifecycleService["socketServer"]>): void {
        this.socketServer = io;
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

        await this.persistTransition(botId, {
            desiredState: "RUNNING",
            actualState: nextState,
        });
        await this.recordLifecycleEvent(botId, {
            eventType: "START_REQUESTED",
            fromState: bot.actual_state,
            toState: nextState,
            correlationId: null,
            messageId: null,
            metadata: { userId },
        });

        const sendResult = await this.sendStartCommand(bot.id, userId, bot.strategy_id);
        if (!sendResult.success) {
            // Roll back to STOPPED so the bot is not stuck in STARTING with no command in flight.
            await this.persistTransition(botId, { desiredState: "STOPPED", actualState: "STOPPED" });
            await this.recordLifecycleEvent(botId, {
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

        await this.recordLifecycleEvent(botId, {
            eventType: "START_COMMAND_SENT",
            fromState: nextState,
            toState: nextState,
            correlationId: sendResult.correlationId ?? null,
            messageId: sendResult.messageId ?? null,
            metadata: {},
        });

        logger.info("Bot start requested", { botId, userId, correlationId: sendResult.correlationId });

        return { botId, desiredState: "RUNNING", actualState: nextState, correlationId: sendResult.correlationId };
    }

    // === PART 2B (createAndStart/stop) appended below ===

    /**
     * Create a new bot instance for a strategy and start it.
     * The instance is created in actual STOPPED, then transitioned to STARTING.
     */
    async createAndStart(userId: string, strategyId: string, notionalAmount: number): Promise<BotLifecycleResult> {
        // Strategy must exist and belong to the user.
        const strategyResult = await query<{ id: string }>("SELECT id FROM strategies WHERE id = $1 AND user_id = $2", [strategyId, userId]);
        if (strategyResult.rows.length === 0) {
            const error = new Error("Strategy not found");
            (error as Error & { statusCode?: number }).statusCode = 404;
            throw error;
        }

        // One active bot per strategy.
        const activeBot = await query<{ id: string }>(
            "SELECT id FROM bot_instances WHERE strategy_id = $1 AND actual_state IN ('STARTING', 'RUNNING')",
            [strategyId]
        );
        if (activeBot.rows.length > 0) {
            const error = new Error("Bot is already running for this strategy");
            (error as Error & { statusCode?: number }).statusCode = 409;
            throw error;
        }

        // Create the instance in the deterministic initial state.
        const insertResult = await query<{ id: string }>(
            `INSERT INTO bot_instances
                (strategy_id, user_id, status, running_time, total_trades, total_pnl, desired_state, actual_state)
             VALUES ($1, $2, 'STOPPED', 0, 0, 0, 'STOPPED', 'STOPPED')
             RETURNING id`,
            [strategyId, userId]
        );
        const botId = insertResult.rows[0].id;

        await this.recordLifecycleEvent(botId, {
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
        const targetState: BotActualState = bot.actual_state === "RUNNING" ? "STOPPING" : "STOPPED";
        const nextState = assertTransition(bot.actual_state, targetState);

        await this.persistTransition(botId, {
            desiredState: "STOPPED",
            actualState: nextState,
            stoppedAt: nextState === "STOPPED" ? new Date() : null,
        });
        await this.recordLifecycleEvent(botId, {
            eventType: "STOP_REQUESTED",
            fromState: bot.actual_state,
            toState: nextState,
            correlationId: null,
            messageId: null,
            metadata: { userId },
        });

        const sendResult = await this.engineProtocol.sendCommand("BOT_STOP", { botId });
        if (!sendResult.success) {
            // Desired state stays STOPPED; reconciliation will re-send the stop later.
            await this.recordLifecycleEvent(botId, {
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

        await this.recordLifecycleEvent(botId, {
            eventType: "STOP_COMMAND_SENT",
            fromState: nextState,
            toState: nextState,
            correlationId: sendResult.correlationId ?? null,
            messageId: sendResult.messageId ?? null,
            metadata: {},
        });

        logger.info("Bot stop requested", { botId, userId, correlationId: sendResult.correlationId });

        return { botId, desiredState: "STOPPED", actualState: nextState, correlationId: sendResult.correlationId };
    }

    // === PART 3 (engine events + helpers + singleton) appended below ===

    // ===========================================
    // ENGINE EVENT HANDLING
    // ===========================================

    /**
     * Process one event from the engine. Business-level issues (unknown bot,
     * duplicate event, illegal transition report) are logged and swallowed so
     * the message is acked; only unexpected persistence failures throw, which
     * leaves the message unacked for redelivery.
     */
    async handleEngineEvent(event: BotEvent): Promise<void> {
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
                logger.warn("Unknown bot event type", { type: event.type, messageId: event.messageId });
        }
    }

    private async handleCommandAccepted(event: BotEvent): Promise<void> {
        const payload = event.payload as { botId: string; commandType: string; engineId: string };
        logger.info("Command accepted by engine", {
            botId: payload.botId,
            commandType: payload.commandType,
            correlationId: event.correlationId,
            engineId: payload.engineId,
        });
        await this.recordLifecycleEvent(payload.botId, {
            eventType: `${payload.commandType}_ACCEPTED`,
            fromState: null,
            toState: null,
            correlationId: event.correlationId,
            messageId: event.messageId,
            metadata: { engineId: payload.engineId },
        });
    }

    // === PART 3B (failed/state-changed/helpers) appended below ===

    private async handleCommandFailed(event: BotEvent): Promise<void> {
        const payload = event.payload as { botId: string; commandType: string; engineId: string; errorCode: string; message: string };
        logger.error("Command failed in engine", undefined, {
            botId: payload.botId,
            commandType: payload.commandType,
            errorCode: payload.errorCode,
            message: payload.message,
            correlationId: event.correlationId,
        });

        const bot = await this.findBot(payload.botId);
        if (!bot) {
            logger.warn("Command failed for unknown bot - ignoring", { botId: payload.botId });
            return;
        }

        if (bot.actual_state !== "ERROR") {
            const nextState = assertTransition(bot.actual_state, "ERROR");
            await this.persistTransition(bot.id, {
                desiredState: "STOPPED",
                actualState: nextState,
                errorCode: payload.errorCode,
                errorMessage: payload.message,
            });
        }

        await this.recordLifecycleEvent(bot.id, {
            eventType: "COMMAND_FAILED",
            fromState: bot.actual_state,
            toState: "ERROR",
            correlationId: event.correlationId,
            messageId: event.messageId,
            metadata: { commandType: payload.commandType, errorCode: payload.errorCode, message: payload.message },
        });

        this.emitStateChanged(bot.id, bot.user_id, bot.actual_state, "ERROR", event.correlationId);
    }

    // === PART 3C (state-changed/helpers/singleton) appended below ===

    private async handleStateChanged(event: BotEvent): Promise<void> {
        const payload = event.payload as { botId: string; engineId: string; from: BotActualState; to: BotActualState; reason?: string };

        const bot = await this.findBot(payload.botId);
        if (!bot) {
            logger.warn("State changed for unknown bot - ignoring", { botId: payload.botId });
            return;
        }

        // Duplicate/delayed events: nothing to do.
        if (bot.actual_state === payload.to) {
            logger.debug("State change matches current state - no-op", { botId: payload.botId, state: payload.to });
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

        await this.persistTransition(bot.id, {
            desiredState: bot.desired_state,
            actualState: payload.to,
            engineId: payload.engineId,
            startedAt: isRunning ? new Date() : null,
            stoppedAt: isStopped ? new Date() : null,
            errorCode: isRunning || isStopped ? null : undefined,
            errorMessage: isRunning || isStopped ? null : undefined,
        });

        await this.recordLifecycleEvent(bot.id, {
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

        this.emitStateChanged(bot.id, bot.user_id, bot.actual_state, payload.to, event.correlationId);
    }

    // ===========================================
    // PERSISTENCE HELPERS
    // ===========================================

    private emitStateChanged(botId: string, userId: string, from: BotActualState, to: BotActualState, correlationId: string): void {
        if (!this.socketServer) {
            logger.debug("No Socket.IO server registered - state change not broadcast", { botId });
            return;
        }
        this.socketServer.to(`user:${userId}`).emit("bot.stateChanged", {
            botId,
            from,
            to,
            correlationId,
            timestamp: Date.now(),
        });
    }

    private async findBot(botId: string): Promise<BotRow | null> {
        const result = await query<BotRow>("SELECT id, user_id, strategy_id, status, desired_state, actual_state FROM bot_instances WHERE id = $1", [botId]);
        return result.rows[0] ?? null;
    }

    private async getOwnedBot(botId: string, userId: string): Promise<BotRow> {
        const bot = await this.findBot(botId);
        if (!bot || bot.user_id !== userId) {
            const error = new Error("Bot not found");
            (error as Error & { statusCode?: number }).statusCode = 404;
            throw error;
        }
        return bot;
    }

    private async persistTransition(botId: string, input: PersistTransitionInput): Promise<void> {
        const now = new Date();
        await query(
            `UPDATE bot_instances
             SET desired_state = $2,
                 actual_state = $3,
                 status = $4,
                 engine_id = COALESCE($5, engine_id),
                 state_changed_at = $6,
                 started_at = COALESCE($7, started_at),
                 stopped_at = COALESCE($8, stopped_at),
                 last_error_code = COALESCE($9, last_error_code),
                 last_error_message = COALESCE($10, last_error_message),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [
                botId,
                input.desiredState,
                input.actualState,
                STATUS_BY_ACTUAL[input.actualState],
                input.engineId ?? null,
                now,
                input.startedAt ?? null,
                input.stoppedAt ?? null,
                input.errorCode === undefined ? null : input.errorCode,
                input.errorMessage === undefined ? null : input.errorMessage,
            ]
        );
    }

    private async recordLifecycleEvent(botId: string, input: LifecycleEventInput): Promise<void> {
        try {
            await query(
                `INSERT INTO bot_lifecycle_events (bot_id, event_type, from_state, to_state, correlation_id, message_id, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [botId, input.eventType, input.fromState, input.toState, input.correlationId, input.messageId, JSON.stringify(input.metadata)]
            );
        } catch (error) {
            // The audit trail must never break the lifecycle flow itself.
            logger.error("Failed to record lifecycle event", undefined, {
                botId,
                eventType: input.eventType,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async sendStartCommand(botId: string, userId: string, strategyId: string): Promise<SendCommandResult> {
        // Non-secret strategy configuration travels with the command; the
        // engine fetches credentials out-of-band after COMMAND_ACCEPTED.
        const strategyResult = await query<{ config: Record<string, unknown> | null }>("SELECT config FROM strategies WHERE id = $1", [strategyId]);
        return this.engineProtocol.sendCommand("BOT_START", {
            botId,
            userId,
            strategyId,
            configVersion: 1,
            config: strategyResult.rows[0]?.config ?? {},
        });
    }
}

// ===========================================
// SINGLETON
// ===========================================

// Singleton instance (same pattern as botReconciliationWorker)
export const botLifecycleService = new BotLifecycleService(engineProtocolService);
