/**
 * Venue position reconciliation (N6 / gap doc §4 row 5).
 *
 * The grid-derived position (`buildPositionReport`) is a *projection* of the
 * level flags; `exchange.getPositions()` is the venue's authority for what the
 * account actually holds. These tests pin the cross-check:
 *
 * - drift beyond tolerance emits a POSITION_UPDATED carrying the venue quantity
 *   (and reports it) without rewriting the local levels;
 * - a venue read that agrees with the local position is silent;
 * - a venue read failure never breaks the tick;
 * - the check is throttled (never on the first tick, once per interval after).
 *
 * @format
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";
import { saveGridSnapshot } from "../../infrastructure/state/grid-state";
import {
  PositionReport,
  TradeReporter,
} from "../../application/trade-reporter";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 2,
  orderQuantity: 1,
  gridRangePercent: 5,
};

/** Levels around 100 at 5% with gridSize 2: 97.5 | 100 | 102.5. */
const LEVEL_0 = 97.5;

type MockExchange = {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  getPositions: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
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
    getPositions: jest.fn().mockResolvedValue([]),
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

function makeStrategy(
  botId: string,
  exchange: MockExchange,
  reporter?: TradeReporter
): GridTradingStrategy {
  return new GridTradingStrategy(
    botId,
    CONFIG,
    exchange as unknown as ExchangeClient,
    reporter
  );
}

function levelsOf(s: GridTradingStrategy) {
  return (
    s as unknown as {
      levels: Array<{
        price: number;
        buyOrderId?: string;
        filled: boolean;
        entryPrice?: number;
      }>;
    }
  ).levels;
}

/** Defeat the interval throttle so the next tick reconciles. */
function forceReconcile(s: GridTradingStrategy): void {
  (s as unknown as { lastPositionReconcile: number }).lastPositionReconcile = 0;
}

function clearThrottle(s: GridTradingStrategy): void {
  (
    s as unknown as { lastOrderCheck: Map<string, Date> }
  ).lastOrderCheck.clear();
}

function lastPosition(reporter: { reportPosition: jest.Mock }): PositionReport {
  const calls = reporter.reportPosition.mock.calls;
  return calls[calls.length - 1][0] as PositionReport;
}

/** Fill level 0's BUY so the local grid position becomes 1 long. */
async function fillBuyAtLevel0(
  s: GridTradingStrategy,
  exchange: MockExchange
): Promise<void> {
  const handle = levelsOf(s)[0].buyOrderId as string;
  exchange.getOrder.mockImplementation(async (orderId: string) =>
    orderId === handle
      ? {
          orderId,
          status: "FILLED",
          executedPrice: LEVEL_0,
          executedQuantity: 1,
        }
      : { orderId, status: "OPEN" }
  );
  clearThrottle(s);
  await s.tick();
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-position-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
  jest.clearAllMocks();
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

describe("GridTradingStrategy venue position reconciliation (N6)", () => {
  it("reports venue truth when the venue position drifts beyond tolerance", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-pos-drift", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();
    await fillBuyAtLevel0(s, exchange);
    expect(lastPosition(reporter).quantity).toBe(1);

    const reportsBefore = reporter.reportPosition.mock.calls.length;
    exchange.getPositions.mockResolvedValue([
      {
        symbol: CONFIG.symbol,
        position_qty: 5,
        mark_price: 98,
        entry_price: 96,
      },
    ]);
    forceReconcile(s);
    await s.tick();

    expect(reporter.reportPosition.mock.calls.length).toBeGreaterThan(
      reportsBefore
    );
    const reported = lastPosition(reporter);
    expect(reported.quantity).toBe(5);
    expect(reported.side).toBe("LONG");
    // The venue's entry price wins when its row carries one...
    expect(reported.entryPrice).toBe(96);
    // ...but the local grid levels are NOT rewritten by a single read.
    expect(levelsOf(s)[0].filled).toBe(true);
    expect(levelsOf(s)[0].entryPrice).toBe(LEVEL_0);
  });

  it("stays silent when the venue agrees with the local position", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-pos-agree", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();
    await fillBuyAtLevel0(s, exchange);

    const reportsBefore = reporter.reportPosition.mock.calls.length;
    exchange.getPositions.mockResolvedValue([
      { symbol: CONFIG.symbol, position_qty: 1, mark_price: 98 },
    ]);
    forceReconcile(s);
    await s.tick();

    expect(reporter.reportPosition.mock.calls.length).toBe(reportsBefore);
  });

  it("does not break the tick when the venue position read fails", async () => {
    const exchange = makeExchange();
    const reporter = makeReporter();
    const s = makeStrategy("bot-pos-fail", exchange, reporter);
    await s.initialize(100);
    await s.start();
    await s.tick();

    exchange.getPositions.mockRejectedValue(new Error("positions 500"));
    forceReconcile(s);

    await expect(s.tick()).resolves.toBeUndefined();
  });

  it("runs at most once per interval (never on the first tick)", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-pos-throttle", exchange);
    await s.initialize(100);
    await s.start();

    // First tick right after start(): the interval has not elapsed.
    await s.tick();
    expect(exchange.getPositions).not.toHaveBeenCalled();

    forceReconcile(s);
    await s.tick();
    const afterForced = exchange.getPositions.mock.calls.length;
    expect(afterForced).toBe(1);

    await s.tick();
    expect(exchange.getPositions.mock.calls.length).toBe(afterForced);
  });
});

describe("GridTradingStrategy position report (Phase 4, C4)", () => {
  /** The grid around 100 at 5% / 2: 97.5 | 100 | 102.5. */
  const seedReportLevels = () =>
    saveGridSnapshot({
      version: 1,
      botId: "bot-report",
      symbol: CONFIG.symbol,
      gridSize: CONFIG.gridSize,
      gridRangePercent: CONFIG.gridRangePercent,
      baselinePrice: 100,
      levels: [
        // A partial long: 0.4 booked at an executed 97.4…
        {
          price: LEVEL_0,
          filled: false,
          heldQty: 0.4,
          buyFilledQty: 0.4,
          entryPrice: LEVEL_0 - 0.1,
        },
        // …and a full one at 100.
        {
          price: 100,
          filled: true,
          heldQty: 1,
          buyFilledQty: 1,
          entryPrice: 100,
        },
        { price: 102.5, filled: false },
      ],
      savedAt: new Date().toISOString(),
    });

  function reportOf(s: GridTradingStrategy): PositionReport {
    return (
      s as unknown as { buildPositionReport(): PositionReport }
    ).buildPositionReport();
  }

  it("sums held quantities with a quantity-weighted entry and mark", async () => {
    await seedReportLevels();
    const exchange = makeExchange();
    const s = makeStrategy("bot-report", exchange);
    await s.initialize(100); // mark price = 100

    const report = reportOf(s);
    // Neither a level count nor one configured size describes a partial grid.
    expect(report.side).toBe("LONG");
    expect(report.quantity).toBeCloseTo(1.4, 8);
    // (97.4 × 0.4 + 100 × 1.0) / 1.4 — the partial contributes by size.
    expect(report.entryPrice).toBeCloseTo(99.25714286, 8);
    expect(report.unrealizedPnl).toBeCloseTo((100 - 97.4) * 0.4, 8);
    expect(report.markPrice).toBe(100);
  });

  it("reports FLAT with no entry when nothing is held", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-report-flat", exchange);
    await s.initialize(100);

    const report = reportOf(s);
    expect(report.side).toBe("FLAT");
    expect(report.quantity).toBe(0);
    expect(report.entryPrice).toBe(0);
    expect(report.unrealizedPnl).toBe(0);
  });
});
