/**
 * Unit tests for the EngineRegistryService (engine liveness + epoch authority)
 *
 * @format
 */

import { createBotEvent } from "@trade-bot/shared";

jest.mock("../../src/core/logging", () => {
  const makeMockLogger = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  });
  return {
    // The service under test binds `logger` through this barrel, so the mock
    // must live here — mocking the implementation file would leave the
    // service holding the real instance.
    contextLogger: makeMockLogger(),
  };
});

import { contextLogger } from "../../src/core/logging";
import {
  IEngineRegistryRepository,
  EngineRegistryRow,
  EngineRegistryTx,
} from "../../src/core/bots/lifecycle/engine-registry.repository.port";
import {
  ENGINE_HEARTBEAT_TIMEOUT_MS,
  ENGINE_DEAD_ROW_RETENTION_MS,
} from "../../src/core/bots/lifecycle/engine-registry.repository.port";
import {
  EngineRegistryService,
  InventoryReconciler,
  UnknownMarker,
} from "../../src/core/bots/engine-registry.service";

const mockLogger = contextLogger as unknown as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

/** Fully-typed pure port double — no SQL, no pool mocks. */
type MockRepository = jest.Mocked<IEngineRegistryRepository>;

function makeMockRepository(): MockRepository {
  return {
    upsertEngine: jest.fn().mockResolvedValue({ rowCount: 1 }),
    refreshEngineHeartbeat: jest.fn().mockResolvedValue(true),
    inTransaction: jest
      .fn()
      .mockImplementation(
        async <T>(fn: (tx: EngineRegistryTx) => Promise<T>): Promise<T> =>
          fn({} as EngineRegistryTx)
      ),
    lockEngineRow: jest.fn().mockResolvedValue(null),
    updateJournalIntegrity: jest.fn().mockResolvedValue(undefined),
    selectEngineById: jest.fn().mockResolvedValue(null),
    recoverJournalIntegrity: jest
      .fn()
      .mockResolvedValue({ recovered: false, reason: "no row" }),
    selectAllEngines: jest.fn().mockResolvedValue([]),
    selectExpiredOnlineEngines: jest.fn().mockResolvedValue([]),
    selectOfflineEngineIdsWithRunningBots: jest.fn().mockResolvedValue([]),
    markEngineOffline: jest.fn().mockResolvedValue(false),
    pruneDeadEngines: jest.fn().mockResolvedValue({ rowCount: 0 }),
    hasLiveEngines: jest.fn().mockResolvedValue(false),
  };
}

/**
 * Wire the port's transactional lock/update for recordJournalIntegrity tests.
 * The service calls these on the REPOSITORY (tx passed as first arg), so stub
 * them at the repository level and record update params — asserting port-call
 * ordering, never SQL strings.
 */
