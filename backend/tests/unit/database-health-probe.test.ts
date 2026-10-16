/** @format */

/**
 * database/health-probe.ts — the `database/`-owned implementation behind the
 * health route's `HealthDbPort` (review P3 Phase 2). The pool module is
 * mocked so the probe's three methods are tested in isolation.
 */

jest.mock("../../src/database/pool", () => ({
  getPool: jest.fn(),
  getPoolMetrics: jest.fn(),
}));

const { getPool, getPoolMetrics } = require("../../src/database/pool");
const { databaseHealth } = require("../../src/database/health-probe");

describe("databaseHealth probe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("ping", () => {
    it("resolves when SELECT 1 succeeds", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ test: 1 }] });
      getPool.mockReturnValue({ query });

      await expect(databaseHealth.ping()).resolves.toBeUndefined();
      expect(query).toHaveBeenCalledWith("SELECT 1");
    });

    it("rejects when the pool query fails (routes map to 503)", async () => {
      const error = new Error("Connection failed");
      getPool.mockReturnValue({
        query: jest.fn().mockRejectedValue(error),
      });

      await expect(databaseHealth.ping()).rejects.toThrow("Connection failed");
    });
  });

  describe("connectionStats", () => {
    it("maps the pg_stat_activity row", async () => {
      const row = {
        total_connections: "5",
        active_connections: "1",
        idle_connections: "4",
      };
      getPool.mockReturnValue({
        query: jest.fn().mockResolvedValue({ rows: [row] }),
      });

      await expect(databaseHealth.connectionStats()).resolves.toEqual(row);
    });

    it("propagates query failures", async () => {
      getPool.mockReturnValue({
        query: jest.fn().mockRejectedValue(new Error("pg down")),
      });

      await expect(databaseHealth.connectionStats()).rejects.toThrow("pg down");
    });
  });

  describe("metrics", () => {
    it("delegates to getPoolMetrics", () => {
      const snapshot = { pool: { totalConnections: 2 } };
      getPoolMetrics.mockReturnValue(snapshot);

      expect(databaseHealth.metrics()).toBe(snapshot);
      expect(getPoolMetrics).toHaveBeenCalledTimes(1);
    });
  });
});
