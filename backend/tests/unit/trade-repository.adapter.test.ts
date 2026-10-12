/** @format */

import {
  TradeRepositoryAdapter,
  tradeRepositoryAdapter,
} from "../../src/infrastructure/adapters/repositories/trade-repository.adapter";
import { Trade, OrderStatus, OrderSide } from "@trade-bot/shared";
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

describe("TradeRepositoryAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initialization", () => {
    it("should create a TradeRepositoryAdapter instance", () => {
      const adapter = new TradeRepositoryAdapter();
      expect(adapter).toBeInstanceOf(TradeRepositoryAdapter);
    });

    it("should export a singleton instance", () => {
      expect(tradeRepositoryAdapter).toBeInstanceOf(TradeRepositoryAdapter);
    });
  });

  describe("getTrades", () => {
    it("should return empty array when no trades found", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";

      const trades = await adapter.getTrades(userId);

      expect(trades).toEqual([]);
      expect(query).toHaveBeenCalled();
    });

    it("should return trades for user with valid data", async () => {
      const mockTradeRows = [
        {
          id: "trade1",
          strategy_id: "strategy1",
          order_id: "order1",
          symbol: "BTC-USD",
          side: OrderSide.BUY,
          quantity: "1.5",
          price: "50000.00",
          fee: "0.1",
          pnl: "50.00",
          executed_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "trade2",
          strategy_id: "strategy2",
          order_id: "order2",
          symbol: "ETH-USD",
          side: OrderSide.SELL,
          quantity: "2.0",
          price: "3000.00",
          fee: "0.05",
          pnl: "-10.00",
          executed_at: "2024-01-02T00:00:00Z",
        },
      ];
      (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";

      const trades = await adapter.getTrades(userId);

      expect(trades).toHaveLength(2);
      expect(trades[0]).toEqual(
        expect.objectContaining({
          id: "trade1",
          userId: "unknown",
          strategyId: "strategy1",
          orderId: "order1",
          symbol: "BTC-USD",
          side: OrderSide.BUY,
          quantity: 1.5,
          price: 50000,
          fee: 0.1,
          pnl: 50,
          status: OrderStatus.FILLED,
        })
      );
      expect(trades[1]).toEqual(
        expect.objectContaining({
          id: "trade2",
          userId: "unknown",
          strategyId: "strategy2",
          orderId: "order2",
          symbol: "ETH-USD",
          side: OrderSide.SELL,
          quantity: 2.0,
          price: 3000,
          fee: 0.05,
          pnl: -10,
          status: OrderStatus.FILLED,
        })
      );
    });

    it("should filter out invalid trades", async () => {
      const mockTradeRows = [
        {
          id: "invalid-trade",
          strategy_id: "strategy1",
          order_id: "order1",
          symbol: "",
          side: "INVALID" as OrderSide,
          quantity: "invalid",
          price: "invalid",
          fee: "invalid",
          pnl: "invalid",
          executed_at: "2024-01-01T00:00:00Z",
        },
      ];
      (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";

      const trades = await adapter.getTrades(userId);

      expect(trades).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should throw error when query fails", async () => {
      (query as jest.Mock).mockRejectedValue(
        new Error("Database connection error")
      );
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";

      await expect(adapter.getTrades(userId)).rejects.toThrow(
        "Failed to get trades"
      );
    });
  });

  describe("getTradesByStrategy", () => {
    it("should return empty array when no trades found for strategy", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";
      const strategyId = "non-existent-strategy";

      const trades = await adapter.getTradesByStrategy(userId, strategyId);

      expect(trades).toEqual([]);
      expect(query).toHaveBeenCalled();
    });

    it("should return trades for specific strategy", async () => {
      const mockTradeRows = [
        {
          id: "trade1",
          strategy_id: "strategy1",
          order_id: "order1",
          symbol: "BTC-USD",
          side: OrderSide.BUY,
          quantity: "1.5",
          price: "50000.00",
          fee: "0.1",
          pnl: "50.00",
          executed_at: "2024-01-01T00:00:00Z",
        },
      ];
      (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";
      const strategyId = "strategy1";

      const trades = await adapter.getTradesByStrategy(userId, strategyId);

      expect(trades).toHaveLength(1);
      expect(trades[0]).toEqual(
        expect.objectContaining({
          id: "trade1",
          userId: "unknown",
          strategyId: "strategy1",
          orderId: "order1",
          symbol: "BTC-USD",
          side: OrderSide.BUY,
          quantity: 1.5,
          price: 50000,
          fee: 0.1,
          pnl: 50,
          status: OrderStatus.FILLED,
        })
      );
    });

    it("should filter out invalid trades for strategy", async () => {
      const mockTradeRows = [
        {
          id: "invalid-trade",
          strategy_id: "strategy1",
          order_id: "order1",
          symbol: "",
          side: "INVALID" as OrderSide,
          quantity: "invalid",
          price: "invalid",
          fee: "invalid",
          pnl: "invalid",
          executed_at: "2024-01-01T00:00:00Z",
        },
      ];
      (query as jest.Mock).mockResolvedValue({ rows: mockTradeRows });
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";
      const strategyId = "strategy1";

      const trades = await adapter.getTradesByStrategy(userId, strategyId);

      expect(trades).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should throw error when query fails", async () => {
      (query as jest.Mock).mockRejectedValue(new Error("Query failed"));
      const adapter = new TradeRepositoryAdapter();
      const userId = "test-user-id";
      const strategyId = "strategy1";

      await expect(
        adapter.getTradesByStrategy(userId, strategyId)
      ).rejects.toThrow("Failed to get trades by strategy");
    });
  });

  describe("createTrade", () => {
    it("should create a new trade", async () => {
      const tradeData = {
        userId: "test-user-id",
        strategyId: "strategy1",
        orderId: "order1",
        symbol: "BTC-USD",
        side: OrderSide.BUY,
        quantity: 1.5,
        price: 50000,
        fee: 0.1,
        pnl: 50,
        status: OrderStatus.FILLED,
      };
      const mockResult = {
        rows: [
          {
            id: "new-trade-id",
            executed_at: "2024-01-01T00:00:00Z",
          },
        ],
      };
      (query as jest.Mock).mockResolvedValue(mockResult);
      const adapter = new TradeRepositoryAdapter();

      const trade = await adapter.createTrade(tradeData);

      expect(trade).toEqual(
        expect.objectContaining({
          id: "new-trade-id",
          ...tradeData,
        })
      );
      expect(query).toHaveBeenCalled();
    });

    it("should throw error when creation fails", async () => {
      const tradeData = {
        userId: "test-user-id",
        strategyId: "strategy1",
        orderId: "order1",
        symbol: "BTC-USD",
        side: OrderSide.BUY,
        quantity: 1.5,
        price: 50000,
        fee: 0.1,
        pnl: 50,
        status: OrderStatus.FILLED,
      };
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new TradeRepositoryAdapter();

      await expect(adapter.createTrade(tradeData)).rejects.toThrow(
        "Trade creation failed"
      );
    });

    it("should throw error when query fails", async () => {
      const tradeData = {
        userId: "test-user-id",
        strategyId: "strategy1",
        orderId: "order1",
        symbol: "BTC-USD",
        side: OrderSide.BUY,
        quantity: 1.5,
        price: 50000,
        fee: 0.1,
        pnl: 50,
        status: OrderStatus.FILLED,
      };
      (query as jest.Mock).mockRejectedValue(new Error("Database error"));
      const adapter = new TradeRepositoryAdapter();

      await expect(adapter.createTrade(tradeData)).rejects.toThrow(
        "Failed to create trade"
      );
    });
  });

  describe("updateTradeStatus", () => {
    it("should update trade status and log information", async () => {
      const adapter = new TradeRepositoryAdapter();
      const tradeId = "trade1";
      const status = OrderStatus.CANCELLED;

      await adapter.updateTradeStatus(tradeId, status);

      expect(logger.info).toHaveBeenCalledWith(
        `Trade status update for trade ${tradeId}: ${status}`
      );
    });

    it("should throw error when update fails", async () => {
      const errorMessage = "Update failed";
      const mockLoggerInfo = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {
          throw new Error(errorMessage);
        });
      const adapter = new TradeRepositoryAdapter();
      const tradeId = "trade1";
      const status = OrderStatus.CANCELLED;

      await expect(adapter.updateTradeStatus(tradeId, status)).rejects.toThrow(
        "Failed to update trade status"
      );

      mockLoggerInfo.mockRestore();
    });
  });

  describe("getTradesFiltered", () => {
    const JOINED_ROW = {
      id: "t1",
      strategy_id: "s1",
      strategy_name: "My Grid",
      bot_id: "b1",
      exchange_account_id: "acc1",
      order_id: "o1",
      symbol: "ETH",
      side: "BUY",
      quantity: "0.01",
      price: "2000.5",
      fee: null,
      pnl: "1.25",
      status: "FILLED",
      executed_at: "2026-10-12T00:00:00.000Z",
    };

    it("scopes by user_id only when no filters are given", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new TradeRepositoryAdapter();

      await adapter.getTradesFiltered("u1");

      const [sql, params] = (query as jest.Mock).mock.calls[0];
      expect(sql).toContain("FROM trades t");
      expect(sql).toContain("LEFT JOIN strategies");
      expect(sql).toContain("LEFT JOIN bot_instances");
      expect(sql).toContain("t.user_id = $1");
      expect(sql).toContain("ORDER BY t.executed_at DESC");
      expect(sql).not.toContain("strategy_id = $2");
      expect(params).toEqual(["u1", 50]);
    });

    it("adds both filter conditions with positional params and respects limit", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      const adapter = new TradeRepositoryAdapter();

      await adapter.getTradesFiltered("u1", {
        strategyId: "s1",
        exchangeAccountId: "acc1",
        limit: 10,
      });

      const [sql, params] = (query as jest.Mock).mock.calls[0];
      expect(sql).toContain("t.strategy_id = $2");
      expect(sql).toContain("bi.exchange_account_id = $3");
      expect(params).toEqual(["u1", "s1", "acc1", 10]);
    });

    it("maps joined rows and preserves NULL fee (unknown, not zero)", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [JOINED_ROW] });
      const adapter = new TradeRepositoryAdapter();

      const rows = await adapter.getTradesFiltered("u1");

      expect(rows).toEqual([
        {
          id: "t1",
          strategyId: "s1",
          strategyName: "My Grid",
          botId: "b1",
          exchangeAccountId: "acc1",
          orderId: "o1",
          symbol: "ETH",
          side: "BUY",
          quantity: 0.01,
          price: 2000.5,
          fee: null,
          pnl: 1.25,
          status: "FILLED",
          executedAt: new Date("2026-10-12T00:00:00.000Z"),
        },
      ]);
    });

    it("keeps unattributed rows as NULL labels (LEFT JOIN semantics)", async () => {
      (query as jest.Mock).mockResolvedValue({
        rows: [
          {
            ...JOINED_ROW,
            strategy_id: null,
            strategy_name: null,
            bot_id: null,
            exchange_account_id: null,
          },
        ],
      });
      const adapter = new TradeRepositoryAdapter();

      const rows = await adapter.getTradesFiltered("u1");

      expect(rows[0].strategyId).toBeNull();
      expect(rows[0].strategyName).toBeNull();
      expect(rows[0].exchangeAccountId).toBeNull();
    });

    it("wraps failures with the get-trades message", async () => {
      (query as jest.Mock).mockRejectedValue(new Error("db down"));
      const adapter = new TradeRepositoryAdapter();

      await expect(adapter.getTradesFiltered("u1")).rejects.toThrow(
        "Failed to get trades: db down"
      );
    });
  });
});