function wireTx(
  repo: jest.Mocked<IEngineRegistryRepository>,
  selectRow: Record<string, unknown> | null
) {
  const updates: Array<{
    engineId: string;
    isUnknown: boolean;
    isOk: boolean;
    pending: number | null;
    nextEpoch: number | string;
    nextSeq: number | string;
  }> = [];
  repo.lockEngineRow.mockImplementation(
    async (_tx: EngineRegistryTx, _engineId: string) =>
      selectRow
        ? {
            journal_integrity_alert: Boolean(selectRow.journal_integrity_alert),
            last_hb_epoch: selectRow.last_hb_epoch as number | string,
            last_hb_seq: selectRow.last_hb_seq as number | string,
          }
        : null
  );
  repo.updateJournalIntegrity.mockImplementation(
    async (
      _tx: EngineRegistryTx,
      params: {
        engineId: string;
        isUnknown: boolean;
        isOk: boolean;
        pending: number | null;
        nextEpoch: number | string;
        nextSeq: number | string;
      }
    ) => {
      updates.push(params);
    }
  );
  return updates;
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
  let mockRepository: MockRepository;
  let markBotsUnknown: jest.Mock;
  let reconcileInventory: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EngineRegistryService();
    mockRepository = makeMockRepository();
    markBotsUnknown = jest.fn().mockResolvedValue(2);
    reconcileInventory = jest.fn().mockResolvedValue({ unlisted: 0, drift: 0 });
    service.setEngineRegistryRepository(mockRepository);
    service.setUnknownMarker(markBotsUnknown as unknown as UnknownMarker);
    service.setInventoryReconciler(
      reconcileInventory as unknown as InventoryReconciler
    );
  });

  describe("handleEngineEvent", () => {
    it("registers an engine from an ENGINE_REGISTER event", async () => {
      mockRepository.upsertEngine.mockResolvedValue({ rowCount: 1 });
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
      expect(mockRepository.upsertEngine).toHaveBeenCalledWith({
        engineId: "engine-1",
        epoch: 3,
        version: "kodiak@1.0.0",
        startedAt: expect.any(String),
      });
    });

    it("processes an ENGINE_HEARTBEAT event (self-healing upsert)", async () => {
      mockRepository.refreshEngineHeartbeat.mockResolvedValue(true);
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
      // Heartbeat refreshes liveness; a lost initial ENGINE_REGISTER
      // self-heals via the port's refresh upsert.
      expect(mockRepository.refreshEngineHeartbeat).toHaveBeenCalledWith({
        engineId: "engine-1",
        epoch: 3,
        version: "kodiak@1.0.0",
      });
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
    it("skips reconciliation for heartbeats from a stale epoch", async () => {
      // Port's refresh returns false -> stale epoch, nothing more to do.
      mockRepository.refreshEngineHeartbeat.mockResolvedValue(false);
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

      expect(mockRepository.refreshEngineHeartbeat).toHaveBeenCalledWith({
        engineId: "engine-1",
        epoch: 2,
        version: "kodiak@1.0.0",
      });
      expect(reconcileInventory).not.toHaveBeenCalled();
    });
  });

  describe("isEngineAuthoritative (fail closed)", () => {
    it("rejects an engine whose epoch is superseded", async () => {
      mockRepository.selectEngineById.mockResolvedValue({
        engine_id: "engine-1",
        epoch: 5,
        status: "ONLINE",
        version: null,
        last_seen_at: new Date(),
      });
      expect(await service.isEngineAuthoritative("engine-1", 4)).toBe(false);
    });

    it("rejects an engine whose event epoch is ahead of the registered epoch", async () => {
      // Invariant is exact match, not "not yet superseded": an event
      // carrying an impossible future epoch is just as untrustworthy.
      mockRepository.selectEngineById.mockResolvedValue({
        engine_id: "engine-1",
        epoch: 5,
        status: "ONLINE",
        version: null,
        last_seen_at: new Date(),
      });
      expect(await service.isEngineAuthoritative("engine-1", 999)).toBe(false);
    });

    it("accepts an engine with a current epoch", async () => {
      mockRepository.selectEngineById.mockResolvedValue({
        engine_id: "engine-1",
        epoch: 5,
        status: "ONLINE",
        version: null,
        last_seen_at: new Date(),
      });
      expect(await service.isEngineAuthoritative("engine-1", 5)).toBe(true);
    });

    it("accepts a registered epoch delivered as a BIGINT string (L21 regression)", async () => {
      // node-postgres returns `engine_registry.epoch` (BIGINT, migration 009) as
      // a string while the engine publishes `engineEpoch` as a JSON number. The
      // former strict `!==` rejected EVERY runtime event as "epoch mismatch",
      // so accepts/failures were dropped and healthy engines were reported as
      // ENGINE_NO_RESPONSE while they kept trading.
      mockRepository.selectEngineById.mockResolvedValue({
        engine_id: "engine-1",
        epoch: "19",
        status: "ONLINE",
        version: null,
        last_seen_at: new Date(),
      });
      expect(await service.isEngineAuthoritative("engine-1", 19)).toBe(true);
    });

    it("still rejects a genuine epoch mismatch when the registered epoch is a string", async () => {
      mockRepository.selectEngineById.mockResolvedValue({
        engine_id: "engine-1",
        epoch: "19",
        status: "ONLINE",
        version: null,
        last_seen_at: new Date(),
      });
      expect(await service.isEngineAuthoritative("engine-1", 20)).toBe(false);
      expect(await service.isEngineAuthoritative("engine-1", 18)).toBe(false);
    });

    it("rejects an OFFLINE engine", async () => {
      mockRepository.selectEngineById.mockResolvedValue({
        engine_id: "engine-1",
        epoch: 5,
        status: "OFFLINE",
        version: null,
        last_seen_at: new Date(),
      });
      expect(await service.isEngineAuthoritative("engine-1")).toBe(false);
    });

    it("rejects an unregistered engine (fail closed)", async () => {
      mockRepository.selectEngineById.mockResolvedValue(null);
      expect(await service.isEngineAuthoritative("unknown-engine", 1)).toBe(
        false
      );
    });

    it("throws on DB failure so the event stays unacked for redelivery", async () => {
      mockRepository.selectEngineById.mockRejectedValue(new Error("db down"));
      await expect(
        service.isEngineAuthoritative("engine-1", 5)
      ).rejects.toThrow("db down");
    });
  });

  describe("stale registration guard", () => {
    it("passes the stale registration through to the port (adapter guards the epoch)", async () => {
      // The epoch-guard clause (WHERE EXCLUDED.epoch >= ...) lives in the
      // adapter now; the service forwards the register payload unchanged.
      // A superseded epoch matches 0 rows there.
      mockRepository.upsertEngine.mockResolvedValue({ rowCount: 0 });
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

      expect(mockRepository.upsertEngine).toHaveBeenCalledWith({
        engineId: "engine-1",
        epoch: 4,
        version: "kodiak@1.0.0",
        startedAt: expect.any(String),
      });
    });
  });

  describe("heartbeat inventory reconciliation", () => {
    it("reconciles activeBotIds on a successful heartbeat", async () => {
      mockRepository.refreshEngineHeartbeat.mockResolvedValue(true);
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

      expect(reconcileInventory).toHaveBeenCalledWith("engine-1", ["b1"]);
    });

    it("does not reconcile heartbeats from a stale epoch", async () => {
      mockRepository.refreshEngineHeartbeat.mockResolvedValue(false);
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

      expect(reconcileInventory).not.toHaveBeenCalled();
    });
  });

  describe("sweepOfflineEngines", () => {
    const expiredRow = (overrides: Record<string, unknown> = {}) =>
      ({
        engine_id: "engine-1",
        epoch: 3,
        status: "ONLINE",
        version: null,
        last_seen_at: new Date(),
        ...overrides,
      }) as EngineRegistryRow;

    it("marks expired engines OFFLINE and marks their RUNNING bots UNKNOWN", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([
        expiredRow(),
      ]);
      mockRepository.markEngineOffline.mockResolvedValue(true);

      const marked = await service.sweepOfflineEngines();

      expect(marked).toBe(1);
      expect(mockRepository.selectExpiredOnlineEngines).toHaveBeenCalledWith(
        ENGINE_HEARTBEAT_TIMEOUT_MS / 1000
      );
      expect(mockRepository.markEngineOffline).toHaveBeenCalledWith("engine-1");
      expect(markBotsUnknown).toHaveBeenCalledWith("engine-1");
    });

    it("does not double-mark an engine whose claim loses the race", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([
        expiredRow(),
      ]);
      // The OFFLINE claim loses the race.
      mockRepository.markEngineOffline.mockResolvedValue(false);

      const marked = await service.sweepOfflineEngines();

      expect(marked).toBe(0);
      expect(markBotsUnknown).not.toHaveBeenCalled();
    });

    it("prunes dead OFFLINE rows past retention without affecting the marked count", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([]);
      mockRepository.pruneDeadEngines.mockResolvedValue({ rowCount: 2 });

      const marked = await service.sweepOfflineEngines();

      expect(marked).toBe(0);
      expect(mockRepository.pruneDeadEngines).toHaveBeenCalledWith(
        ENGINE_DEAD_ROW_RETENTION_MS / 1000
      );
    });

    it("keeps sweeping when the prune DELETE fails", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([
        expiredRow(),
      ]);
      mockRepository.markEngineOffline.mockResolvedValue(true);
      mockRepository.pruneDeadEngines.mockRejectedValue(
        new Error("prune boom")
      );

      const marked = await service.sweepOfflineEngines();

      // The mark still succeeds; the prune failure is logged, not thrown.
      expect(marked).toBe(1);
      expect(markBotsUnknown).toHaveBeenCalledWith("engine-1");
    });

    it("isolates a failed UNKNOWN transition: later engines and the prune still run", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([
        expiredRow({ engine_id: "engine-1" }),
        expiredRow({ engine_id: "engine-2" }),
      ]);
      mockRepository.markEngineOffline.mockResolvedValue(true);
      mockRepository.pruneDeadEngines.mockResolvedValue({ rowCount: 1 });
      markBotsUnknown.mockImplementation((engineId: string) =>
        engineId === "engine-1"
          ? Promise.reject(new Error("marker boom"))
          : Promise.resolve()
      );

      const marked = await service.sweepOfflineEngines();

      // Neither engine's claim is rolled back, and the failure of the first
      // marker must not strand the second engine or skip the prune.
      expect(marked).toBe(2);
      expect(markBotsUnknown).toHaveBeenCalledWith("engine-1");
      expect(markBotsUnknown).toHaveBeenCalledWith("engine-2");
      expect(mockRepository.pruneDeadEngines).toHaveBeenCalledWith(
        ENGINE_DEAD_ROW_RETENTION_MS / 1000
      );
    });

    it("keeps the marked count when the UNKNOWN transition fails on the only engine", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([
        expiredRow(),
      ]);
      mockRepository.markEngineOffline.mockResolvedValue(true);
      mockRepository.pruneDeadEngines.mockResolvedValue({ rowCount: 0 });
      markBotsUnknown.mockRejectedValue(new Error("marker boom"));

      const marked = await service.sweepOfflineEngines();

      // The OFFLINE claim succeeded, so the engine counts; the marker
      // failure is logged, not thrown (same contract as the prune failure).
      expect(marked).toBe(1);
      expect(mockRepository.pruneDeadEngines).toHaveBeenCalled();
    });

    it("repairs stranded RUNNING bots of an already-OFFLINE engine", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([]);
      mockRepository.selectOfflineEngineIdsWithRunningBots.mockResolvedValue([
        "engine-stranded",
      ]);
      mockRepository.pruneDeadEngines.mockResolvedValue({ rowCount: 0 });

      const marked = await service.sweepOfflineEngines();

      // The repair does not inflate the sweep's marked count (no new OFFLINE
      // claim happened); it re-drives the marker for the stranded engine.
      expect(marked).toBe(0);
      expect(markBotsUnknown).toHaveBeenCalledWith("engine-stranded");
    });

    it("runs the repair pass even when the main loop marked nothing and isolates its failures", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([
        expiredRow(),
      ]);
      mockRepository.markEngineOffline.mockResolvedValue(false); // lost the claim
      mockRepository.selectOfflineEngineIdsWithRunningBots.mockResolvedValue([
        "engine-stranded",
      ]);
      mockRepository.pruneDeadEngines.mockResolvedValue({ rowCount: 0 });
      markBotsUnknown.mockRejectedValue(new Error("marker boom"));

      const marked = await service.sweepOfflineEngines();

      // The repair failure is logged, not thrown; the sweep completes.
      expect(marked).toBe(0);
      expect(markBotsUnknown).toHaveBeenCalledWith("engine-stranded");
      expect(mockRepository.pruneDeadEngines).toHaveBeenCalled();
    });

    it("keeps sweeping when the stranded-engine repair query itself fails", async () => {
      mockRepository.selectExpiredOnlineEngines.mockResolvedValue([]);
      mockRepository.selectOfflineEngineIdsWithRunningBots.mockRejectedValue(
        new Error("repair query boom")
      );
      mockRepository.pruneDeadEngines.mockResolvedValue({ rowCount: 1 });

      const marked = await service.sweepOfflineEngines();

      expect(marked).toBe(0);
      expect(mockRepository.pruneDeadEngines).toHaveBeenCalled();
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
      mockRepository.selectAllEngines.mockResolvedValue([engineRow()]);

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(true);
      expect(liveness.engines).toEqual([
        {
          engineId: "engine-1",
          status: "ONLINE",
          lastSeenAt: expect.any(Date),
          // Live: ONLINE with a fresh heartbeat (same predicate as `running`).
          live: true,
          // F4: a row without journal_* columns (pre-025 shape) defaults to
          // UNVERIFIED / no-alert / 0 pending.
          journalIntegrity: "UNVERIFIED",
          journalIntegrityAlert: false,
          pendingFills: 0,
        },
      ]);
    });

    it("is not running when the ONLINE engine's heartbeat is stale (sweep not yet run)", async () => {
      mockRepository.selectAllEngines.mockResolvedValue([
        engineRow({
          last_seen_at: new Date(Date.now() - ENGINE_HEARTBEAT_TIMEOUT_MS * 3),
        }),
      ]);

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(false);
      expect(liveness.engines).toHaveLength(1);
      // Stale ONLINE heartbeat: not live (sweep hasn't flipped it yet, but
      // aggregates must already treat it as dead).
      expect(liveness.engines[0].live).toBe(false);
    });

    it("is not running when the engine is OFFLINE", async () => {
      mockRepository.selectAllEngines.mockResolvedValue([
        engineRow({ status: "OFFLINE" }),
      ]);

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(false);
      expect(liveness.engines[0].live).toBe(false);
    });

    it("is not running when the registry is empty", async () => {
      mockRepository.selectAllEngines.mockResolvedValue([]);

      const liveness = await service.getEngineLiveness();

      expect(liveness.running).toBe(false);
      expect(liveness.engines).toEqual([]);
    });
  });

  describe("journal integrity (F4) - heartbeat ordering", () => {
    // Each heartbeat() first runs the port's liveness refresh; return true
    // so the stale-epoch guard passes and recordJournalIntegrity runs.
    beforeEach(() => {
      mockRepository.refreshEngineHeartbeat.mockResolvedValue(true);
    });

    it("advances the (epoch, seq) pair together when the epoch advances (seq resets)", async () => {
      // Stored (7, 500); a restarted process sends (8, 1). The pair must move
      // as a unit -> last_hb_epoch=8, last_hb_seq=1 (NOT GREATEST keeping 500).
      const updates = wireTx(mockRepository, {
        journal_integrity_alert: false,
        last_hb_epoch: "7",
        last_hb_seq: "500",
      });

      await service.handleEngineEvent(
        heartbeatEvent({
          heartbeatSeq: 1,
          epoch: 8,
          pendingFillsUnknown: false,
        })
      );

      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ nextEpoch: 8, nextSeq: 1 });
    });

    it("accepts subsequent heartbeats after an epoch reset (8,2)", async () => {
      const updates = wireTx(mockRepository, {
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });

      await service.handleEngineEvent(
        heartbeatEvent({
          heartbeatSeq: 2,
          epoch: 8,
          pendingFillsUnknown: false,
        })
      );

      expect(updates).toHaveLength(1);
      expect(updates[0].nextSeq).toBe(2);
    });

    it("treats an equal (epoch, seq) as a duplicate and does NOT reapply the payload", async () => {
      const updates = wireTx(mockRepository, {
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "5",
      });

      await service.handleEngineEvent(
        // Same pair as stored, but a DIFFERENT (conflicting) integrity signal.
        heartbeatEvent({ heartbeatSeq: 5, epoch: 8, pendingFillsUnknown: true })
      );

      expect(updates).toHaveLength(0);
    });

    it("drops a same-epoch older sequence", async () => {
      const updates = wireTx(mockRepository, {
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "10",
      });

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 3, epoch: 8, pendingFillsUnknown: true })
      );

      expect(updates).toHaveLength(0);
    });

    it("drops a heartbeat from an older (superseded) epoch", async () => {
      const updates = wireTx(mockRepository, {
        journal_integrity_alert: false,
        last_hb_epoch: "9",
        last_hb_seq: "2",
      });

      await service.handleEngineEvent(
        heartbeatEvent({
          heartbeatSeq: 999,
          epoch: 8,
          pendingFillsUnknown: true,
        })
      );

      expect(updates).toHaveLength(0);
    });

    it("rejects a heartbeat with no heartbeatSeq for integrity (no write, no lock)", async () => {
      wireTx(mockRepository, null);

      await service.handleEngineEvent(
        heartbeatEvent({ pendingFillsUnknown: true }) // no heartbeatSeq
      );

      expect(mockRepository.inTransaction).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Engine heartbeat rejected for integrity: missing/invalid heartbeatSeq",
        expect.objectContaining({ engineId: "engine-1" })
      );
    });

    it("rejects a malformed heartbeatSeq (0) without writing", async () => {
      wireTx(mockRepository, null);

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 0, pendingFillsUnknown: true })
      );

      expect(mockRepository.inTransaction).not.toHaveBeenCalled();
    });

    it("rejects a malformed epoch without normalizing to zero", async () => {
      wireTx(mockRepository, null);

      await service.handleEngineEvent(
        heartbeatEvent({
          epoch: -1,
          heartbeatSeq: 1,
          pendingFillsUnknown: true,
        })
      );

      expect(mockRepository.inTransaction).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Engine heartbeat rejected for integrity: invalid epoch",
        expect.objectContaining({ engineId: "engine-1" })
      );
    });
  });

  describe("journal integrity (F4) - alert edge & stickiness", () => {
    beforeEach(() => {
      mockRepository.refreshEngineHeartbeat.mockResolvedValue(true);
    });

    it("raises the sticky alert and logs the UNKNOWN error exactly once on the edge", async () => {
      const updates = wireTx(mockRepository, {
        journal_integrity_alert: false,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 2, epoch: 8, pendingFillsUnknown: true })
      );

      const upd = updates[0];
      expect(upd).toBeDefined();
      expect(upd.isUnknown).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Engine fill-journal integrity UNKNOWN - operator reconciliation required",
        undefined,
        expect.objectContaining({ engineId: "engine-1" })
      );
    });

    it("does NOT re-log when the alert is already raised (wasAlerted true)", async () => {
      wireTx(mockRepository, {
        journal_integrity_alert: true,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });

      await service.handleEngineEvent(
        heartbeatEvent({ heartbeatSeq: 2, epoch: 8, pendingFillsUnknown: true })
      );

      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("a healthy heartbeat after UNKNOWN retains the sticky alert (does not clear)", async () => {
      const updates = wireTx(mockRepository, {
        journal_integrity_alert: true,
        last_hb_epoch: "8",
        last_hb_seq: "1",
      });

      await service.handleEngineEvent(
        heartbeatEvent({
          heartbeatSeq: 2,
          epoch: 8,
          pendingFillsUnknown: false,
        })
      );

      const upd = updates[0];
      expect(upd).toBeDefined();
      expect(upd.isUnknown).toBe(false);
      expect(upd.isOk).toBe(true);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("a persistence failure is caught in heartbeat() and logged, not thrown", async () => {
      // Port transaction fails after the liveness refresh succeeded.
      mockRepository.inTransaction.mockRejectedValueOnce(new Error("db down"));

      await expect(
        service.handleEngineEvent(
          heartbeatEvent({
            heartbeatSeq: 2,
            epoch: 8,
            pendingFillsUnknown: true,
          })
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
      mockRepository.recoverJournalIntegrity.mockResolvedValue({
        recovered: true,
      });

      const result = await service.recoverJournalIntegrity(
        "engine-1",
        "admin-42",
        "INC-1234"
      );

      expect(result).toEqual({ recovered: true });
      expect(mockRepository.recoverJournalIntegrity).toHaveBeenCalledWith({
        engineId: "engine-1",
        operatorUserId: "admin-42",
        reconciliationRef: "INC-1234",
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Engine fill-journal integrity recovered (operator-attested)",
        expect.objectContaining({
          engineId: "engine-1",
          operatorUserId: "admin-42",
        })
      );
    });

    it("refuses recovery when the conditional update matches no row (rowCount 0)", async () => {
      mockRepository.recoverJournalIntegrity.mockResolvedValue({
        recovered: false,
        reason:
          "no active alert, or journal not currently OK and fully drained",
      });

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
      mockRepository.selectAllEngines.mockResolvedValue([
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
      ]);

      const liveness = await service.getEngineLiveness();

      expect(liveness.engines[0]).toMatchObject({
        engineId: "engine-1",
        journalIntegrity: "UNKNOWN",
        journalIntegrityAlert: true,
        pendingFills: 3,
      });
    });

    it("defaults a pre-025 row to UNVERIFIED / no-alert / 0 pending", async () => {
      mockRepository.selectAllEngines.mockResolvedValue([
        {
          engine_id: "engine-legacy",
          epoch: 1,
          status: "ONLINE",
          version: "v",
          last_seen_at: new Date(),
        },
      ]);

      const liveness = await service.getEngineLiveness();

      expect(liveness.engines[0]).toMatchObject({
        journalIntegrity: "UNVERIFIED",
        journalIntegrityAlert: false,
        pendingFills: 0,
      });
    });
  });
});
