/**
 * TradeLedgerService - durable financial-state ingest (Phase 4 / N7).
 *
 * The repository is mocked; assertions are about validation, status mapping,
 * outcome handling and the throw-vs-swallow error policy the event consumer
 * depends on (throw → redelivery; swallow → ACK).
 *
 * @format
 */

import { BotEvent, createBotEvent, isBotEvent } from "@trade-bot/shared";

jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock("../../src/core/strategies/trade-ledger.repository", () => ({
  TradeLedgerRepository: jest.fn(),
}));

import { TradeLedgerService } from "../../src/core/strategies/trade-ledger.service";
import {
  LedgerFill,
  LedgerIntent,
  LedgerPerformance,
  LedgerPosition,
} from "../../src/core/strategies/trade-ledger.repository";

type MockRepo = {
  recordFill: jest.Mock;
  upsertIntent: jest.Mock;
  upsertPosition: jest.Mock;
  upsertPerformance: jest.Mock;
};

function makeRepo(): MockRepo {
  return {
    recordFill: jest.fn().mockResolvedValue("INSERTED"),
    upsertIntent: jest.fn().mockResolvedValue(true),
    upsertPosition: jest.fn().mockResolvedValue(true),
    upsertPerformance: jest.fn().mockResolvedValue(true),
  };
}

const BASE = {
  botId: "11111111-1111-1111-1111-111111111111",
  engineId: "engine-1",
  engineEpoch: 7,
};

function tradeEvent(
  overrides: Record<string, unknown> = {},
  type = "TRADE_EXECUTED"
): BotEvent {
  return createBotEvent(
    type as "TRADE_EXECUTED",
    {
      ...BASE,
      symbol: "ETH",
      side: "BUY",
      price: 100,
      quantity: 1,
      pnl: 2.5,
      status: "FILLED",
      clientOrderId: "bot1-00-B",
      exchangeOrderId: "idx-1",
      fillId: "sha1",
      executedAt: "2026-10-02T10:00:00.000Z",
      ...overrides,
    },
    "corr-ledger-1"
  );
}

