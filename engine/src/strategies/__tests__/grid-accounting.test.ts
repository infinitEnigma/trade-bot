/**
 * Executed-price accounting (N6 / gap doc §4 row 5).
 *
 * The grid used to place a filled level's exit at `level.price` — the very
 * price the buy had just filled at, i.e. zero spread before fees — and to
 * derive PnL from the mark price at check time, ignoring fees. These tests pin
 * the corrected economics:
 *
 * - the exit sits above the *executed* entry (next grid line, or the
 *   configured take profit), and is never armed at or below the entry;
 * - realised PnL is `(sellExec - entryExec) × qty - fee`, booked on the closing
 *   leg, with the entry leg booking its own fee as an immediate cost;
 * - open inventory is reported separately as `unrealizedPnl`;
 * - an unknown fee rate omits the money fields instead of booking `0`;
 * - the executed entry survives a restart through the snapshot.
 *
 * @format
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy } from "../grid";
import { ExchangeClient, ExchangeFeeRates } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";
import {
  FillReport,
  PerformanceReport,
  PositionReport,
  TradeReporter,
} from "../../application/trade-reporter";
import { loadGridSnapshot } from "../../infrastructure/state/grid-state";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 2,
  orderQuantity: 1,
  gridRangePercent: 5,
};

/** Levels around 100 at 5% with gridSize 2: 97.5 | 100 | 102.5. */
const LEVEL_0 = 97.5;
const LEVEL_1 = 100;

/** Taker rate used by the fee-source mock (0.1% of notional). */
const TAKER_RATE = 0.001;
const FEE_RATES: ExchangeFeeRates = {
  makerRate: 0.0001,
  takerRate: TAKER_RATE,
  tier: "test",
  venueReported: true,
  exact: true,
  basis: "test tier",
};

type MockExchange = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
  /** Absent by default: an exchange with no account fee tier. */
  getFeeRates?: jest.Mock;
};

