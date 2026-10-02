/**
 * Grid ledger emission (Phase 4 / N7): every detected fill must produce
 * TRADE_EXECUTED + POSITION_UPDATED + PERFORMANCE_SNAPSHOT reports, and
 * placements must be gated by ORDER_INTENT — while a reporting failure must
 * never kill the tick.
 *
 * @format
 */

import { GridTradingStrategy } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";
import {
  FillReport,
  OrderIntentReport,
  PerformanceReport,
  PositionReport,
  TradeReporter,
} from "../../application/trade-reporter";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 2,
  orderQuantity: 1,
  gridRangePercent: 5,
};

type MockExchange = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
};

function makeExchange(): MockExchange {
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
    getOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    createOrder: jest.fn().mockResolvedValue({ orderId: "O1", status: "OPEN" }),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    listOpenOrders: jest.fn().mockResolvedValue([]),
    queryOrderByClientOrderId: jest
      .fn()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
  };
}

function makeReporter(): TradeReporter & {
  reportOrderIntent: jest.Mock;
  reportFill: jest.Mock;
  reportPosition: jest.Mock;
  reportPerformance: jest.Mock;
} {
  return {
    reportOrderIntent: jest.fn().mockResolvedValue(true),
    reportFill: jest.fn().mockResolvedValue(undefined),
    reportPosition: jest.fn().mockResolvedValue(undefined),
    reportPerformance: jest.fn().mockResolvedValue(undefined),
  };
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-ledger-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
  jest.clearAllMocks();
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) {
    fs.rmSync(snapTmpDir, { recursive: true, force: true });
  }
});

function deriveId(s: GridTradingStrategy, i: number, side: "BUY" | "SELL") {
  return (
    s as unknown as {
      generateClientOrderId(i: number, s: "BUY" | "SELL"): string;
    }
  ).generateClientOrderId(i, side);
}

/** Slot 0 resolves FOUND_FILLED via history; every other slot is NOT_FOUND. */
function scriptFilledSlot(exchange: MockExchange, slotId: string): void {
  exchange.queryOrderByClientOrderId.mockImplementation(
    async (_symbol: string, clientOrderId: string) =>
      clientOrderId === slotId
        ? {
            kind: "FOUND_FILLED",
            order: { orderId: "filled-1", clientOrderId: slotId },
          }
        : { kind: "NOT_FOUND" }
  );
}

describe("GridTradingStrategy ledger emission (Phase 4)", () => {
  it("emits fill + position + performance for a detected fill", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = new GridTradingStrategy(
      "bot-ledger",
      CONFIG,
      exchange as unknown as ExchangeClient,
      reporter
    );
    await s.initialize(100);
    await s.start();

    const slotId = deriveId(s, 0, "BUY");
    scriptFilledSlot(exchange, slotId);

    await s.tick();

    expect(reporter.reportFill).toHaveBeenCalledTimes(1);
    const fill = reporter.reportFill.mock.calls[0][0] as FillReport;
    expect(fill).toEqual(
      expect.objectContaining({
        botId: "bot-ledger",
        symbol: CONFIG.symbol,
        side: "BUY",
        status: "FILLED",
        clientOrderId: slotId,
        exchangeOrderId: "filled-1",
        quantity: 1,
        price: 97.5,
      })
    );
    expect(Number.isFinite(Date.parse(fill.executedAt))).toBe(true);
    // This exchange has no fee source: the fee (and therefore the booked PnL)
    // is *absent*, never an invented 0 (N6).
    expect(fill.fee).toBeUndefined();
    expect(fill.pnl).toBeUndefined();

    // One filled BUY level → LONG with one level's quantity.
    expect(reporter.reportPosition).toHaveBeenCalledTimes(1);
    const position = reporter.reportPosition.mock.calls[0][0] as PositionReport;
    expect(position).toEqual(
      expect.objectContaining({
        botId: "bot-ledger",
        side: "LONG",
        quantity: 1,
        entryPrice: 97.5,
        // Mark-to-market of the open leg at the ticker price (1); realised PnL
        // stays 0 until the paired exit books it (N6 split).
        unrealizedPnl: (1 - 97.5) * 1,
      })
    );

    expect(reporter.reportPerformance).toHaveBeenCalledTimes(1);
    expect(reporter.reportPerformance.mock.calls[0][0]).toEqual({
      botId: "bot-ledger",
      totalTrades: 1,
      // A BUY opens the long: its spread is unrealised, and this exchange has
      // no fee source, so nothing is realised (N6 — no mark-to-market here).
      totalPnl: 0,
    } satisfies PerformanceReport);

    // The fill slot never publishes an intent (nothing was created); the two
    // remaining slots were gated by intent before createOrder.
    const intentIds = reporter.reportOrderIntent.mock.calls
      .map(c => c[0] as OrderIntentReport)
      .map(r => r.clientOrderId);
    expect(intentIds).toHaveLength(2);
    expect(intentIds).not.toContain(slotId);
  });

  it("skips the intent gate on the adoption path (FOUND_OPEN)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = new GridTradingStrategy(
      "bot-ledger",
      CONFIG,
      exchange as unknown as ExchangeClient,
      reporter
    );
    await s.initialize(100);
    await s.start();

    const slotId = deriveId(s, 0, "BUY");
    exchange.queryOrderByClientOrderId.mockImplementation(
      async (_symbol: string, clientOrderId: string) =>
        clientOrderId === slotId
          ? {
              kind: "FOUND_OPEN",
              order: { orderId: "live-1", clientOrderId: slotId },
            }
          : { kind: "UNREACHABLE", reason: "down" }
    );

    await s.tick();

    // Nothing was about to be created for slot 0, so no intent for it; the
    // other slots froze on UNREACHABLE before the intent gate.
    expect(reporter.reportOrderIntent).not.toHaveBeenCalled();
    expect(reporter.reportFill).not.toHaveBeenCalled();
  });

  it("keeps ticking when fill reporting fails (reporting never breaks the loop)", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    reporter.reportFill.mockRejectedValue(new Error("redis down"));
    const s = new GridTradingStrategy(
      "bot-ledger",
      CONFIG,
      exchange as unknown as ExchangeClient,
      reporter
    );
    await s.initialize(100);
    await s.start();

    scriptFilledSlot(exchange, deriveId(s, 0, "BUY"));

    await expect(s.tick()).resolves.toBeUndefined();

    // The remaining slots still went through the intent gate + placement.
    expect(reporter.reportOrderIntent).toHaveBeenCalledTimes(2);
    expect(exchange.createOrder).toHaveBeenCalledTimes(2);
  });

  it("runs without a reporter (strategy unit tests / legacy wiring)", async () => {
    const exchange = makeExchange();
    const s = new GridTradingStrategy(
      "bot-ledger",
      CONFIG,
      exchange as unknown as ExchangeClient
    );
    await s.initialize(100);
    await s.start();

    scriptFilledSlot(exchange, deriveId(s, 0, "BUY"));

    await expect(s.tick()).resolves.toBeUndefined();
    expect(exchange.createOrder).toHaveBeenCalledTimes(2);
  });
});
