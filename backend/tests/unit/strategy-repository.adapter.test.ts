/** @format */

import {
  StrategyRepositoryAdapter,
  strategyRepositoryAdapter,
} from "../../src/infrastructure/adapters/repositories/strategy-repository.adapter";
import { Strategy, StrategyType, StrategyConfig } from "@trade-bot/shared";
import { databaseLogger as logger } from "../../src/core/logging/context-aware-logger.service";
import { query } from "../../src/database/pool";

// Mock dependencies
jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
  databaseLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
}));

describe("StrategyRepositoryAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initialization", () => {
    it("should create a StrategyRepositoryAdapter instance", () => {
      const adapter = new StrategyRepositoryAdapter();
      expect(adapter).toBeInstanceOf(StrategyRepositoryAdapter);
    });

    it("should export a singleton instance", () => {
      expect(strategyRepositoryAdapter).toBeInstanceOf(
        StrategyRepositoryAdapter
      );
    });
  });

  describe("getStrategies", () => {
    it("should return empty array when no strategies found", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new StrategyRepositoryAdapter();
      const userId = "test-user-id";

      const strategies = await adapter.getStrategies(userId);

      expect(strategies).toEqual([]);
      expect(query).toHaveBeenCalled();
    });

    it("should return strategies for user with valid data", async () => {
      const mockStrategyRows = [
        {
          id: "strategy1",
          user_id: "test-user-id",
          name: "Grid Strategy",
          type: StrategyType.GRID,
          config: JSON.stringify({ symbol: "BTC-USD", gridSize: 5 }),
          active: true,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "strategy2",
          user_id: "test-user-id",
          name: "Trend Following",
          type: StrategyType.TREND_FOLLOWING,
          config: JSON.stringify({ symbol: "ETH-USD", movingAverage: 20 }),
          active: false,
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ];
      (query as jest.Mock).mockResolvedValue({ rows: mockStrategyRows });
      const adapter = new StrategyRepositoryAdapter();
      const userId = "test-user-id";

      const strategies = await adapter.getStrategies(userId);

      expect(strategies).toHaveLength(2);
      expect(strategies[0]).toEqual(
        expect.objectContaining({
          id: "strategy1",
          userId: "test-user-id",
          name: "Grid Strategy",
          type: StrategyType.GRID,
          config: { symbol: "BTC-USD", gridSize: 5 },
          active: true,
        })
      );
      expect(strategies[1]).toEqual(
        expect.objectContaining({
          id: "strategy2",
          userId: "test-user-id",
          name: "Trend Following",
          type: StrategyType.TREND_FOLLOWING,
          config: { symbol: "ETH-USD", movingAverage: 20 },
          active: false,
        })
      );
    });

    it("should filter out invalid strategies", async () => {
      const mockStrategyRows = [
        {
          id: "invalid-strategy",
          user_id: "test-user-id",
          name: "",
          type: "INVALID_TYPE" as StrategyType,
          config: "invalid-json",
          active: true,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ];
      (query as jest.Mock).mockResolvedValue({ rows: mockStrategyRows });
      const adapter = new StrategyRepositoryAdapter();
      const userId = "test-user-id";

      const strategies = await adapter.getStrategies(userId);

      expect(strategies).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should throw error when query fails", async () => {
      (query as jest.Mock).mockRejectedValue(
        new Error("Database connection error")
      );
      const adapter = new StrategyRepositoryAdapter();
      const userId = "test-user-id";

      await expect(adapter.getStrategies(userId)).rejects.toThrow(
        "Failed to get strategies"
      );
    });
  });

  describe("getStrategy", () => {
    it("should return null when strategy not found", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "non-existent-id";

      const strategy = await adapter.getStrategy(strategyId);

      expect(strategy).toBeNull();
      expect(query).toHaveBeenCalled();
    });

    it("should return strategy when found", async () => {
      const mockStrategyRow = {
        id: "strategy1",
        user_id: "test-user-id",
        name: "Grid Strategy",
        type: StrategyType.GRID,
        config: JSON.stringify({ symbol: "BTC-USD", gridSize: 5 }),
        active: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };
      (query as jest.Mock).mockResolvedValue({ rows: [mockStrategyRow] });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";

      const strategy = await adapter.getStrategy(strategyId);

      expect(strategy).toEqual(
        expect.objectContaining({
          id: "strategy1",
          userId: "test-user-id",
          name: "Grid Strategy",
          type: StrategyType.GRID,
          config: { symbol: "BTC-USD", gridSize: 5 },
          active: true,
        })
      );
    });

    it("should return null for invalid strategy", async () => {
      const mockStrategyRow = {
        id: "invalid-strategy",
        user_id: "test-user-id",
        name: "",
        type: "INVALID_TYPE" as StrategyType,
        config: "invalid-json",
        active: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };
      (query as jest.Mock).mockResolvedValue({ rows: [mockStrategyRow] });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "invalid-strategy";

      const strategy = await adapter.getStrategy(strategyId);

      expect(strategy).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("should throw error when query fails", async () => {
      (query as jest.Mock).mockRejectedValue(new Error("Query failed"));
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";

      await expect(adapter.getStrategy(strategyId)).rejects.toThrow(
        "Failed to get strategy"
      );
    });
  });

  describe("createStrategy", () => {
    it("should create a new strategy", async () => {
      const strategyData = {
        userId: "test-user-id",
        name: "New Strategy",
        type: StrategyType.GRID,
        exchange: "kodiak" as const,
        environment: "mainnet" as const,
        config: { symbol: "BTC-USD", gridSize: 5 },
        active: true,
      };
      const mockResult = {
        rows: [
          {
            id: "new-strategy-id",
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      };
      (query as jest.Mock).mockResolvedValue(mockResult);
      const adapter = new StrategyRepositoryAdapter();

      const strategy = await adapter.createStrategy(strategyData);

      expect(strategy).toEqual(
        expect.objectContaining({
          id: "new-strategy-id",
          ...strategyData,
        })
      );
      expect(query).toHaveBeenCalledWith(
        "INSERT INTO strategies (user_id, name, type, exchange, environment, config, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id, created_at, updated_at",
        [
          strategyData.userId,
          strategyData.name,
          strategyData.type,
          strategyData.exchange,
          strategyData.environment,
          JSON.stringify(strategyData.config),
          strategyData.active,
        ]
      );
    });

    it("resolves an omitted active flag to false instead of storing NULL", async () => {
      // The CREATE route validates with a Joi schema that has no `active` key, so
      // the value reaching this adapter has no `active` at all. Writing that
      // verbatim inserts NULL and bypasses the column's DEFAULT FALSE — which is
      // what the two `active = NULL` pre-existing strategy rows came from.
      const strategyData = {
        userId: "test-user-id",
        name: "Fresh Strategy",
        type: StrategyType.GRID,
        exchange: "lighter",
        environment: "testnet",
        config: { symbol: "BTC-USD", gridSize: 5 },
      } as unknown as Parameters<
        StrategyRepositoryAdapter["createStrategy"]
      >[0];
      (query as jest.Mock).mockResolvedValue({
        rows: [
          {
            id: "new-strategy-id",
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      });
      const adapter = new StrategyRepositoryAdapter();

      const strategy = await adapter.createStrategy(strategyData);

      expect(query).toHaveBeenCalledWith(
        "INSERT INTO strategies (user_id, name, type, exchange, environment, config, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id, created_at, updated_at",
        [
          "test-user-id",
          "Fresh Strategy",
          StrategyType.GRID,
          "lighter",
          "testnet",
          JSON.stringify({ symbol: "BTC-USD", gridSize: 5 }),
          false,
        ]
      );
      expect(strategy.active).toBe(false);
    });

    it("should throw error when creation fails", async () => {
      const strategyData = {
        userId: "test-user-id",
        name: "New Strategy",
        type: StrategyType.GRID,
        exchange: "kodiak" as const,
        environment: "mainnet" as const,
        config: { symbol: "BTC-USD", gridSize: 5 },
        active: true,
      };
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new StrategyRepositoryAdapter();

      await expect(adapter.createStrategy(strategyData)).rejects.toThrow(
        "Strategy creation failed"
      );
    });

    it("should throw error when query fails", async () => {
      const strategyData = {
        userId: "test-user-id",
        name: "New Strategy",
        type: StrategyType.GRID,
        exchange: "kodiak" as const,
        environment: "mainnet" as const,
        config: { symbol: "BTC-USD", gridSize: 5 },
        active: true,
      };
      (query as jest.Mock).mockRejectedValue(new Error("Database error"));
      const adapter = new StrategyRepositoryAdapter();

      await expect(adapter.createStrategy(strategyData)).rejects.toThrow(
        "Failed to create strategy"
      );
    });
  });

  describe("updateStrategy", () => {
    it("should write the full replacement and strip smuggled venue keys", async () => {
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";
      const updates = {
        name: "Updated",
        type: StrategyType.GRID,
        config: {
          symbol: "BTC",
          gridSize: 10,
          gridRange: 5,
          orderQuantity: 1,
          exchange: "kodiak",
        } as unknown as StrategyConfig,
        exchange: "lighter" as const,
        environment: "testnet" as const,
      };
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await adapter.updateStrategy(strategyId, updates);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE strategies SET"),
        expect.arrayContaining([
          "Updated",
          "GRID",
          "lighter",
          "testnet",
          expect.not.stringContaining("kodiak"),
          strategyId,
        ])
      );
      expect(logger.info).toHaveBeenCalledWith(
        `Strategy updated for strategy ${strategyId}`
      );
    });

    it("should 400 when the venue pair is half-supplied", async () => {
      const adapter = new StrategyRepositoryAdapter();
      await expect(
        adapter.updateStrategy("strategy1", {
          name: "Bad",
          type: StrategyType.GRID,
          config: { symbol: "BTC" },
          exchange: "lighter",
          environment: undefined as unknown as "testnet",
        })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(query).not.toHaveBeenCalledWith(
        expect.stringContaining("UPDATE strategies SET"),
        expect.anything()
      );
    });

    it("should throw error when update fails", async () => {
      const errorMessage = "Update failed";
      const mockLoggerInfo = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {
          throw new Error(errorMessage);
        });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";
      const updates = {
        name: "Updated",
        type: StrategyType.GRID,
        config: { symbol: "BTC", gridSize: 10, gridRange: 5, orderQuantity: 1 },
        exchange: "lighter" as const,
        environment: "testnet" as const,
      };

      await expect(adapter.updateStrategy(strategyId, updates)).rejects.toThrow(
        "Failed to update strategy"
      );

      mockLoggerInfo.mockRestore();
    });
  });

  describe("deleteStrategy", () => {
    it("should delete strategy when it exists", async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";

      await adapter.deleteStrategy(strategyId);

      expect(query).toHaveBeenCalledWith(
        "DELETE FROM strategies WHERE id = $1",
        [strategyId]
      );
    });

    it("should throw error when strategy not found", async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "non-existent-id";

      await expect(adapter.deleteStrategy(strategyId)).rejects.toThrow(
        "Strategy not found"
      );
    });

    it("should throw error when query fails", async () => {
      (query as jest.Mock).mockRejectedValue(new Error("Database error"));
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";

      await expect(adapter.deleteStrategy(strategyId)).rejects.toThrow(
        "Failed to delete strategy"
      );
    });
  });

  describe("toggleStrategy", () => {
    it("should toggle strategy active status when it exists", async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";
      const active = true;

      await adapter.toggleStrategy(strategyId, active);

      expect(query).toHaveBeenCalledWith(
        "UPDATE strategies SET active = $1, updated_at = NOW() WHERE id = $2",
        [active, strategyId]
      );
    });

    it("should throw error when strategy not found", async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "non-existent-id";
      const active = true;

      await expect(adapter.toggleStrategy(strategyId, active)).rejects.toThrow(
        "Strategy not found"
      );
    });

    it("should throw error when query fails", async () => {
      (query as jest.Mock).mockRejectedValue(new Error("Database error"));
      const adapter = new StrategyRepositoryAdapter();
      const strategyId = "strategy1";
      const active = true;

      await expect(adapter.toggleStrategy(strategyId, active)).rejects.toThrow(
        "Failed to toggle strategy"
      );
    });
  });

  describe("getStrategyFillTotals (Phase 1 ledger aggregate)", () => {
    // node-postgres returns DECIMAL/NUMERIC/BIGINT as STRINGS — the documented
    // `total_pnl` toFixed crash class. The adapter is the single mapping
    // boundary: these mocks mimic the wire, the assertions pin the coercion.
    const stringyRow = {
      total_fills: "5",
      known_pnl_fills: "3",
      unknown_pnl_fills: "2",
      realized_pnl: "12.50000000",
      winning_fills: "2",
      losing_fills: "1",
      best_fill: "10.25000000",
      worst_fill: "-1.75000000",
      total_fees: "0.84000000",
      known_fee_fills: "4",
      unknown_fee_fills: "1",
      first_fill_at: "2026-10-01T10:00:00.000Z",
      last_fill_at: "2026-10-12T10:00:00.000Z",
    };

    it("coerces every stringified DECIMAL/BIGINT to a number", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [stringyRow] });
      const adapter = new StrategyRepositoryAdapter();

      const totals = await adapter.getStrategyFillTotals("strategy1");

      expect(totals).toEqual({
        totalFills: 5,
        knownPnlFills: 3,
        unknownPnlFills: 2,
        realizedPnl: 12.5,
        winningFills: 2,
        losingFills: 1,
        bestFill: 10.25,
        worstFill: -1.75,
        totalFees: 0.84,
        knownFeeFills: 4,
        unknownFeeFills: 1,
        firstFillAt: "2026-10-01T10:00:00.000Z",
        lastFillAt: "2026-10-12T10:00:00.000Z",
      });
      // typeof guards — a lingering string is the toFixed-crash shape.
      expect(typeof totals.realizedPnl).toBe("number");
      expect(typeof totals.totalFills).toBe("number");
    });

    it("scopes the aggregate to the strategy and counts unknown pnl", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [stringyRow] });
      const adapter = new StrategyRepositoryAdapter();

      await adapter.getStrategyFillTotals("strategy1");

      const [sql, params] = (query as jest.Mock).mock.calls[0];
      expect(sql).toContain("FROM bot_trade_fills");
      expect(sql).toContain("WHERE strategy_id = $1");
      // F2 honesty lives in SQL: the sum covers known pnl only, unknowns are
      // counted separately so the reader can flag incompleteness.
      expect(sql).toContain("COUNT(*) FILTER (WHERE pnl IS NULL)");
      expect(sql).toContain("SUM(pnl)");
      expect(params).toEqual(["strategy1"]);
    });

    it("maps the empty-ledger aggregates to zeros and nulls (never fabricated 0 best/worst)", async () => {
      // PostgreSQL returns one row of NULL aggregates for zero matching rows.
      (query as jest.Mock).mockResolvedValue({
        rows: [
          {
            total_fills: "0",
            known_pnl_fills: "0",
            unknown_pnl_fills: "0",
            realized_pnl: "0",
            winning_fills: "0",
            losing_fills: "0",
            best_fill: null,
            worst_fill: null,
            total_fees: "0",
            known_fee_fills: "0",
            unknown_fee_fills: "0",
            first_fill_at: null,
            last_fill_at: null,
          },
        ],
      });
      const adapter = new StrategyRepositoryAdapter();

      const totals = await adapter.getStrategyFillTotals("strategy1");

      expect(totals.totalFills).toBe(0);
      expect(totals.realizedPnl).toBe(0);
      // A null best/worst must stay null — 0 would read as "breakeven fill".
      expect(totals.bestFill).toBeNull();
      expect(totals.worstFill).toBeNull();
      expect(totals.firstFillAt).toBeNull();
      expect(totals.lastFillAt).toBeNull();
    });

    it("fails loudly when the aggregate returns no row", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new StrategyRepositoryAdapter();

      await expect(
        adapter.getStrategyFillTotals("strategy1")
      ).rejects.toThrow("Failed to get strategy fill totals");
    });

    it("wraps query failures with the adapter's error contract", async () => {
      (query as jest.Mock).mockRejectedValue(new Error("Database error"));
      const adapter = new StrategyRepositoryAdapter();

      await expect(
        adapter.getStrategyFillTotals("strategy1")
      ).rejects.toThrow("Failed to get strategy fill totals");
    });
  });
});
