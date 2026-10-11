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
import { query, getClient } from "../../database/pool";
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
  /** Live latest-known journal integrity (migration 025). */
  journal_integrity?: string;
  /** Sticky operator-action-required flag (migration 025). */
  journal_integrity_alert?: boolean;
  /** Latest journaled-but-undelivered fill count (migration 025). */
  pending_fills?: number | string;
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

      // F4: persist the journal-integrity signal. Runs only AFTER the stale-
      // epoch guard above, so a superseded-epoch heartbeat never reaches it.
      // A failure here is logged loudly and never treated as a successful
      // integrity update — the liveness write above is already committed, but
      // the safety signal is not, and a monitor must be able to see that.
      try {
        await this.recordJournalIntegrity(payload);
      } catch (error) {
        logger.error("FAILED to persist engine journal-integrity signal", undefined, {
          engineId: payload.engineId,
          epoch: payload.epoch,
          error: error instanceof Error ? error.message : String(error),
        });
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
   * Persist the engine's fill-journal integrity signal (F4). Called only after
   * the stale-epoch guard in `heartbeat()`.
   *
   * Ordering is the composite (epoch, heartbeatSeq): the last ACCEPTED pair is
   * stored and an incoming heartbeat is applied only if its pair is strictly
   * newer. An equal pair is a duplicate redelivery and is NOT reapplied. A
   * heartbeat without a valid sequence is REJECTED for integrity purposes
   * (liveness still updates via the separate upsert) — this monorepo deploys
   * engine and backend together, so no pre-025 engine that omits `heartbeatSeq`
   * remains active (see the deploy note in engine-lifecycle.ts).
   *
   * The prior-state read and the transition happen inside one row-locking
   * transaction, so concurrent heartbeats serialize and exactly one can observe
   * the pre-raise state — the UNKNOWN error log fires once, on the committed
   * false→true edge. Any DB error is thrown (observable) and rolled back.
   */
  private async recordJournalIntegrity(
    payload: EngineHeartbeatEventPayload
  ): Promise<void> {
    const isUnknown = payload.pendingFillsUnknown === true;
    const isOk = payload.pendingFillsUnknown === false;
    const pending =
      typeof payload.pendingFills === "number" &&
      Number.isInteger(payload.pendingFills) &&
      payload.pendingFills >= 0
        ? payload.pendingFills
        : null;

    // A valid sequence is REQUIRED for an integrity write. Missing/malformed
    // epoch or seq is rejected as invalid — never normalized to 0 and applied.
    if (
      typeof payload.epoch !== "number" ||
      !Number.isSafeInteger(payload.epoch) ||
      payload.epoch < 0
    ) {
      logger.warn("Engine heartbeat rejected for integrity: invalid epoch", {
        engineId: payload.engineId,
        epoch: payload.epoch,
      });
      return;
    }
    if (
      typeof payload.heartbeatSeq !== "number" ||
      !Number.isSafeInteger(payload.heartbeatSeq) ||
      payload.heartbeatSeq < 1
    ) {
      logger.warn(
        "Engine heartbeat rejected for integrity: missing/invalid heartbeatSeq",
        { engineId: payload.engineId, epoch: payload.epoch }
      );
      return;
    }
    const epoch = payload.epoch;
    const seq = payload.heartbeatSeq;

    const client = await getClient();
    try {
      await client.query("BEGIN");

      // Lock the engine row so the prior-state read and the transition form one
      // critical section: exactly one concurrent heartbeat can observe the
      // pre-raise state, so the error log is emitted once, on the real edge.
      const { rows } = await client.query<{
        journal_integrity_alert: boolean;
        last_hb_epoch: number | string;
        last_hb_seq: number | string;
      }>(
        `SELECT journal_integrity_alert, last_hb_epoch, last_hb_seq
           FROM engine_registry WHERE engine_id = $1 FOR UPDATE`,
        [payload.engineId]
      );
      const row = rows[0];
      // The liveness upsert just wrote this row; if it is somehow absent, fail
      // closed (throw) rather than silently dropping the safety signal.
      if (!row) {
        throw new Error(`engine_registry row missing for ${payload.engineId}`);
      }

      const lastEpoch = normalizeEpoch(row.last_hb_epoch) ?? 0;
      const lastSeq = normalizeEpoch(row.last_hb_seq) ?? 0;

      // Ordering decision on the composite pair.
      let apply = false;
      let nextEpoch = lastEpoch;
      let nextSeq = lastSeq;
      if (epoch > lastEpoch) {
        // Epoch advanced (e.g. a restart): the new process's seq RESETS, so the
        // pair moves as a unit — do NOT keep the old high seq.
        apply = true;
        nextEpoch = epoch;
        nextSeq = seq;
      } else if (epoch === lastEpoch && seq > lastSeq) {
        apply = true;
        nextEpoch = epoch;
        nextSeq = seq;
      } else if (epoch === lastEpoch && seq === lastSeq) {
        // Duplicate redelivery of an already-applied pair: do not reapply the
        // payload (no identity guarantee a re-sent pair carries the same bytes).
        await client.query("COMMIT");
        return;
      }
      // else: stale (older epoch, or same-epoch older seq) -> drop.

      if (!apply) {
        await client.query("COMMIT");
        return;
      }

      const wasAlerted = row.journal_integrity_alert;

      await client.query(
        `UPDATE engine_registry
            SET journal_integrity = CASE
                  WHEN $2 THEN 'UNKNOWN'
                  WHEN $3 THEN 'OK'
                  ELSE journal_integrity
                END,
                pending_fills = CASE
                  WHEN $4::int IS NOT NULL THEN $4 ELSE pending_fills END,
                journal_integrity_alert = CASE
                  WHEN $2 THEN TRUE ELSE journal_integrity_alert END,
                journal_unknown_since = CASE
                  WHEN $2 AND NOT journal_integrity_alert THEN CURRENT_TIMESTAMP
                  ELSE journal_unknown_since END,
                last_hb_epoch = $5,
                last_hb_seq = $6,
                updated_at = CURRENT_TIMESTAMP
          WHERE engine_id = $1`,
        [payload.engineId, isUnknown, isOk, pending, nextEpoch, nextSeq]
      );

      await client.query("COMMIT");

      // Reliable edge log: only the transaction that actually flipped the
      // sticky alert false→true logs, and it does so after a committed change.
      if (isUnknown && !wasAlerted) {
        logger.error(
          "Engine fill-journal integrity UNKNOWN - operator reconciliation required",
          undefined,
          { engineId: payload.engineId, epoch, pendingFills: pending }
        );
      }
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore — the connection is being released anyway */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Explicit, admin-authorized, reconciliation-attested recovery of a sticky
   * journal-integrity alert. The precondition (live 'OK' AND fully drained AND
   * currently alerted) and the clear are ONE conditional UPDATE, so a
   * concurrent heartbeat that flips the live state to UNKNOWN cannot slip
   * between a read and the clear — Postgres re-evaluates the WHERE against the
   * locked row, so the UPDATE matches 0 rows and recovery fails.
   *
   * This is an operator ATTESTATION (the admin has reconciled fills from venue
   * history and supplied `reconciliationRef`), not independent proof — the
   * runbook defines the evidence the operator is expected to check. Returns
   * `{ recovered: false }` when there is no active alert or the journal is not
   * currently OK and fully drained.
   */
  async recoverJournalIntegrity(
    engineId: string,
    operatorUserId: string,
    reconciliationRef: string
  ): Promise<{ recovered: boolean; reason?: string }> {
    const res = await query(
      `UPDATE engine_registry
          SET journal_integrity_alert = FALSE,
              journal_unknown_since = NULL,
              journal_recovered_at = CURRENT_TIMESTAMP,
              journal_recovered_by = $2,
              journal_recovery_ref = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE engine_id = $1
          AND journal_integrity = 'OK'
          AND pending_fills = 0
          AND journal_integrity_alert = TRUE`,
      [engineId, operatorUserId, reconciliationRef]
    );
    if ((res.rowCount ?? 0) === 1) {
      logger.warn("Engine fill-journal integrity recovered (operator-attested)", {
        engineId,
        operatorUserId,
        reconciliationRef,
      });
      return { recovered: true };
    }
    return {
      recovered: false,
      reason: "no active alert, or journal not currently OK and fully drained",
    };
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
  // LIVENESS QUERY
  // ===========================================

  /**
   * Is any engine process currently alive? The single source of truth for
   * "is the engine running" (UI status banner, health probe): an engine
   * counts when it is ONLINE *and* its heartbeat is fresh — so the answer
   * stays correct even if the periodic sweep has not run yet to flip a
   * stale ONLINE row to OFFLINE. DB errors THROW (fail closed: the caller
   * must not conclude "running" when the registry could not be read).
   */
  async getEngineLiveness(): Promise<{
    running: boolean;
    engines: Array<{
      engineId: string;
      status: string;
      lastSeenAt: Date;
      journalIntegrity: "OK" | "UNKNOWN" | "UNVERIFIED";
      journalIntegrityAlert: boolean;
      pendingFills: number;
    }>;
  }> {
    const result = await query<EngineRow>(
      `SELECT engine_id, epoch, status, version, last_seen_at,
              journal_integrity, journal_integrity_alert, pending_fills
             FROM engine_registry
             ORDER BY last_seen_at DESC`
    );
    const freshnessCutoffMs = Date.now() - ENGINE_HEARTBEAT_TIMEOUT_MS * 2;
    const engines = result.rows.map(row => ({
      engineId: row.engine_id,
      status: row.status,
      lastSeenAt: row.last_seen_at,
      journalIntegrity: (row.journal_integrity ?? "UNVERIFIED") as
        | "OK"
        | "UNKNOWN"
        | "UNVERIFIED",
      journalIntegrityAlert: row.journal_integrity_alert ?? false,
      // pending_fills is INTEGER (not BIGINT), but parse defensively in case a
      // driver ever hands back a string.
      pendingFills:
        typeof row.pending_fills === "number"
          ? row.pending_fills
          : Number(row.pending_fills ?? 0) || 0,
    }));
    const running = result.rows.some(
      row =>
        row.status === "ONLINE" &&
        new Date(row.last_seen_at).getTime() >= freshnessCutoffMs
    );
    return { running, engines };
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