function makeExchange(): MockExchange {
  let seq = 0;
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
    getOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    createOrder: jest.fn().mockImplementation(async () => ({
      orderId: `O${(seq += 1)}`,
      status: "OPEN",
    })),
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

function levelsOf(s: GridTradingStrategy) {
  return (
    s as unknown as {
      levels: Array<{
        price: number;
        buyOrderId?: string;
        sellOrderId?: string;
        filled: boolean;
        entryPrice?: number;
      }>;
    }
  ).levels;
}

function clearThrottle(s: GridTradingStrategy): void {
  (
    s as unknown as { lastOrderCheck: Map<string, Date> }
  ).lastOrderCheck.clear();
}

function fillsOf(reporter: { reportFill: jest.Mock }): FillReport[] {
  return reporter.reportFill.mock.calls.map(c => c[0] as FillReport);
}

function lastPosition(reporter: { reportPosition: jest.Mock }): PositionReport {
  const calls = reporter.reportPosition.mock.calls;
  return calls[calls.length - 1][0] as PositionReport;
}

function lastPerformance(reporter: {
  reportPerformance: jest.Mock;
}): PerformanceReport {
  const calls = reporter.reportPerformance.mock.calls;
  return calls[calls.length - 1][0] as PerformanceReport;
}

/** Order requests the strategy placed for one side. */
function placedOrders(
  exchange: MockExchange,
  side: "BUY" | "SELL"
): Array<{ side: string; orderPrice: number; clientOrderId: string }> {
  return exchange.createOrder.mock.calls
    .map(
      c => c[0] as { side: string; orderPrice: number; clientOrderId: string }
    )
    .filter(c => c.side === side);
}

/** Drive level `index`'s BUY to a fill at `executedPrice` (one tick). */
async function fillBuy(
  s: GridTradingStrategy,
  exchange: MockExchange,
  index: number,
  executedPrice: number
): Promise<void> {
  const handle = levelsOf(s)[index].buyOrderId as string;
  exchange.getOrder.mockImplementation(async (orderId: string) =>
    orderId === handle
      ? { orderId, status: "FILLED", executedPrice, executedQuantity: 1 }
      : { orderId, status: "OPEN" }
  );
  clearThrottle(s);
  await s.tick();
}

/** Drive level `index`'s live SELL to a fill at `executedPrice` (one tick). */
async function fillSell(
  s: GridTradingStrategy,
  exchange: MockExchange,
  index: number,
  executedPrice: number
): Promise<void> {
  const handle = levelsOf(s)[index].sellOrderId as string;
  exchange.getOrder.mockImplementation(async (orderId: string) =>
    orderId === handle
      ? { orderId, status: "FILLED", executedPrice, executedQuantity: 1 }
      : { orderId, status: "OPEN" }
  );
  clearThrottle(s);
  await s.tick();
}

/** Move the ticker and run one tick. */
async function tickAt(
  s: GridTradingStrategy,
  exchange: MockExchange,
  price: number
): Promise<void> {
  exchange.getTicker.mockResolvedValue({ symbol: CONFIG.symbol, price });
  await s.tick();
}

function makeStrategy(
  botId: string,
  exchange: MockExchange,
  config: GridStrategyConfig = CONFIG,
  reporter?: TradeReporter
): GridTradingStrategy {
  return new GridTradingStrategy(
    botId,
    config,
    exchange as unknown as ExchangeClient,
    reporter
  );
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-accounting-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
  jest.clearAllMocks();
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

describe("GridTradingStrategy executed-price accounting (N6)", () => {
  it("prices the exit one grid line above the level, never at the buy's own price", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-n6-price", exchange);
    await s.initialize(100);
    await s.start();
    await s.tick();
    await fillBuy(s, exchange, 0, LEVEL_0 - 0.1);

    // Price back at the level: the exit is armed for the *next* line up.
    await tickAt(s, exchange, LEVEL_0 + 0.5);

    const sells = placedOrders(exchange, "SELL");
    expect(sells).toHaveLength(1);
    // levels[1] is 100 (one 2.5 step above the level's own 97.5), strictly
    // above the executed entry — the old code placed this at 97.5.
    expect(sells[0].orderPrice).toBe(LEVEL_1);
    expect(levelsOf(s)[0].entryPrice).toBe(LEVEL_0 - 0.1);
  });

  it("prices the exit at the configured take profit above the executed entry", async () => {
    const exchange = makeExchange();
    const s = makeStrategy(
      "bot-n6-takeprofit",
      exchange,
      { ...CONFIG, takeProfitPercent: 2 },
      makeReporter()
    );
    await s.initialize(100);
    await s.start();
    await s.tick();
    await fillBuy(s, exchange, 0, 97.4);
    await tickAt(s, exchange, LEVEL_0 + 0.5);

    const sells = placedOrders(exchange, "SELL");
    expect(sells).toHaveLength(1);
    // 97.4 × 1.02 = 99.348 → 99.35 (rounded to the grid's price scale).
    expect(sells[0].orderPrice).toBe(99.35);
    expect(sells[0].orderPrice).toBeGreaterThan(97.4);
  });
});

describe("GridTradingStrategy realised PnL with fees (N6)", () => {
  it("books realised PnL from executed prices with fees, on the closing leg only", async () => {
    const exchange = makeExchange();
    exchange.getFeeRates = jest.fn().mockResolvedValue(FEE_RATES);
    const reporter = makeReporter();
    const s = makeStrategy("bot-n6-pnl", exchange, CONFIG, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    await fillBuy(s, exchange, 0, 97.4);

    // Entry leg: executed price booked, fee realised immediately, spread not.
    const buyFill = fillsOf(reporter)[0];
    expect(buyFill.side).toBe("BUY");
    expect(buyFill.price).toBe(97.4);
    expect(buyFill.fee).toBeCloseTo(97.4 * TAKER_RATE, 8);
    expect(buyFill.pnl).toBeCloseTo(0 - 97.4 * TAKER_RATE, 8);

    const afterBuy = lastPosition(reporter);
    expect(afterBuy).toEqual(
      expect.objectContaining({ side: "LONG", quantity: 1, entryPrice: 97.4 })
    );
    expect(afterBuy.pnl).toBeCloseTo(0 - 97.4 * TAKER_RATE, 8);
    // Open inventory: mark (1) vs executed entry (97.4).
    expect(afterBuy.unrealizedPnl).toBeCloseTo(1 - 97.4, 8);

    // Closing leg at 100.5: (sellExec - entryExec) × qty - fee.
    await tickAt(s, exchange, LEVEL_0 + 0.5);
    await fillSell(s, exchange, 0, 100.5);

    const sellFill = fillsOf(reporter)[1];
    const gross = (100.5 - 97.4) * 1;
    expect(sellFill.side).toBe("SELL");
    expect(sellFill.price).toBe(100.5);
    expect(sellFill.fee).toBeCloseTo(100.5 * TAKER_RATE, 8);
    expect(sellFill.pnl).toBeCloseTo(gross - 100.5 * TAKER_RATE, 8);

    // Ledger invariant: SUM(fill pnl) == the engine's realised counter == the
    // position report's pnl (what reconciles with bot_instances.total_pnl).
    const total = fillsOf(reporter).reduce((sum, f) => sum + (f.pnl ?? 0), 0);
    expect(lastPerformance(reporter).totalPnl).toBeCloseTo(total, 8);
    const afterSell = lastPosition(reporter);
    expect(afterSell.side).toBe("FLAT");
    expect(afterSell.quantity).toBe(0);
    expect(afterSell.pnl).toBeCloseTo(total, 8);
    expect(afterSell.unrealizedPnl).toBe(0);
    // The leg is closed: its executed entry is cleared.
    expect(levelsOf(s)[0].entryPrice).toBeUndefined();
  });

  it("omits fee and PnL when the venue rate cannot be sourced (never books 0)", async () => {
    const exchange = makeExchange();
    exchange.getFeeRates = jest
      .fn()
      .mockRejectedValue(new Error("accountLimits down"));
    const reporter = makeReporter();
    const s = makeStrategy("bot-n6-nofee", exchange, CONFIG, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    await fillBuy(s, exchange, 0, 97.4);

    const fill = fillsOf(reporter)[0];
    expect(fill.price).toBe(97.4);
    expect(fill.fee).toBeUndefined();
    expect(fill.pnl).toBeUndefined();
    expect(lastPerformance(reporter).totalPnl).toBe(0);
    // The fill itself is still durable, and the tick survived the outage.
    expect(reporter.reportFill).toHaveBeenCalledTimes(1);
  });

  it("books a known zero rate as fee 0 and realises the full spread", async () => {
    const exchange = makeExchange();
    exchange.getFeeRates = jest
      .fn()
      .mockResolvedValue({ ...FEE_RATES, makerRate: 0, takerRate: 0 });
    const reporter = makeReporter();
    const s = makeStrategy("bot-n6-zerofee", exchange, CONFIG, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    await fillBuy(s, exchange, 0, 97.4);
    expect(fillsOf(reporter)[0].fee).toBe(0);
    expect(fillsOf(reporter)[0].pnl).toBe(0);

    await tickAt(s, exchange, LEVEL_0 + 0.5);
    await fillSell(s, exchange, 0, 100.5);
    expect(fillsOf(reporter)[1].pnl).toBeCloseTo((100.5 - 97.4) * 1, 8);
  });
});

describe("GridTradingStrategy entry-price durability (N6)", () => {
  it("persists the executed entry across a restart and keeps the level long", async () => {
    const botId = "bot-n6-restart";
    const exchange = makeExchange();
    const s = makeStrategy(botId, exchange);
    await s.initialize(100);
    await s.start();
    await s.tick();
    await fillBuy(s, exchange, 0, 97.4);

    const snapshot = loadGridSnapshot(botId);
    expect(snapshot?.levels[0]).toEqual(
      expect.objectContaining({ filled: true, entryPrice: 97.4 })
    );

    const restarted = makeExchange();
    const s2 = makeStrategy(botId, restarted);
    await s2.initialize(100);
    await s2.start();
    expect(levelsOf(s2)[0].filled).toBe(true);
    expect(levelsOf(s2)[0].entryPrice).toBe(97.4);
  });

  it("never arms an exit at or below the entry (degenerate grid)", async () => {
    const exchange = makeExchange();
    // At a price of 1 with a 0.1% range every 2dp line collapses onto 1.00, so
    // no exit can be priced above the entry.
    const s = makeStrategy("bot-n6-degenerate", exchange, {
      ...CONFIG,
      gridSize: 100,
      gridRangePercent: 0.1,
    });
    await s.initialize(1);
    await s.start();
    await s.tick();
    await fillBuy(s, exchange, 0, 1);
    expect(levelsOf(s)[0].filled).toBe(true);

    await tickAt(s, exchange, 1);

    expect(placedOrders(exchange, "SELL")).toHaveLength(0);
    expect(levelsOf(s)[0].sellOrderId).toBeUndefined();
  });
});