describe("TradeLedgerService", () => {
  let repo: MockRepo;
  let service: TradeLedgerService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = makeRepo();
    service = new TradeLedgerService(
      repo as unknown as jest.Mocked<MockRepo> as never
    );
  });

  describe("TRADE_EXECUTED", () => {
    it("persists a valid fill with the narrowed status", async () => {
      await service.handle(tradeEvent());

      expect(repo.recordFill).toHaveBeenCalledTimes(1);
      const fill = repo.recordFill.mock.calls[0][0] as LedgerFill;
      expect(fill).toEqual({
        botId: BASE.botId,
        clientOrderId: "bot1-00-B",
        exchangeOrderId: "idx-1",
        fillId: "sha1",
        symbol: "ETH",
        side: "BUY",
        quantity: 1,
        price: 100,
        fee: 0,
        pnl: 2.5,
        status: "FILLED",
        executedAt: "2026-10-02T10:00:00.000Z",
      });
    });

    it("maps PARTIALLY_FILLED to the CHECK-allowed PARTIAL (N7 vocabulary)", async () => {
      await service.handle(tradeEvent({ status: "PARTIALLY_FILLED" }));

      const fill = repo.recordFill.mock.calls[0][0] as LedgerFill;
      expect(fill.status).toBe("PARTIAL");
    });

    it("swallows a DUPLICATE (idempotent replay) without throwing", async () => {
      repo.recordFill.mockResolvedValue("DUPLICATE");
      await expect(service.handle(tradeEvent())).resolves.toBeUndefined();
      expect(repo.recordFill).toHaveBeenCalledTimes(1);
    });

    it("swallows UNKNOWN_BOT (identity resolved server-side)", async () => {
      repo.recordFill.mockResolvedValue("UNKNOWN_BOT");
      await expect(service.handle(tradeEvent())).resolves.toBeUndefined();
    });

    it("rejects a malformed payload without touching the repository", async () => {
      await expect(
        service.handle(tradeEvent({ side: "long" }))
      ).resolves.toBeUndefined();
      expect(repo.recordFill).not.toHaveBeenCalled();
    });

    it("rejects an unparseable executedAt without touching the repository", async () => {
      await expect(
        service.handle(tradeEvent({ executedAt: "not-a-date" }))
      ).resolves.toBeUndefined();
      expect(repo.recordFill).not.toHaveBeenCalled();
    });

    it("rejects a payload missing the fill id (guard)", async () => {
      const event = tradeEvent();
      delete (event.payload as { fillId?: string }).fillId;
      await expect(service.handle(event)).resolves.toBeUndefined();
      expect(repo.recordFill).not.toHaveBeenCalled();
    });

    it("propagates persistence failures so the consumer redelivers", async () => {
      repo.recordFill.mockRejectedValue(new Error("db down"));
      await expect(service.handle(tradeEvent())).rejects.toThrow("db down");
    });
  });

  describe("ORDER_INTENT", () => {
    it("upserts a valid intent", async () => {
      await service.handle(
        createBotEvent(
          "ORDER_INTENT",
          {
            ...BASE,
            symbol: "ETH",
            side: "SELL",
            price: 110,
            quantity: 0.5,
            clientOrderId: "bot1-00-S",
          },
          "corr-intent-1"
        )
      );

      expect(repo.upsertIntent).toHaveBeenCalledWith({
        botId: BASE.botId,
        clientOrderId: "bot1-00-S",
        symbol: "ETH",
        side: "SELL",
        price: 110,
        quantity: 0.5,
      } satisfies LedgerIntent);
    });

    it("rejects an invalid quantity without touching the repository", async () => {
      await expect(
        service.handle(
          createBotEvent(
            "ORDER_INTENT",
            {
              ...BASE,
              symbol: "ETH",
              side: "BUY",
              price: 100,
              quantity: 0,
              clientOrderId: "bot1-00-B",
            },
            "corr-intent-2"
          )
        )
      ).resolves.toBeUndefined();
      expect(repo.upsertIntent).not.toHaveBeenCalled();
    });
  });

  describe("POSITION_UPDATED", () => {
    it("upserts a LONG position", async () => {
      await service.handle(
        createBotEvent(
          "POSITION_UPDATED",
          {
            ...BASE,
            symbol: "ETH",
            side: "LONG",
            quantity: 0.01,
            entryPrice: 2700,
            markPrice: 2710,
            pnl: 0.1,
          },
          "corr-pos-1"
        )
      );

      expect(repo.upsertPosition).toHaveBeenCalledWith({
        botId: BASE.botId,
        symbol: "ETH",
        side: "LONG",
        quantity: 0.01,
        entryPrice: 2700,
        markPrice: 2710,
        pnl: 0.1,
        unrealizedPnl: 0,
      } satisfies LedgerPosition);
    });

    it("passes the unrealised split through and accepts a negative value", async () => {
      await service.handle(
        createBotEvent(
          "POSITION_UPDATED",
          {
            ...BASE,
            symbol: "ETH",
            side: "LONG",
            quantity: 0.01,
            entryPrice: 2700,
            markPrice: 2690,
            pnl: -0.09,
            unrealizedPnl: -0.1,
          },
          "corr-pos-split"
        )
      );

      expect(repo.upsertPosition).toHaveBeenCalledWith(
        expect.objectContaining({ pnl: -0.09, unrealizedPnl: -0.1 })
      );
    });

    it("rejects a non-finite unrealised PnL without touching the repository", async () => {
      await service.handle(
        createBotEvent(
          "POSITION_UPDATED",
          {
            ...BASE,
            symbol: "ETH",
            side: "LONG",
            quantity: 0.01,
            entryPrice: 2700,
            markPrice: 2710,
            pnl: 0.1,
            unrealizedPnl: Number.NaN,
          },
          "corr-pos-bad"
        )
      );

      expect(repo.upsertPosition).not.toHaveBeenCalled();
    });

    it("accepts an explicit FLAT report (quantity 0)", async () => {
      await service.handle(
        createBotEvent(
          "POSITION_UPDATED",
          {
            ...BASE,
            symbol: "ETH",
            side: "FLAT",
            quantity: 0,
            entryPrice: 0,
            markPrice: 2710,
            pnl: -1.5,
          },
          "corr-pos-2"
        )
      );

      expect(repo.upsertPosition).toHaveBeenCalledWith(
        expect.objectContaining({ side: "FLAT", quantity: 0, pnl: -1.5 })
      );
    });
  });

  describe("PERFORMANCE_SNAPSHOT", () => {
    it("upserts valid metrics", async () => {
      await service.handle(
        createBotEvent(
          "PERFORMANCE_SNAPSHOT",
          { ...BASE, metrics: { totalTrades: 12, totalPnl: -3.5 } },
          "corr-perf-1"
        )
      );

      expect(repo.upsertPerformance).toHaveBeenCalledWith({
        botId: BASE.botId,
        totalTrades: 12,
        totalPnl: -3.5,
        winRate: undefined,
        maxDrawdown: undefined,
        profitFactor: undefined,
        sharpeRatio: undefined,
      } satisfies LedgerPerformance);
    });

    it("rejects non-finite metrics without touching the repository", async () => {
      await expect(
        service.handle(
          createBotEvent(
            "PERFORMANCE_SNAPSHOT",
            { ...BASE, metrics: { totalTrades: 1, totalPnl: Number.NaN } },
            "corr-perf-2"
          )
        )
      ).resolves.toBeUndefined();
      expect(repo.upsertPerformance).not.toHaveBeenCalled();
    });
  });

  describe("dispatch", () => {
    it("warns and does nothing for a non-ledger event", async () => {
      await service.handle(
        createBotEvent(
          "STATE_CHANGED",
          { ...BASE, from: "RUNNING", to: "STOPPED" },
          "corr-state-1"
        )
      );
      expect(repo.recordFill).not.toHaveBeenCalled();
      expect(repo.upsertIntent).not.toHaveBeenCalled();
      expect(repo.upsertPosition).not.toHaveBeenCalled();
      expect(repo.upsertPerformance).not.toHaveBeenCalled();
    });

    it("the ledger event types pass the shared isBotEvent guard", () => {
      expect(isBotEvent(tradeEvent())).toBe(true);
      expect(
        isBotEvent(
          createBotEvent(
            "ORDER_INTENT",
            {
              ...BASE,
              symbol: "ETH",
              side: "BUY",
              price: 1,
              quantity: 1,
              clientOrderId: "x",
            },
            "c"
          )
        )
      ).toBe(true);
    });
  });
});
