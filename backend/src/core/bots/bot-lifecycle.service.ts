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
    engine_id: string | null;
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

/** How long a PENDING command may wait for the engine before it times out. */
export const BOT_COMMAND_TIMEOUT_MS = Number(process.env.BOT_COMMAND_TIMEOUT_MS ?? 30_000);

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
    /** Optional handler for engine lifecycle events (registration/heartbeat). */
    private engineLifecycleHandler: ((event: BotEvent) => Promise<boolean>) | null = null;

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

    /**
     * Register the handler for ENGINE_REGISTER / ENGINE_HEARTBEAT events
     * (injected to avoid a circular dependency with EngineRegistryService).
     */
    setEngineLifecycleHandler(handler: (event: BotEvent) => Promise<boolean>): void {
        this.engineLifecycleHandler = handler;
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
        const persisted = await this.persistTransition(
            botId,
            { desiredState: "RUNNING", actualState: nextState },
            bot.actual_state
        );
        if (!persisted) {
            const error = new Error("Bot lifecycle state changed concurrently - retry");
            (error as Error & { statusCode?: number }).statusCode = 409;
            throw error;
        }
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
            await this.persistTransition(botId, { desiredState: "STOPPED", actualState: "STOPPED" }, nextState);
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

        // Track the command so the timeout sweeper can detect an engine that
        // never processes it (Redis accepted the message but the engine is down).
        if (sendResult.correlationId) {
            await this.recordPendingCommand(botId, sendResult.correlationId, "BOT_START");
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

        const persisted = await this.persistTransition(
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

        // Track the command for timeout supervision (same as BOT_START).
        if (sendResult.correlationId) {
            await this.recordPendingCommand(botId, sendResult.correlationId, "BOT_STOP");
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
        // Engine registration/heartbeat events go to the registry (if wired).
        if ((event.type === "ENGINE_REGISTER" || event.type === "ENGINE_HEARTBEAT") && this.engineLifecycleHandler) {
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
        await this.resolveCommand(event.correlationId, "ACCEPTED");
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
            const persisted = await this.persistTransition(
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
                logger.warn("Command failed processed against stale bot state - skipping", {
                    botId: bot.id,
                    actualState: bot.actual_state,
                    correlationId: event.correlationId,
                });
                return;
            }
        }

        await this.resolveCommand(event.correlationId, "FAILED", payload.errorCode, payload.message);

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

        // Reject events from a superseded engine process (Engine A crashed,
        // Engine B took over, A's delayed event arrives).
        if (bot.engine_id && payload.engineId && bot.engine_id !== payload.engineId) {
            logger.warn("State change from non-authoritative engine - ignoring", {
                botId: payload.botId,
                registeredEngineId: bot.engine_id,
                eventEngineId: payload.engineId,
                correlationId: event.correlationId,
            });
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
        const persisted = await this.persistTransition(
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
            logger.warn("State changed event processed against stale bot state - skipping", {
                botId: bot.id,
                from: bot.actual_state,
                to: payload.to,
                correlationId: event.correlationId,
            });
            return;
        }

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
    // ENGINE LIVENESS SUPERVISION
    // ===========================================

    /**
     * Transition all RUNNING bots owned by `engineId` to UNKNOWN (called by
     * EngineRegistryService when an engine's heartbeat times out). UNKNOWN
     * means "engine unreachable, actual state untrusted" - the state machine
     * allows recovery to RUNNING/STOPPED/ERROR once truth is re-established.
     * Also notifies the frontend for each affected bot.
     */
    async markBotsUnknownForEngine(engineId: string): Promise<number> {
        const bots = await query<BotRow>(
            `SELECT id, user_id, strategy_id, status, desired_state, actual_state, engine_id
             FROM bot_instances
             WHERE engine_id = $1 AND actual_state = 'RUNNING'`,
            [engineId]
        );

        for (const bot of bots.rows) {
            const persisted = await this.persistTransition(
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
                await this.recordLifecycleEvent(bot.id, {
                    eventType: "ENGINE_HEARTBEAT_LOST",
                    fromState: bot.actual_state,
                    toState: "UNKNOWN",
                    correlationId: null,
                    messageId: null,
                    metadata: { engineId },
                });
                this.emitStateChanged(bot.id, bot.user_id, bot.actual_state, "UNKNOWN", `engine-offline-${engineId}`);
                logger.error("Bot marked UNKNOWN after engine heartbeat loss", undefined, {
                    botId: bot.id,
                    engineId,
                });
            }
        }

        return bots.rows.length;
    }

    // ===========================================
    // COMMAND TRACKING & TIMEOUT SUPERVISION
    // ===========================================

    /**
     * Record a command as PENDING in `bot_commands`. The timeout sweeper uses
     * this table to detect commands that Redis accepted but the engine never
     * processed (e.g. engine down), so bots cannot be stuck in STARTING/STOPPING.
     */
    private async recordPendingCommand(botId: string, correlationId: string, commandType: string): Promise<void> {
        try {
            await query(
                `INSERT INTO bot_commands (correlation_id, bot_id, command_type, state, expires_at)
                 VALUES ($1, $2, $3, 'PENDING', NOW() + make_interval(secs => $4))
                 ON CONFLICT (correlation_id) DO NOTHING`,
                [correlationId, botId, commandType, BOT_COMMAND_TIMEOUT_MS / 1000]
            );
        } catch (error) {
            // Command tracking must never break the lifecycle flow itself;
            // the worst case is a command without timeout supervision.
            logger.error("Failed to record pending command", undefined, {
                botId,
                correlationId,
                commandType,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Mark a tracked command resolved. Unknown correlationIds are ignored so
     * events for commands tracked before this feature keep working.
     */
    private async resolveCommand(correlationId: string, state: "ACCEPTED" | "FAILED", errorCode?: string, errorMessage?: string): Promise<void> {
        try {
            await query(
                `UPDATE bot_commands
                 SET state = $2,
                     resolved_at = CURRENT_TIMESTAMP,
                     error_code = COALESCE($3, error_code),
                     error_message = COALESCE($4, error_message)
                 WHERE correlation_id = $1 AND state = 'PENDING'`,
                [correlationId, state, errorCode ?? null, errorMessage ?? null]
            );
        } catch (error) {
            logger.error("Failed to resolve tracked command", undefined, {
                correlationId,
                state,
                error: error instanceof Error ? error.message : String(error),
            });
        }
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
        const pending = await query<{ correlation_id: string; bot_id: string; command_type: string }>(
            `SELECT correlation_id, bot_id, command_type
             FROM bot_commands
             WHERE state = 'PENDING' AND expires_at < NOW()`,
            []
        );
        let timedOut = 0;

        for (const cmd of pending.rows) {
            // Claim the command first so concurrent sweeps cannot double-process.
            const claimed = await query(
                `UPDATE bot_commands
                 SET state = 'TIMED_OUT', resolved_at = CURRENT_TIMESTAMP,
                     error_code = 'COMMAND_TIMEOUT'
                 WHERE correlation_id = $1 AND state = 'PENDING'`,
                [cmd.correlation_id]
            );
            if ((claimed.rowCount ?? 0) !== 1) {
                continue;
            }
            timedOut++;

            const bot = await this.findBot(cmd.bot_id);
            if (!bot) {
                logger.warn("Timed-out command references unknown bot", { botId: cmd.bot_id, correlationId: cmd.correlation_id });
                continue;
            }

            // Only transitional states can get stuck waiting on the engine.
            if (bot.actual_state === "STARTING" || bot.actual_state === "STOPPING") {
                const nextState = assertTransition(bot.actual_state, "ERROR");
                const persisted = await this.persistTransition(
                    bot.id,
                    {
                        desiredState: "STOPPED",
                        actualState: nextState,
                        errorCode: "COMMAND_TIMEOUT",
                        errorMessage: `${cmd.command_type} command timed out after ${Math.round(BOT_COMMAND_TIMEOUT_MS / 1000)}s without engine confirmation`,
                    },
                    bot.actual_state
                );
                if (persisted) {
                    this.emitStateChanged(bot.id, bot.user_id, bot.actual_state, nextState, cmd.correlation_id);
                }
            }

            await this.recordLifecycleEvent(bot.id, {
                eventType: "COMMAND_TIMED_OUT",
                fromState: bot.actual_state,
                toState: bot.actual_state === "STARTING" || bot.actual_state === "STOPPING" ? "ERROR" : bot.actual_state,
                correlationId: cmd.correlation_id,
                messageId: null,
                metadata: { commandType: cmd.command_type, timeoutMs: BOT_COMMAND_TIMEOUT_MS },
            });

            logger.error("Lifecycle command timed out without engine confirmation", undefined, {
                botId: cmd.bot_id,
                commandType: cmd.command_type,
                correlationId: cmd.correlation_id,
            });
        }

        return timedOut;
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
        const result = await query<BotRow>("SELECT id, user_id, strategy_id, status, desired_state, actual_state, engine_id FROM bot_instances WHERE id = $1", [botId]);
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

    /**
     * Persist a lifecycle transition. When `expectedActualState` is provided,
     * the UPDATE is guarded with a compare-and-set predicate
     * (`AND actual_state = $expected`) so concurrent lifecycle operations
     * cannot race: the caller receives `false` if the row's actual_state
     * changed underneath it and must treat the transition as stale.
     */
    private async persistTransition(
        botId: string,
        input: PersistTransitionInput,
        expectedActualState?: BotActualState
    ): Promise<boolean> {
        const now = new Date();
        const sql = expectedActualState
            ? `UPDATE bot_instances
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
               WHERE id = $1 AND actual_state = $11`
            : `UPDATE bot_instances
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
               WHERE id = $1`;
        const params: unknown[] = [
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
        ];
        if (expectedActualState) {
            params.push(expectedActualState);
        }
        const result = await query(sql, params);
        return (result.rowCount ?? 0) === 1;
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
