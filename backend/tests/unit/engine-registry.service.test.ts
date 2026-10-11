/**
 * Unit tests for the EngineRegistryService (engine liveness + epoch authority)
 *
 * @format
 */

import { createBotEvent } from "@trade-bot/shared";

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
  redisLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock("../../src/core/bots/bot-lifecycle.service", () => ({
  botLifecycleService: {
    markBotsUnknownForEngine: jest.fn().mockResolvedValue(2),
    reconcileHeartbeatInventory: jest
      .fn()
      .mockResolvedValue({ unlisted: 0, drift: 0 }),
  },
}));

import { query, getClient } from "../../src/database/pool";
import { botLifecycleService } from "../../src/core/bots/bot-lifecycle.service";
import { redisLogger } from "../../src/core/logging/context-aware-logger.service";
import {
  ENGINE_HEARTBEAT_TIMEOUT_MS,
  EngineRegistryService,
} from "../../src/core/bots/engine-registry.service";

const mockQuery = query as jest.Mock;
const mockGetClient = getClient as unknown as jest.Mock;
const mockLogger = redisLogger as unknown as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};
const ok = () => ({ rows: [], rowCount: 1 });

/**
 * A fake locked PoolClient for recordJournalIntegrity's transaction. Records
 * every statement so tests can assert the ordering UPDATE's params, and
 * returns the supplied SELECT ... FOR UPDATE row (or none).
 */
function makeLockedClient(selectRow: Record<string, unknown> | null) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const s = String(sql);
      if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (s.includes("FOR UPDATE")) {
        return { rows: selectRow ? [selectRow] : [], rowCount: selectRow ? 1 : 0 };
      }
      if (s.startsWith("UPDATE")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  const updateCall = () => calls.find(c => c.sql.startsWith("UPDATE"));
  return { client, calls, updateCall };
}

function heartbeatEvent(
  payload: Record<string, unknown>,
  correlationId = "corr-hb"
) {
  return createBotEvent(
    "ENGINE_HEARTBEAT",
    {
      engineId: "engine-1",
      epoch: 8,
      activeBotIds: [],
      version: "kodiak@1.0.0",
      ...payload,
    } as never,
    correlationId
  );
}

