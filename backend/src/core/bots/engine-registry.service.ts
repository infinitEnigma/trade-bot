/**
 * Engine Registry Service - engine liveness & authoritative identity
 *
 * Consumes ENGINE_REGISTER / ENGINE_HEARTBEAT events from the engine and
 * maintains the `engine_registry` table:
 * - ENGINE_REGISTER:  upserts the engine with its restart epoch, marks it ONLINE.
 * - ENGINE_HEARTBEAT: refreshes last_seen_at; heartbeat timeout -> OFFLINE.
 *
 * The supervision sweep transitions RUNNING bots of OFFLINE engines to
 * UNKNOWN (delegated to BotLifecycleService so state-machine policy stays
 * in one place). Epochs reject events from superseded engine processes.
 *
 * @format
 */

import {
    EngineHeartbeatEventPayload,
    EngineRegisterEventPayload,
    isEngineHeartbeatEvent,
    isEngineRegisterEvent,
    BotEvent,
} from "@trade-bot/shared";
import { query } from "../../database/pool";
import { redisLogger as logger } from "../../core/logging/context-aware-logger.service";
import { botLifecycleService } from "./bot-lifecycle.service";

/** How long an engine may go without a heartbeat before it is OFFLINE. */
export const ENGINE_HEARTBEAT_TIMEOUT_MS = Number(process.env.ENGINE_HEARTBEAT_TIMEOUT_MS ?? 30_000);
const SWEEP_INTERVAL_MS = Number(process.env.ENGINE_SWEEP_INTERVAL_MS ?? 10_000);

interface EngineRow {
    engine_id: string;
    epoch: number;
    status: string;
    version: string | null;
    last_seen_at: Date;
}

export class EngineRegistryService {
    private sweepIntervalId: NodeJS.Timeout | null = null;

    // ===========================================
    // EVENT HANDLING
    // ===========================================

    /**
     * Handle an engine lifecycle event. Returns true if the event was
     * consumed (so callers do not warn about unknown event types).
     */
    async handleEngineEvent(event: BotEvent): Promise<boolean> {
        if (isEngineRegisterEvent(event)) {
            await this.register(event.payload);
            return true;
        }
        if (isEngineHeartbeatEvent(event)) {
            await this.heartbeat(event.payload);
            return true;
        }
        return false;
    }

    /**
     * Register (or re-register) an engine. A registration with a higher
     * epoch than the stored one supersedes the previous process.
     */
    async register(payload: EngineRegisterEventPayload): Promise<void> {
        try {
            await query(
                `INSERT INTO engine_registry (engine_id, epoch, status, version, started_at, last_seen_at)
                 VALUES ($1, $2, 'ONLINE', $3, $4, CURRENT_TIMESTAMP)
                 ON CONFLICT (engine_id) DO UPDATE SET
                     epoch = GREATEST(engine_registry.epoch, EXCLUDED.epoch),
                     status = 'ONLINE',
                     version = EXCLUDED.version,
                     started_at = EXCLUDED.started_at,
                     last_seen_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP`,
                [payload.engineId, payload.epoch, payload.version, payload.startedAt]
            );
            logger.info("Engine registered", {
                engineId: payload.engineId,
                epoch: payload.epoch,
                version: payload.version,
            });
        } catch (error) {
            logger.error("Failed to register engine", undefined, {
                engineId: payload.engineId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Refresh engine liveness. Heartbeats from a stale epoch (an old process
     * that came back to life) are rejected.
     */
    async heartbeat(payload: EngineHeartbeatEventPayload): Promise<void> {
        try {
            const result = await query(
                `UPDATE engine_registry
                 SET last_seen_at = CURRENT_TIMESTAMP,
                     status = 'ONLINE',
                     epoch = GREATEST(engine_registry.epoch, $2),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE engine_id = $1 AND epoch <= $2`,
                [payload.engineId, payload.epoch]
            );
            if ((result.rowCount ?? 0) === 0) {
                logger.warn("Heartbeat from unknown or stale engine epoch - ignoring", {
                    engineId: payload.engineId,
                    epoch: payload.epoch,
                });
            }
        } catch (error) {
            logger.error("Failed to process engine heartbeat", undefined, {
                engineId: payload.engineId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Reject events from an engine whose epoch has been superseded by a
     * newer registration (e.g. a delayed event from a crashed process).
     */
    async isEngineAuthoritative(engineId: string, epoch?: number): Promise<boolean> {
        try {
            const result = await query<EngineRow>(
                `SELECT engine_id, epoch, status, version, last_seen_at FROM engine_registry WHERE engine_id = $1`,
                [engineId]
            );
            const row = result.rows[0];
            if (!row) {
                // Engine never registered - only possible for pre-registry events.
                return true;
            }
            if (epoch !== undefined && row.epoch > epoch) {
                return false;
            }
            return row.status === "ONLINE";
        } catch (error) {
            logger.error("Failed to check engine authority - failing open", undefined, {
                engineId,
                error: error instanceof Error ? error.message : String(error),
            });
            return true;
        }
    }

    // ===========================================
    // SUPERVISION SWEEP
    // ===========================================

    /**
     * Mark engines whose heartbeat has timed out as OFFLINE and transition
     * their RUNNING bots to UNKNOWN. Returns the number of engines marked.
     */
    async sweepOfflineEngines(): Promise<number> {
        const expired = await query<EngineRow>(
            `SELECT engine_id, epoch, status, version, last_seen_at
             FROM engine_registry
             WHERE status = 'ONLINE' AND last_seen_at < NOW() - make_interval(secs => $1)`,
            [ENGINE_HEARTBEAT_TIMEOUT_MS / 1000]
        );
        let marked = 0;

        for (const engine of expired.rows) {
            // Claim first so concurrent sweeps cannot double-process.
            const claimed = await query(
                `UPDATE engine_registry
                 SET status = 'OFFLINE', updated_at = CURRENT_TIMESTAMP
                 WHERE engine_id = $1 AND status = 'ONLINE'`,
                [engine.engine_id]
            );
            if ((claimed.rowCount ?? 0) !== 1) {
                continue;
            }
            marked++;
            logger.error("Engine heartbeat lost - marked OFFLINE", undefined, {
                engineId: engine.engine_id,
                epoch: engine.epoch,
                lastSeenAt: engine.last_seen_at,
            });

            await botLifecycleService.markBotsUnknownForEngine(engine.engine_id);
        }

        return marked;
    }

    // ===========================================
    // LIFECYCLE
    // ===========================================

    start(): void {
        if (this.sweepIntervalId) {
            return;
        }
        this.sweepIntervalId = setInterval(() => {
            void this.sweepOfflineEngines().catch((error: unknown) => {
                logger.error("Engine offline sweep failed", undefined, {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }, SWEEP_INTERVAL_MS);
        this.sweepIntervalId.unref();
        logger.info("Engine registry supervision started", {
            sweepIntervalMs: SWEEP_INTERVAL_MS,
            heartbeatTimeoutMs: ENGINE_HEARTBEAT_TIMEOUT_MS,
        });
    }

    stop(): void {
        if (this.sweepIntervalId) {
            clearInterval(this.sweepIntervalId);
            this.sweepIntervalId = null;
            logger.info("Engine registry supervision stopped");
        }
    }

    getStatus(): { isRunning: boolean } {
        return { isRunning: this.sweepIntervalId !== null };
    }
}

export const engineRegistryService = new EngineRegistryService();
