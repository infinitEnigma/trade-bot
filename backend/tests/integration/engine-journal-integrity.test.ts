/** @format */

/**
 * F4 integration: proves the engine journal-integrity recovery concurrency
 * guarantee against a REAL PostgreSQL instance (row locking + predicate
 * re-evaluation), which a mocked unit test cannot demonstrate.
 *
 * The recovery UPDATE is conditional on `journal_integrity = 'OK' AND
 * pending_fills = 0 AND journal_integrity_alert = TRUE`. Postgres re-evaluates
 * that WHERE against the locked row at execution time, so a concurrent
 * heartbeat that commits `UNKNOWN` first forces the recovery UPDATE to match 0
 * rows -> recovery fails and the sticky alert is retained.
 *
 * Resilient to a missing database (matches the existing integration suite):
 * if Postgres is unreachable or migration 025 has not been applied, the cases
 * log a warning and skip rather than fail.
 */

import { query, getClient } from "../../src/database/pool";
import { PoolClient } from "pg";
import { EngineRegistryService } from "../../src/core/bots/engine-registry.service";
import logger from "../../src/core/logging/logger.service";

jest.mock("../../src/core/logging/logger.service");

describe("Engine journal integrity (F4) - recovery concurrency", () => {
  const engineId = `itest-journal-${Date.now()}`;
  const service = new EngineRegistryService();
  let dbAvailable = false;

  // recordJournalIntegrity is private; the integration test drives the real
  // code path through a cast (the wiring is covered by the unit suite).
  const recordHeartbeat = (payload: Record<string, unknown>) =>
    (service as unknown as {
      recordJournalIntegrity: (p: unknown) => Promise<void>;
    }).recordJournalIntegrity({ engineId, ...payload });

  beforeAll(async () => {
    try {
      // Probe for migration 025 specifically: the cases need the journal_*
      // columns. If Postgres is unreachable OR 025 has not been applied, skip
      // (matches the existing integration suite's resilient convention) rather
      // than fail on a missing column.
      const probe = await query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'engine_registry' AND column_name = 'journal_integrity'`
      );
      dbAvailable = (probe.rowCount ?? 0) > 0;
      if (!dbAvailable) {
        logger.warn(
          "Journal-integrity integration test skipped: migration 025 not applied",
          { engineId }
        );
      }
    } catch (error) {
      logger.warn("Journal-integrity integration test skipped: no database", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    try {
      await query(`DELETE FROM engine_registry WHERE engine_id = $1`, [engineId]);
    } catch {
      /* ignore cleanup errors */
    }
  });

  const skip = () => {
    logger.warn("Journal-integrity case skipped: database unavailable");
  };

  async function seedRow(fields: {
    integrity?: string;
    alert?: boolean;
    pending?: number;
    lastEpoch?: number;
    lastSeq?: number;
  }): Promise<void> {
    await query(
      `INSERT INTO engine_registry
         (engine_id, epoch, status, last_seen_at,
          journal_integrity, journal_integrity_alert, pending_fills,
          last_hb_epoch, last_hb_seq)
       VALUES ($1, 8, 'ONLINE', CURRENT_TIMESTAMP, $2, $3, $4, $5, $6)`,
      [
        engineId,
        fields.integrity ?? "OK",
        fields.alert ?? false,
        fields.pending ?? 0,
        fields.lastEpoch ?? 0,
        fields.lastSeq ?? 0,
      ]
    );
  }

  const readRow = async () => {
    const r = await query(
      `SELECT journal_integrity, journal_integrity_alert, pending_fills,
              journal_unknown_since, journal_recovered_by, journal_recovery_ref
         FROM engine_registry WHERE engine_id = $1`,
      [engineId]
    );
    return r.rows[0] as {
      journal_integrity: string;
      journal_integrity_alert: boolean;
      pending_fills: number;
      journal_unknown_since: Date | null;
      journal_recovered_by: string | null;
      journal_recovery_ref: string | null;
    };
  };

  it("ordering A: a heartbeat that commits UNKNOWN first makes recovery fail", async () => {
    if (!dbAvailable) return skip();
    await seedRow({ integrity: "OK", alert: false, pending: 0, lastEpoch: 8, lastSeq: 1 });

    // A real UNKNOWN heartbeat commits first, raising the sticky alert.
    await recordHeartbeat({ epoch: 8, heartbeatSeq: 2, pendingFillsUnknown: true });
    expect((await readRow()).journal_integrity_alert).toBe(true);

    // Recovery now cannot clear it: the live state is UNKNOWN.
    const res = await service.recoverJournalIntegrity(engineId, "admin-1", "INC-A");
    expect(res.recovered).toBe(false);
    expect((await readRow()).journal_integrity_alert).toBe(true);
  });

  it("ordering B: recovery commits first, a later UNKNOWN heartbeat re-raises the alert", async () => {
    if (!dbAvailable) return skip();
    await seedRow({ integrity: "OK", alert: true, pending: 0, lastEpoch: 8, lastSeq: 1 });

    // Recovery succeeds and stamps the audit fields.
    const res = await service.recoverJournalIntegrity(engineId, "admin-2", "INC-B");
    expect(res.recovered).toBe(true);
    let row = await readRow();
    expect(row.journal_integrity_alert).toBe(false);
    expect(row.journal_recovered_by).toBe("admin-2");
    expect(row.journal_recovery_ref).toBe("INC-B");

    // A subsequent UNKNOWN heartbeat raises the alert again with a fresh since.
    await recordHeartbeat({ epoch: 8, heartbeatSeq: 2, pendingFillsUnknown: true });
    row = await readRow();
    expect(row.journal_integrity_alert).toBe(true);
    expect(row.journal_unknown_since).not.toBeNull();
  });

  it("lock-held interleave: recovery racing a committed UNKNOWN write fails", async () => {
    if (!dbAvailable) return skip();
    await seedRow({ integrity: "OK", alert: true, pending: 0, lastEpoch: 8, lastSeq: 1 });

    const holder: PoolClient = await getClient();
    try {
      await holder.query("BEGIN");
      const lock = await holder.query(
        `SELECT journal_integrity_alert FROM engine_registry
          WHERE engine_id = $1 FOR UPDATE`,
        [engineId]
      );
      expect(lock.rowCount).toBe(1);

      // Kick off recovery on a pool connection; its UPDATE blocks on the lock.
      const recovery = service.recoverJournalIntegrity(engineId, "admin-3", "INC-C");
      // Give the recovery UPDATE time to reach the row and block.
      await new Promise(r => setTimeout(r, 150));

      // The concurrent writer gets there first: commit UNKNOWN, then release.
      await holder.query(
        `UPDATE engine_registry
            SET journal_integrity = 'UNKNOWN', journal_integrity_alert = TRUE,
                last_hb_epoch = 8, last_hb_seq = 2
          WHERE engine_id = $1`,
        [engineId]
      );
      await holder.query("COMMIT");

      // Recovery unblocks; Postgres re-evaluates its WHERE against the now-
      // UNKNOWN row -> 0 rows -> recovery fails, alert retained.
      const res = await recovery;
      expect(res.recovered).toBe(false);
      expect((await readRow()).journal_integrity_alert).toBe(true);
    } finally {
      try {
        await holder.query("ROLLBACK");
      } catch {
        /* already committed */
      }
      holder.release();
    }
  });
});
