/** @format */

/**
 * Engine Registry Repository Adapter - engine liveness & authoritative identity,
 * implementing the core `IEngineRegistryRepository` port.
 *
 * Consumes ENGINE_REGISTER / ENGINE_HEARTBEAT events from the engine and
 * maintains the `engine_registry` table:
 * - ENGINE_REGISTER:  upserts the engine with its restart epoch, marks it ONLINE.
 * - ENGINE_HEARTBEAT: refreshes last_seen_at; heartbeat timeout -> OFFLINE.
 *
 * Moved here from `core/bots/engine-registry.service.ts` (dependency inversion
 * — external review P1, 2026-10-15): every engine_registry SQL statement lives
 * in this infrastructure adapter. Core consumes the port; `index.ts` wires
 * this adapter at startup.
 */

import { query, getClient } from "../../../database/pool";
import { databaseLogger as logger } from "../../../core/logging/context-aware-logger.service";
import type { PoolClient } from "pg";
import {
  IEngineRegistryRepository,
  EngineRegistryTx,
} from "../../../core/bots/lifecycle/engine-registry.repository.port";
import type { EngineRegistryRow } from "../../../core/bots/lifecycle/engine-registry.repository.port";

function clientOf(tx: EngineRegistryTx): PoolClient {
  return tx as unknown as PoolClient;
}

export class EngineRegistryRepositoryAdapter implements IEngineRegistryRepository {
  /** Register (or re-register) an engine. */
  async upsertEngine(params: {
    engineId: string;
    epoch: number;
    version: string;
    startedAt: string;
  }): Promise<{ rowCount: number }> {
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
        [params.engineId, params.epoch, params.version, params.startedAt]
      );
      if ((result.rowCount ?? 0) === 0) {
        logger.warn("Stale engine registration ignored (superseded epoch)", {
          engineId: params.engineId,
          incomingEpoch: params.epoch,
        });
      } else {
        logger.info("Engine registered", {
          engineId: params.engineId,
          epoch: params.epoch,
          version: params.version,
        });
      }
      return { rowCount: result.rowCount ?? 0 };
    } catch (error: unknown) {
      logger.error("Failed to register engine", undefined, {
        engineId: params.engineId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Refresh engine liveness on a heartbeat (self-healing upsert). */
  async refreshEngineHeartbeat(params: {
    engineId: string;
    epoch: number;
    version: string;
  }): Promise<boolean> {
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
        [params.engineId, params.epoch, params.version]
      );
      if ((result.rowCount ?? 0) === 0) {
        logger.warn("Heartbeat from stale engine epoch - ignoring", {
          engineId: params.engineId,
          epoch: params.epoch,
        });
        return false;
      }
      return true;
    } catch (error: unknown) {
      logger.error("Failed to process engine heartbeat", undefined, {
        engineId: params.engineId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ===========================================
  // JOURNAL INTEGRITY (F4)
  // ===========================================

  async inTransaction<T>(fn: (tx: EngineRegistryTx) => Promise<T>): Promise<T> {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const result = await fn(client as unknown as EngineRegistryTx);
      await client.query("COMMIT");
      return result;
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

  async lockEngineRow(
    tx: EngineRegistryTx,
    engineId: string
  ): Promise<{
    journal_integrity_alert: boolean;
    last_hb_epoch: number | string;
    last_hb_seq: number | string;
  } | null> {
    const client = clientOf(tx);
    const { rows } = await client.query<{
      journal_integrity_alert: boolean;
      last_hb_epoch: number | string;
      last_hb_seq: number | string;
    }>(
      `SELECT journal_integrity_alert, last_hb_epoch, last_hb_seq
           FROM engine_registry WHERE engine_id = $1 FOR UPDATE`,
      [engineId]
    );
    return rows[0] ?? null;
  }

  async updateJournalIntegrity(
    tx: EngineRegistryTx,
    params: {
      engineId: string;
      isUnknown: boolean;
      isOk: boolean;
      pending: number | null;
      nextEpoch: number | string;
      nextSeq: number | string;
    }
  ): Promise<void> {
    const client = clientOf(tx);
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
      [
        params.engineId,
        params.isUnknown,
        params.isOk,
        params.pending,
        params.nextEpoch,
        params.nextSeq,
      ]
    );
  }

  // ===========================================
  // SELECTION QUERIES
  // ===========================================

  async selectEngineById(engineId: string): Promise<EngineRegistryRow | null> {
    const result = await query<EngineRegistryRow>(
      `SELECT engine_id, epoch, status, version, last_seen_at,
              journal_integrity, journal_integrity_alert, pending_fills,
              journal_unknown_since, last_hb_epoch, last_hb_seq
             FROM engine_registry WHERE engine_id = $1`,
      [engineId]
    );
    return result.rows[0] ?? null;
  }

  async selectAllEngines(): Promise<EngineRegistryRow[]> {
    const result = await query<EngineRegistryRow>(
      `SELECT engine_id, epoch, status, version, last_seen_at,
              journal_integrity, journal_integrity_alert, pending_fills,
              journal_unknown_since, last_hb_epoch, last_hb_seq
             FROM engine_registry
             ORDER BY last_seen_at DESC`
    );
    return result.rows;
  }

  async selectExpiredOnlineEngines(
    olderThanSeconds: number
  ): Promise<EngineRegistryRow[]> {
    const result = await query<EngineRegistryRow>(
      `SELECT engine_id, epoch, status, version, last_seen_at,
              journal_integrity, journal_integrity_alert, pending_fills,
              journal_unknown_since, last_hb_epoch, last_hb_seq
             FROM engine_registry
             WHERE status = 'ONLINE' AND last_seen_at < NOW() - make_interval(secs => $1)`,
      [olderThanSeconds]
    );
    return result.rows;
  }

  async markEngineOffline(engineId: string): Promise<boolean> {
    const result = await query(
      `UPDATE engine_registry
               SET status = 'OFFLINE', updated_at = CURRENT_TIMESTAMP
               WHERE engine_id = $1 AND status = 'ONLINE'`,
      [engineId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async pruneDeadEngines(olderThanSeconds: number): Promise<{
    rowCount: number;
  }> {
    const result = await query(
      `DELETE FROM engine_registry
               WHERE status = 'OFFLINE'
                 AND last_seen_at < NOW() - make_interval(secs => $1)`,
      [olderThanSeconds]
    );
    return { rowCount: result.rowCount ?? 0 };
  }

  async hasLiveEngines(olderThanSeconds: number): Promise<boolean> {
    const result = await query<{ engine_id: string }>(
      `SELECT engine_id FROM engine_registry
              WHERE status = 'ONLINE'
                AND last_seen_at > NOW() - make_interval(secs => $1)
              LIMIT 1`,
      [olderThanSeconds]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async recoverJournalIntegrity(params: {
    engineId: string;
    operatorUserId: string;
    reconciliationRef: string;
  }): Promise<{ recovered: boolean; reason?: string }> {
    const result = await query(
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
      [params.engineId, params.operatorUserId, params.reconciliationRef]
    );
    if ((result.rowCount ?? 0) === 1) {
      return { recovered: true };
    }
    return {
      recovered: false,
      reason: "no active alert, or journal not currently OK and fully drained",
    };
  }
}