describe("EngineRegistryService", () => {
  let service: EngineRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EngineRegistryService();
  });

  describe("handleEngineEvent", () => {
    it("registers an engine from an ENGINE_REGISTER event", async () => {
      mockQuery.mockReturnValue(ok());
      const event = createBotEvent(
        "ENGINE_REGISTER",
        {
          engineId: "engine-1",
          epoch: 3,
          version: "kodiak@1.0.0",
          startedAt: new Date().toISOString(),
        },
        "corr-1"
      );

      const handled = await service.handleEngineEvent(event);

      expect(handled).toBe(true);
      const insert = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("INSERT INTO engine_registry")
      );
      expect(insert).toBeDefined();
      expect(insert![1][0]).toBe("engine-1");
      expect(insert![1][1]).toBe(3);
    });

    it("processes an ENGINE_HEARTBEAT event (self-healing upsert)", async () => {
      mockQuery.mockReturnValue(ok());
      const event = createBotEvent(
        "ENGINE_HEARTBEAT",
        {
          engineId: "engine-1",
          epoch: 3,
          activeBotIds: ["b1"],
          version: "kodiak@1.0.0",
        },
        "corr-2"
      );

      const handled = await service.handleEngineEvent(event);

      expect(handled).toBe(true);
      const upsert = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("INSERT INTO engine_registry")
      );
      expect(upsert).toBeDefined();
      // Heartbeat is an upsert (registers an unknown engine), so a lost
      // initial ENGINE_REGISTER self-heals on the first heartbeat.
      expect(String(upsert![0])).toContain("ON CONFLICT (engine_id)");
    });

    it("returns false for non-engine-lifecycle events", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "b1",
          engineId: "e1",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "c1"
      );
      expect(await service.handleEngineEvent(event)).toBe(false);
    });
  });

  describe("heartbeat epoch guards", () => {
    it("rejects heartbeats from a stale epoch (rowCount 0)", async () => {
      mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
      const event = createBotEvent(
        "ENGINE_HEARTBEAT",
        {
          engineId: "engine-1",
          epoch: 2,
          activeBotIds: [],
          version: "kodiak@1.0.0",
        },
        "corr-3"
      );

      await service.handleEngineEvent(event);

      const upsert = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("INSERT INTO engine_registry")
      );
      expect(upsert).toBeDefined();
      // The epoch guard clause keeps a stale heartbeat from refreshing/inserting.
      expect(String(upsert![0])).toContain(
        "WHERE EXCLUDED.epoch >= engine_registry.epoch"
      );
    });
  });

  describe("isEngineAuthoritative (fail closed)", () => {
    it("rejects an engine whose epoch is superseded", async () => {
      mockQuery.mockReturnValue({
        rows: [{ engine_id: "engine-1", epoch: 5, status: "ONLINE" }],
        rowCount: 1,
      });
      expect(await service.isEngineAuthoritative("engine-1", 4)).toBe(false);
    });

    it("rejects an engine whose event epoch is ahead of the registered epoch", async () => {
      // Invariant is exact match, not "not yet superseded": an event
      // carrying an impossible future epoch is just as untrustworthy.
      mockQuery.mockReturnValue({
        rows: [{ engine_id: "engine-1", epoch: 5, status: "ONLINE" }],
        rowCount: 1,
      });
      expect(await service.isEngineAuthoritative("engine-1", 999)).toBe(false);
    });

    it("accepts an engine with a current epoch", async () => {
      mockQuery.mockReturnValue({
        rows: [{ engine_id: "engine-1", epoch: 5, status: "ONLINE" }],
        rowCount: 1,
      });
      expect(await service.isEngineAuthoritative("engine-1", 5)).toBe(true);
    });

    it("accepts a registered epoch delivered as a BIGINT string (L21 regression)", async () => {
      // node-postgres returns `engine_registry.epoch` (BIGINT, migration 009) as
      // a string while the engine publishes `engineEpoch` as a JSON number. The
      // former strict `!==` rejected EVERY runtime event as "epoch mismatch",
      // so accepts/failures were dropped and healthy engines were reported as
      // ENGINE_NO_RESPONSE while they kept trading.
      mockQuery.mockReturnValue({
        rows: [{ engine_id: "engine-1", epoch: "19", status: "ONLINE" }],
        rowCount: 1,
      });
      expect(await service.isEngineAuthoritative("engine-1", 19)).toBe(true);
    });

    it("still rejects a genuine epoch mismatch when the registered epoch is a string", async () => {
      mockQuery.mockReturnValue({
        rows: [{ engine_id: "engine-1", epoch: "19", status: "ONLINE" }],
        rowCount: 1,
      });
      expect(await service.isEngineAuthoritative("engine-1", 20)).toBe(false);
      expect(await service.isEngineAuthoritative("engine-1", 18)).toBe(false);
    });

    it("rejects an OFFLINE engine", async () => {
      mockQuery.mockReturnValue({
        rows: [{ engine_id: "engine-1", epoch: 5, status: "OFFLINE" }],
        rowCount: 1,
      });
      expect(await service.isEngineAuthoritative("engine-1")).toBe(false);
    });

    it("rejects an unregistered engine (fail closed)", async () => {
      mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
      expect(await service.isEngineAuthoritative("unknown-engine", 1)).toBe(
        false
      );
    });

    it("throws on DB failure so the event stays unacked for redelivery", async () => {
      mockQuery.mockRejectedValue(new Error("db down"));
      await expect(
        service.isEngineAuthoritative("engine-1", 5)
      ).rejects.toThrow("db down");
    });
  });

  describe("stale registration guard", () => {
    it("ignores a registration whose epoch is superseded (no resurrection)", async () => {
      // Guarded ON CONFLICT UPDATE matches 0 rows for a stale epoch.
      mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
      const event = createBotEvent(
        "ENGINE_REGISTER",
        {
          engineId: "engine-1",
          epoch: 4,
          version: "kodiak@1.0.0",
          startedAt: new Date().toISOString(),
        },
        "corr-stale"
      );

      await service.handleEngineEvent(event);

      const upsert = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("INSERT INTO engine_registry")
      );
      expect(upsert).toBeDefined();
      // The epoch guard clause keeps stale registers from refreshing the row.
      expect(String(upsert![0])).toContain(
        "WHERE EXCLUDED.epoch >= engine_registry.epoch"
      );
    });
  });

  describe("heartbeat inventory reconciliation", () => {
    it("reconciles activeBotIds on a successful heartbeat", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).includes("ON CONFLICT (engine_id)")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return ok();
      });
      const event = createBotEvent(
        "ENGINE_HEARTBEAT",
        {
          engineId: "engine-1",
          epoch: 3,
          activeBotIds: ["b1"],
          version: "kodiak@1.0.0",
        },
        "corr-4"
      );

      await service.handleEngineEvent(event);

      expect(
        botLifecycleService.reconcileHeartbeatInventory
      ).toHaveBeenCalledWith("engine-1", ["b1"]);
    });

    it("does not reconcile heartbeats from a stale epoch", async () => {
      mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
      const event = createBotEvent(
        "ENGINE_HEARTBEAT",
        {
          engineId: "engine-1",
          epoch: 2,
          activeBotIds: ["b1"],
          version: "kodiak@1.0.0",
        },
        "corr-5"
      );

      await service.handleEngineEvent(event);

      expect(
        botLifecycleService.reconcileHeartbeatInventory
      ).not.toHaveBeenCalled();
    });
  });

  describe("sweepOfflineEngines", () => {
    it("marks expired engines OFFLINE and marks their RUNNING bots UNKNOWN", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (
          String(sql).includes("FROM engine_registry") &&
          String(sql).startsWith("SELECT")
        ) {
          return Promise.resolve({
            rows: [
              {
                engine_id: "engine-1",
                epoch: 3,
                status: "ONLINE",
                version: null,
                last_seen_at: new Date(),
              },
            ],
          });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      const marked = await service.sweepOfflineEngines();

      expect(marked).toBe(1);
      expect(botLifecycleService.markBotsUnknownForEngine).toHaveBeenCalledWith(
        "engine-1"
      );
    });

    it("does not double-mark an engine whose claim loses the race", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (
          String(sql).includes("FROM engine_registry") &&
          String(sql).startsWith("SELECT")
        ) {
          return Promise.resolve({
            rows: [
              {
                engine_id: "engine-1",
                epoch: 3,
                status: "ONLINE",
                version: null,
                last_seen_at: new Date(),
              },
            ],
          });
        }
        // The OFFLINE claim loses the race.
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const marked = await service.sweepOfflineEngines();

      expect(marked).toBe(0);
      expect(
        botLifecycleService.markBotsUnknownForEngine
      ).not.toHaveBeenCalled();
    });
  });

  describe("getEngineLiveness", () => {
    const engineRow = (overrides: Record<string, unknown> = {}) => ({
      engine_id: "engine-1",
      epoch: 3,
      status: "ONLINE",
      version: null,
      last_seen_at: new Date(),
      ...overrides,
    });

    it("is running when an engine is ONLINE with a fresh heartbeat", async () => {
      mockQuery.mockReturnValue({ rows: [engineRow()] });

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(true);
      expect(liveness.engines).toEqual([
        {
          engineId: "engine-1",
          status: "ONLINE",
          lastSeenAt: expect.any(Date),
          // F4: a row without journal_* columns (pre-025 shape) defaults to
          // UNVERIFIED / no-alert / 0 pending.
          journalIntegrity: "UNVERIFIED",
          journalIntegrityAlert: false,
          pendingFills: 0,
        },
      ]);
    });

    it("is not running when the ONLINE engine's heartbeat is stale (sweep not yet run)", async () => {
      mockQuery.mockReturnValue({
        rows: [
          engineRow({
            last_seen_at: new Date(
              Date.now() - ENGINE_HEARTBEAT_TIMEOUT_MS * 3
            ),
          }),
        ],
      });

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(false);
      expect(liveness.engines).toHaveLength(1);
    });

    it("is not running when the engine is OFFLINE", async () => {
      mockQuery.mockReturnValue({ rows: [engineRow({ status: "OFFLINE" })] });

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(false);
    });

    it("is not running when the registry is empty", async () => {
      mockQuery.mockReturnValue({ rows: [] });

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(false);
      expect(liveness.engines).toEqual([]);
    });
  });

  describe("journal integrity (F4) - heartbeat ordering", () => {
    // Each heartbeat() first runs the liveness upsert via `query`; return
    // rowCount 1 so the stale-epoch guard passes and recordJournalIntegrity runs.
    beforeEach(() => {
      mockQuery.mockReturnValue({ rows: [], rowCount: 1 });
    });

    it("advances the (epoch, seq) pair together when the epoch advances (seq resets)", async () => {
      // Stored (7, 500); a restarted process sends (8, 1). The pair must move
      // as a unit -> last_hb_epoch=8, last_hb_seq=1 (NOT GREATEST keeping 500).
      const { client, updateCall } = makeLockedClient({
        journal_integrity_alert: false,
        last_hb_epoch: "7",
        last_hb_seq: "500",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 1, epoch: 8, pendingFillsUnknown: false })
      );

      const upd = updateCall();
      expect(upd).toBeDefined();
      // params: [engineId, isUnknown, isOk, pending, nextEpoch, nextSeq]
      expect(upd!.params?.[4]).toBe(8);
      expect(upd!.params?.[5]).toBe(1);
    });

    it("accepts subsequent heartbeats after an epoch reset (8,2)", async () => {
      const { client, updateCall } = makeLockedClient({
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 2, epoch: 8, pendingFillsUnknown: false })
      );

      expect(updateCall()!.params?.[5]).toBe(2);
    });

    it("treats an equal (epoch, seq) as a duplicate and does NOT reapply the payload", async () => {
      const { client, updateCall } = makeLockedClient({
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "5",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        // Same pair as stored, but a DIFFERENT (conflicting) integrity signal.
        heartbeatEvent({ heartbeatSeq: 5, epoch: 8, pendingFillsUnknown: true })
      );

      expect(updateCall()).toBeUndefined();
    });

    it("drops a same-epoch older sequence", async () => {
      const { client, updateCall } = makeLockedClient({
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "10",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 3, epoch: 8, pendingFillsUnknown: true })
      );

      expect(updateCall()).toBeUndefined();
    });

    it("drops a heartbeat from an older (superseded) epoch", async () => {
      const { client, updateCall } = makeLockedClient({
        journal_integrity_alert: false,
        last_hb_epoch: "9",
        last_hb_seq: "2",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 999, epoch: 8, pendingFillsUnknown: true })
      );

      expect(updateCall()).toBeUndefined();
    });

    it("rejects a heartbeat with no heartbeatSeq for integrity (no write, no lock)", async () => {
      mockGetClient.mockResolvedValue(makeLockedClient(null).client);

      await service.handleEngineEvent(
        heartbeatEvent({ pendingFillsUnknown: true }) // no heartbeatSeq
      );

      expect(mockGetClient).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Engine heartbeat rejected for integrity: missing/invalid heartbeatSeq",
        expect.objectContaining({ engineId: "engine-1" })
      );
    });

    it("rejects a malformed heartbeatSeq (0) without writing", async () => {
      mockGetClient.mockResolvedValue(makeLockedClient(null).client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 0, pendingFillsUnknown: true })
      );

      expect(mockGetClient).not.toHaveBeenCalled();
    });

    it("rejects a malformed epoch without normalizing to zero", async () => {
      mockGetClient.mockResolvedValue(makeLockedClient(null).client);

      await service.handleEngineEvent(
        heartbeatEvent({ epoch: -1, heartbeatSeq: 1, pendingFillsUnknown: true })
      );

      expect(mockGetClient).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Engine heartbeat rejected for integrity: invalid epoch",
        expect.objectContaining({ engineId: "engine-1" })
      );
    });
  });

  describe("journal integrity (F4) - alert edge & stickiness", () => {
    beforeEach(() => {
      mockQuery.mockReturnValue({ rows: [], rowCount: 1 });
    });

    it("raises the sticky alert and logs the UNKNOWN error exactly once on the edge", async () => {
      const { client, updateCall } = makeLockedClient({
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 2, epoch: 8, pendingFillsUnknown: true })
      );

      const upd = updateCall();
      expect(upd).toBeDefined();
      expect(upd!.params?.[1]).toBe(true); // isUnknown
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Engine fill-journal integrity UNKNOWN - operator reconciliation required",
        undefined,
        expect.objectContaining({ engineId: "engine-1" })
      );
    });

    it("does NOT re-log when the alert is already raised (wasAlerted true)", async () => {
      const { client } = makeLockedClient({
        journal_integrity_alert: true,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 2, epoch: 8, pendingFillsUnknown: true })
      );

      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("a healthy heartbeat after UNKNOWN retains the sticky alert (does not clear)", async () => {
      const { client, updateCall } = makeLockedClient({
        journal_integrity_alert: true,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });
      mockGetClient.mockResolvedValue(client);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 2, epoch: 8, pendingFillsUnknown: false })
      );

      const upd = updateCall();
      expect(upd).toBeDefined();
      expect(upd!.params?.[1]).toBe(false); // isUnknown
      expect(upd!.params?.[2]).toBe(true); // isOk
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("a persistence failure is caught in heartbeat() and logged, not thrown", async () => {
      const failing = {
        query: jest.fn(async (sql: string) => {
          if (String(sql) === "BEGIN") return { rows: [], rowCount: 0 };
          if (String(sql).includes("FOR UPDATE")) {
            return {
              rows: [
                { journal_integrity_alert: false, last_hb_epoch: "8", last_hb_seq: "1" },
              ],
              rowCount: 1,
            };
          }
          throw new Error("db down");
        }),
        release: jest.fn(),
      };
      mockGetClient.mockResolvedValue(failing);

      await expect(
        service.handleEngineEvent(
          heartbeatEvent({ heartbeatSeq: 2, epoch: 8, pendingFillsUnknown: true })
        )
      ).resolves.toBe(true);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "FAILED to persist engine journal-integrity signal",
        undefined,
        expect.objectContaining({ engineId: "engine-1", error: "db down" })
      );
    });
  });

  describe("journal integrity (F4) - recovery", () => {
    it("clears the sticky alert atomically and stamps audit fields on success", async () => {
      mockQuery.mockReturnValue({ rows: [], rowCount: 1 });

      const result = await service.recoverJournalIntegrity(
        "engine-1",
        "admin-42",
        "INC-1234"
      );

      expect(result).toEqual({ recovered: true });
      const upd = mockQuery.mock.calls.find(c =>
        String(c[0]).includes("journal_integrity_alert = FALSE")
      );
      expect(upd).toBeDefined();
      expect(String(upd![0])).toContain("journal_integrity = 'OK'");
      expect(String(upd![0])).toContain("pending_fills = 0");
      expect(String(upd![0])).toContain("journal_integrity_alert = TRUE");
      expect(upd![1]).toEqual(["engine-1", "admin-42", "INC-1234"]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Engine fill-journal integrity recovered (operator-attested)",
        expect.objectContaining({ engineId: "engine-1", operatorUserId: "admin-42" })
      );
    });

    it("refuses recovery when the conditional update matches no row (rowCount 0)", async () => {
      mockQuery.mockReturnValue({ rows: [], rowCount: 0 });

      const result = await service.recoverJournalIntegrity(
        "engine-1",
        "admin-42",
        "INC-1234"
      );

      expect(result.recovered).toBe(false);
      expect(result.reason).toMatch(/no active alert|not currently OK/);
    });
  });

  describe("getEngineLiveness journal-integrity fields", () => {
    it("maps per-engine integrity, sticky alert and pending count", async () => {
      mockQuery.mockReturnValue({
        rows: [
          {
            engine_id: "engine-1",
            epoch: 8,
            status: "ONLINE",
            version: "v",
            last_seen_at: new Date(),
            journal_integrity: "UNKNOWN",
            journal_integrity_alert: true,
            pending_fills: 3,
          },
        ],
      });

      const liveness = await service.getEngineLiveness();

      expect(liveness.engines[0]).toMatchObject({
        engineId: "engine-1",
        journalIntegrity: "UNKNOWN",
        journalIntegrityAlert: true,
        pendingFills: 3,
      });
    });

    it("defaults a pre-025 row to UNVERIFIED / no-alert / 0 pending", async () => {
      mockQuery.mockReturnValue({
        rows: [
          {
            engine_id: "engine-legacy",
            epoch: 1,
            status: "ONLINE",
            version: "v",
            last_seen_at: new Date(),
          },
        ],
      });

      const liveness = await service.getEngineLiveness();

      expect(liveness.engines[0]).toMatchObject({
        journalIntegrity: "UNVERIFIED",
        journalIntegrityAlert: false,
        pendingFills: 0,
      });
    });
  });
});
