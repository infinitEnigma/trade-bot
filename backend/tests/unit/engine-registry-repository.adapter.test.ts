/**
 * EngineRegistryRepositoryAdapter - SQL ownership.
 *
 * Thin adapter test: the pool is mocked; assertions pin that every
 * `engine_registry` statement lives here (not in core). Behavioural policy
 * (claim-first sweep, epoch normalisation, sticky-alert transitions) is
 * covered by the service suite against port doubles.
 *
 * @format
 */

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
  databaseLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { query, getClient } from "../../src/database/pool";
import { EngineRegistryRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/engine-registry-repository.adapter";

const mockQuery = query as jest.Mock;
const mockGetClient = getClient as unknown as jest.Mock;

describe("EngineRegistryRepositoryAdapter", () => {
  let adapter: EngineRegistryRepositoryAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new EngineRegistryRepositoryAdapter();
  });

  it("upsertEngine guards the epoch (stale re-register matches 0 rows)", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await adapter.upsertEngine({
      engineId: "engine-1",
      epoch: 5,
      version: "v",
      startedAt: new Date().toISOString(),
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO engine_registry");
    expect(sql).toContain("ON CONFLICT (engine_id)");
    expect(sql).toContain("WHERE EXCLUDED.epoch >= engine_registry.epoch");
    expect(params[0]).toBe("engine-1");
    expect(params[1]).toBe(5);
  });

  it("refreshEngineHeartbeat bumps the epoch high-water, never rolls back", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const applied = await adapter.refreshEngineHeartbeat({
      engineId: "engine-1",
      epoch: 3,
      version: "v",
    });

    expect(applied).toBe(true);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "epoch = GREATEST(engine_registry.epoch, EXCLUDED.epoch)"
    );
  });

  it("selectEngineById reads one row by engine id", async () => {
    mockQuery.mockResolvedValue({ rows: [{ engine_id: "engine-1" }] });

    const row = await adapter.selectEngineById("engine-1");

    expect(row).toMatchObject({ engine_id: "engine-1" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM engine_registry WHERE engine_id = $1");
    expect(params).toEqual(["engine-1"]);
  });

  it("lockEngineRow selects FOR UPDATE", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await adapter.lockEngineRow(client as never, "engine-1");

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("FOR UPDATE");
    expect(params).toEqual(["engine-1"]);
  });

  it("updateJournalIntegrity transitions alert state in one statement", async () => {
    const client = { query: jest.fn().mockResolvedValue({}) };

    await adapter.updateJournalIntegrity(client as never, {
      engineId: "engine-1",
      isUnknown: true,
      isOk: false,
      pending: 3,
      nextEpoch: 8,
      nextSeq: 2,
    });

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("UPDATE engine_registry");
    expect(sql).toContain("journal_integrity_alert");
    expect(params).toEqual(["engine-1", true, false, 3, 8, 2]);
  });

  it("inTransaction commits on success and rolls back on failure", async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    mockGetClient.mockResolvedValue(client);

    const result = await adapter.inTransaction(async tx => {
      expect(tx).toBe(client);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "COMMIT");
    expect(client.release).toHaveBeenCalled();

    client.query.mockClear();
    const failing = {
      query: jest.fn(async (sql: string) => {
        if (sql === "BEGIN") return { rows: [] };
        throw new Error("boom");
      }),
      release: jest.fn(),
    };
    mockGetClient.mockResolvedValue(failing);
    await expect(adapter.inTransaction(async () => "never")).rejects.toThrow(
      "boom"
    );
    expect(failing.query).toHaveBeenCalledWith("ROLLBACK");
    expect(failing.release).toHaveBeenCalled();
  });

  it("markEngineOffline claims with an ONLINE guard", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    expect(await adapter.markEngineOffline("engine-1")).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SET status = 'OFFLINE'");
    expect(sql).toContain("AND status = 'ONLINE'");
    expect(params).toEqual(["engine-1"]);
  });

  it("selectExpiredOnlineEngines filters ONLINE past the timeout", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await adapter.selectExpiredOnlineEngines(30);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'ONLINE'");
    expect(sql).toContain("last_seen_at < NOW()");
    expect(params).toEqual([30]);
  });

  it("selectOfflineEngineIdsWithRunningBots joins OFFLINE engines to RUNNING bots", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ engine_id: "engine-1" }, { engine_id: "engine-2" }],
    });

    const ids = await adapter.selectOfflineEngineIdsWithRunningBots();

    expect(ids).toEqual(["engine-1", "engine-2"]);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("JOIN bot_instances");
    expect(sql).toContain("e.status = 'OFFLINE'");
    expect(sql).toContain("b.actual_state = 'RUNNING'");
  });

  it("pruneDeadEngines deletes OFFLINE rows past retention", async () => {
    mockQuery.mockResolvedValue({ rowCount: 2 });

    const pruned = await adapter.pruneDeadEngines(604800);

    expect(pruned).toEqual({ rowCount: 2 });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM engine_registry");
    expect(sql).toContain("status = 'OFFLINE'");
  });

  it("hasLiveEngines probes ONLINE with a fresh heartbeat", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    expect(await adapter.hasLiveEngines(30)).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'ONLINE'");
    expect(sql).toContain("last_seen_at > NOW()");
    expect(sql).toContain("LIMIT 1");
    expect(params).toEqual([30]);
  });

  it("recoverJournalIntegrity only clears an OK, drained, alerted row", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const result = await adapter.recoverJournalIntegrity({
      engineId: "engine-1",
      operatorUserId: "admin-42",
      reconciliationRef: "INC-1234",
    });

    expect(result).toEqual({ recovered: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("journal_integrity_alert = FALSE");
    expect(sql).toContain("journal_integrity = 'OK'");
    expect(sql).toContain("pending_fills = 0");
    expect(sql).toContain("journal_integrity_alert = TRUE");
    expect(params).toEqual(["engine-1", "admin-42", "INC-1234"]);
  });
});
