/**
 * Grid stop-loss integration (v1, Model A) — the pure machine (`grid-stop-loss`)
 * wired into the tick loop. No second order stack: these pin that a trip
 * freezes entries, cancels resting entry BUYs, exits confirmed inventory with
 * per-level reduce-only SELLs sized to real heldQty, and completes only on a
 * verified flat — never on submit alone. Local-confirmed CLEARED under a shared
 * symbol (correction #1) and restart phase-restore are pinned too.
 *
 * @format
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";
import { TradeReporter } from "../../application/trade-reporter";
import { loadGridSnapshot } from "../../infrastructure/state/grid-state";

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
  getPositions: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
  getMarketRules: jest.Mock;
};

function makeExchange(): MockExchange {
  let seq = 0;
  return {
    getTicker: jest
      .fn()
      .mockResolvedValue({ symbol: CONFIG.symbol, price: 100 }),
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
    getMarketRules: jest.fn().mockResolvedValue({
      exchange: "fake",
      symbol: CONFIG.symbol,
      priceTickSize: "0.01",
    }),
  };
}

const noopReporter = {
  reportOrderIntent: jest.fn().mockResolvedValue(true),
  reportFill: jest.fn().mockResolvedValue(undefined),
  reportPosition: jest.fn().mockResolvedValue(undefined),
  reportPerformance: jest.fn().mockResolvedValue(undefined),
} as unknown as TradeReporter;

function levelsOf(s: GridTradingStrategy): Array<{
  price: number;
  buyOrderId?: string;
  sellOrderId?: string;
  filled: boolean;
  heldQty?: number;
}> {
  return (
    s as unknown as {
      levels: Array<{
        price: number;
        buyOrderId?: string;
        sellOrderId?: string;
        filled: boolean;
        heldQty?: number;
      }>;
    }
  ).levels;
}

function clearThrottle(s: GridTradingStrategy): void {
  (
    s as unknown as { lastOrderCheck: Map<string, Date> }
  ).lastOrderCheck.clear();
}

async function tickAt(
  s: GridTradingStrategy,
  exchange: MockExchange,
  price: number
): Promise<void> {
  exchange.getTicker.mockResolvedValue({ symbol: CONFIG.symbol, price });
  clearThrottle(s);
  await s.tick();
}

function makeStrategy(
  botId: string,
  exchange: MockExchange,
  config: GridStrategyConfig
): GridTradingStrategy {
  return new GridTradingStrategy(
    botId,
    config,
    exchange as unknown as ExchangeClient,
    noopReporter
  );
}

function placedOrders(
  exchange: MockExchange,
  side: "BUY" | "SELL"
): Array<{ side: string; reduceOnly?: boolean; orderQuantity: number }> {
  return exchange.createOrder.mock.calls
    .map(
      c => c[0] as { side: string; reduceOnly?: boolean; orderQuantity: number }
    )
    .filter(c => c.side === side);
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-stoploss-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
  jest.clearAllMocks();
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

const SL_CONFIG: GridStrategyConfig = { ...CONFIG, stopLossPercent: 5 };

describe("Grid stop-loss integration (v1, Model A)", () => {
  it("INACTIVE (no stopLossPercent) runs a normal grid", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-sl-off", exchange, CONFIG);
    await s.initialize(100);
    await s.start();
    await tickAt(s, exchange, 100);
    expect(s.stopLossPhaseText()).toBe("INACTIVE");
    expect(s.isStopLossBlockingEntries()).toBe(false);
    expect(placedOrders(exchange, "BUY").length).toBeGreaterThan(0);
  });

  it("trips, freezes new entries, and cancels resting entry BUYs", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-sl-trip", exchange, SL_CONFIG);
    await s.initialize(100);
    await s.start();
    await tickAt(s, exchange, 100);
    const buysBefore = placedOrders(exchange, "BUY").length;
    expect(buysBefore).toBeGreaterThan(0);
    expect(s.stopLossPhaseText()).toBe("ARMED");

    // Price collapses 10% below baseline → trips (ref = baseline while flat).
    await tickAt(s, exchange, 90);
    expect(["TRIPPED", "CANCELING_ENTRIES", "EXITING", "CLEARED"]).toContain(
      s.stopLossPhaseText()
    );
    expect(s.isStopLossBlockingEntries()).toBe(true);
    expect(exchange.cancelOrder).toHaveBeenCalled();
    // No NEW entry BUY was placed after the trip.
    expect(placedOrders(exchange, "BUY").length).toBe(buysBefore);
  });

  it("exits held inventory with reduce-only SELLs sized to heldQty", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-sl-exit", exchange, SL_CONFIG);
    await s.initialize(100);
    await s.start();
    await tickAt(s, exchange, 100);
    // Fill the level that armed a BUY at the current price (level at 100).
    const buyIndex = levelsOf(s).findIndex(l => l.buyOrderId);
    const handle = levelsOf(s)[buyIndex].buyOrderId as string;
    exchange.getOrder.mockImplementation(async (orderId: string) =>
      orderId === handle
        ? {
            orderId,
            status: "FILLED",
            executedPrice: levelsOf(s)[buyIndex].price,
            executedQuantity: 1,
          }
        : { orderId, status: "OPEN" }
    );
    await tickAt(s, exchange, 100);
    expect(levelsOf(s)[buyIndex].heldQty).toBeCloseTo(1, 8);

    // Trip and drive to EXITING; venue flat so it can clear.
    exchange.getPositions.mockResolvedValue([]);
    await tickAt(s, exchange, 90);
    await tickAt(s, exchange, 90);

    const sells = placedOrders(exchange, "SELL");
    expect(sells.length).toBeGreaterThan(0);
    expect(sells.every(o => o.reduceOnly === true)).toBe(true);
    expect(sells.some(o => o.orderQuantity === 1)).toBe(true);
  });

  it("does NOT claim CLEARED while venue holds residual (exclusive symbol)", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-sl-residual", exchange, SL_CONFIG);
    await s.initialize(100);
    await s.start();
    await tickAt(s, exchange, 100);
    exchange.getPositions.mockResolvedValue([
      { symbol: CONFIG.symbol, position_qty: 2 },
    ]);
    await tickAt(s, exchange, 90);
    await tickAt(s, exchange, 90);
    expect(s.stopLossPhaseText()).toBe("HALTED_RESIDUAL");
  });

  it("CLEARED under a shared symbol even when the venue is non-flat", async () => {
    const exchange = makeExchange();
    const s = makeStrategy("bot-sl-shared", exchange, SL_CONFIG);
    await s.initialize(100);
    await s.start();
    await tickAt(s, exchange, 100);
    s.setSymbolShared(true);
    exchange.getPositions.mockResolvedValue([
      { symbol: CONFIG.symbol, position_qty: 5 },
    ]);
    await tickAt(s, exchange, 90);
    await tickAt(s, exchange, 90);
    expect(s.stopLossPhaseText()).toBe("CLEARED");
    expect(s.isStopLossBlockingEntries()).toBe(true);
  });

  it("restores a mid-stop phase from the snapshot (no re-arm, entries frozen)", async () => {
    const botId = "bot-sl-restore";
    const exchange = makeExchange();
    const s = makeStrategy(botId, exchange, SL_CONFIG);
    await s.initialize(100);
    await s.start();
    await tickAt(s, exchange, 100);
    await tickAt(s, exchange, 90);
    await s.stop();

    const snap = loadGridSnapshot(botId);
    expect(snap?.stopLoss?.phase).toBeDefined();

    const exchange2 = makeExchange();
    const s2 = makeStrategy(botId, exchange2, SL_CONFIG);
    await s2.initialize(100);
    await s2.start();
    expect([
      "TRIPPED",
      "CANCELING_ENTRIES",
      "EXITING",
      "CLEARED",
      "HALTED_RESIDUAL",
    ]).toContain(s2.stopLossPhaseText());
    expect(s2.isStopLossBlockingEntries()).toBe(true);
    await tickAt(s2, exchange2, 100);
    expect(placedOrders(exchange2, "BUY").length).toBe(0);
  });
});
