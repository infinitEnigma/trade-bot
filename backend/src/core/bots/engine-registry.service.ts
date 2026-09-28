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
export const ENGINE_HEARTBEAT_TIMEOUT_MS = Number(
  process.env.ENGINE_HEARTBEAT_TIMEOUT_MS ?? 30_000
);
const SWEEP_INTERVAL_MS = Number(
  process.env.ENGINE_SWEEP_INTERVAL_MS ?? 10_000
);

interface EngineRow {
  engine_id: string;
  /**
   * `engine_registry.epoch` is BIGINT (migration 009) and node-postgres
   * returns int8 as a STRING - never assume a JS number here (ledger L21).
   */
  epoch: number | string;
  status: string;
  version: string | null;
  last_seen_at: Date;
}

/**
 * Parse a registry/wire epoch into a comparable integer.
 *
 * L21: `engine_registry.epoch` is BIGINT and node-postgres hands BIGINT back
 * as a string ("19"), while the engine publishes `engineEpoch` as a JSON
 * number (19). A strict `!==` between the two rejected EVERY runtime event
 * (COMMAND_ACCEPTED, COMMAND_FAILED, STATE_CHANGED) as "epoch mismatch":
 * tracked commands were never resolved, STARTING timed out into ERROR with
 * ENGINE_NO_RESPONSE, and the engine kept trading a bot the backend had
 * declared dead (L24). Epochs must always be normalised before comparing.
 *
 * Returns null for absent/unparsable values so callers fail closed.
 */
export function normalizeEpoch(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * True when a registered epoch and an event epoch denote the same engine
 * process. A type mismatch (BIGINT string vs JSON number) is a match; an
 * unknown/unparsable value never matches (fail closed).
 */
export function epochsMatch(registered: unknown, eventEpoch: unknown): boolean {
  const registeredValue = normalizeEpoch(registered);
  const eventValue = normalizeEpoch(eventEpoch);
  return (
    registeredValue !== null &&
    eventValue !== null &&
    registeredValue === eventValue
  );
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
   * Register (or re-register) an engine.
   * - epoch > stored: a new process takes over (status refreshed to ONLINE).
   * - epoch = stored: idempotent re-registration.
   * - epoch < stored: a delayed registration from a superseded process -
   *   the row is NOT refreshed (a stale register must not resurrect an
   *   OFFLINE engine or overwrite its state).
   */
  async register(payload: EngineRegisterEventPayload): Promise<void> {
    try {
      const result = await query(
        `INSERT INTO engine_registry (engine_id, epoch, status, version, started_at, last_seen_at)
                 VALUES ($1, $2, 'ONLINE', $3, $4, CURRENT_TIMESTAMP)
                 ON CONFLICT (engine_id) DO UPDATE SET
                     epoch = EXCLUDED.epoch,
                     status = 'ONLINE',
                     version = EXCLUDED.version,
                     started_at = EXCLUDED.started_at,
                     last_seen_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE EXCLUDED.epoch >= engine_registry.epoch`,
        [payload.engineId, payload.epoch, payload.version, payload.startedAt]
      );
      if ((result.rowCount ?? 0) === 0) {
        logger.warn("Stale engine registration ignored (superseded epoch)", {
          engineId: payload.engineId,
          incomingEpoch: payload.epoch,
        });
      } else {
        logger.info("Engine registered", {
          engineId: payload.engineId,
          epoch: payload.epoch,
          version: payload.version,
        });
      }
    } catch (error) {
      logger.error("Failed to register engine", undefined, {
        engineId: payload.engineId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Refresh engine liveness and reconcile the heartbeat's runtime inventory
   * against backend state. Heartbeats from a stale epoch (an old process
   * that came back to life) are rejected.
   *
   * Registration is self-healing: an unknown engine_id is UPSERTED (inserted)
   * here, so a lost initial ENGINE_REGISTER is repaired on the first
   * heartbeat instead of leaving the engine permanently non-authoritative.
   */
  async heartbeat(payload: EngineHeartbeatEventPayload): Promise<void> {
    try {
      const result = await query(
        `INSERT INTO engine_registry (engine_id, epoch, status, version, started_at, last_seen_at)
                 VALUES ($1, $2, 'ONLINE', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT (engine_id) DO UPDATE SET
                     epoch = GREATEST(engine_registry.epoch, EXCLUDED.epoch),
                     status = 'ONLINE',
                     version = EXCLUDED.version,
                     last_seen_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE EXCLUDED.epoch >= engine_registry.epoch`,
        [payload.engineId, payload.epoch, payload.version]
      );
      if ((result.rowCount ?? 0) === 0) {
        logger.warn("Heartbeat from stale engine epoch - ignoring", {
          engineId: payload.engineId,
          epoch: payload.epoch,
        });
        return;
      }

      // The engine is healthy and tells us which bots it actually runs -
      // use that inventory to detect drift against persisted state.
      try {
        await botLifecycleService.reconcileHeartbeatInventory(
          payload.engineId,
          payload.activeBotIds
        );
      } catch (error) {
        logger.error("Heartbeat inventory reconciliation failed", undefined, {
          engineId: payload.engineId,
          error: error instanceof Error ? error.message : String(error),
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
   * Fail-closed engine-authority check for runtime events.
   * - unknown engine            → false (must register before reporting)
   * - superseded epoch          → false (delayed event from an old process)
   * - OFFLINE engine            → false (heartbeat lost, state untrusted)
   * - known + ONLINE + current  → true
   * DB errors THROW so the calling event handler propagates and the stream
   * message stays unacked for redelivery (transient failure ≠ authority).
   */
  async isEngineAuthoritative(
    engineId: string,
    epoch?: number
  ): Promise<boolean> {
    const result = await query<EngineRow>(
      `SELECT engine_id, epoch, status, version, last_seen_at FROM engine_registry WHERE engine_id = $1`,
      [engineId]
    );
    const row = result.rows[0];
    if (!row) {
      logger.warn("Engine authority check failed: unregistered engine", {
        engineId,
        epoch,
      });
      return false;
    }
    // Exact authority: a runtime event must carry the epoch this engine is
    // currently registered under. A mismatch in EITHER direction (delayed
    // event from a superseded process, or an impossible future epoch) is
    // rejected. The registry owns epoch assignment (via registration), so
    // runtime events must match it exactly - not merely trail it.
    //
    // The comparison must be type-agnostic: the registered epoch comes from a
    // BIGINT column (string on the wire from node-postgres) and the event
    // epoch is a JSON number (L21).
    if (epoch !== undefined && !epochsMatch(row.epoch, epoch)) {
      logger.warn("Engine authority check failed: epoch mismatch", {
        engineId,
        eventEpoch: epoch,
        registeredEpoch: row.epoch,
        registeredEpochType: typeof row.epoch,
      });
      return false;
    }
    return row.status === "ONLINE";
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
