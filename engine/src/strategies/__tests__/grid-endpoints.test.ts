/**
 * Grid endpoint quantization (Phase E, review finding P1-a).
 *
 * `buildLevels` snaps the configured band's outer edges INWARD to valid ticks
 * — lower edge UP, upper edge DOWN — so no level can land outside the user's
 * band. The previous behaviour quantized every level down and then rejected the
 * grid when the off-tick lower edge fell below the band, which failed otherwise
 * valid configurations (e.g. center 100.03 / 1% / tick 0.05).
 *
 * TRADE-OFF (pinned by these tests): staying inside the band takes precedence
 * over never exceeding a calculated BUY target — the snapped lower edge may sit
 * a few ticks above the raw calculated target when the boundary is off-tick.
 *
 * @format
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { GridTradingStrategy } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";

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

function makeExchange(tick: string): MockExchange {
  return {
    getTicker: jest.fn().mockResolvedValue({ symbol: "PERP_X", price: 1 }),
    getOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    createOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    cancelOrder: jest.fn().mockResolvedValue({ status: "CANCELLED" }),
    getPositions: jest.fn().mockResolvedValue([]),
    listOpenOrders: jest.fn().mockResolvedValue([]),
    queryOrderByClientOrderId: jest
      .fn()
      .mockResolvedValue({ kind: "NOT_FOUND" }),
    getMarketRules: jest.fn().mockResolvedValue({
      exchange: "fake",
      symbol: "PERP_X",
      priceTickSize: tick,
    }),
  };
}

function makeStrategy(
  botId: string,
  exchange: MockExchange,
  config: GridStrategyConfig
): GridTradingStrategy {
  return new GridTradingStrategy(
    botId,
    config,
    exchange as unknown as ExchangeClient
  );
}

function levelsOf(s: GridTradingStrategy): Array<{ price: number }> {
  return (s as unknown as { levels: Array<{ price: number }> }).levels;
}

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-endpoints-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) fs.rmSync(snapTmpDir, { recursive: true, force: true });
});

/** True when `price` is an exact multiple of `tick` (integer-scaled check). */
function isTickMultiple(price: number, tick: string): boolean {
  const scale = tick.includes(".") ? tick.split(".")[1].length : 0;
  const factor = 10 ** scale;
  const p = Math.round(price * factor);
  const t = Math.round(Number(tick) * factor);
  return p % t === 0;
}

describe("Grid endpoint quantization (Phase E)", () => {
  it("initializes when both band edges are off-tick, keeping every level in-band and tick-valid", async () => {
    // center 100.03, 1% range, tick 0.05: band [99.52985, 100.53015]. The old
    // round-down-then-range-check rejected this; the snapped build yields
    // 99.55 | 100.00 | 100.50 — all inside the band.
    const exchange = makeExchange("0.05");
    const s = makeStrategy("bot-ep-both-off", exchange, {
      symbol: "PERP_X",
      gridSize: 2,
      orderQuantity: 1,
      gridRangePercent: 1,
    });
    await expect(s.initialize(100.03)).resolves.toBeUndefined();

    const bandMin = 100.03 - (100.03 * 0.01) / 2;
    const bandMax = 100.03 + (100.03 * 0.01) / 2;
    const prices = levelsOf(s).map(l => l.price);
    expect(prices).toEqual([99.55, 100.0, 100.5]);
    for (const p of prices) {
      expect(p).toBeGreaterThanOrEqual(bandMin);
      expect(p).toBeLessThanOrEqual(bandMax);
      expect(isTickMultiple(p, "0.05")).toBe(true);
    }
    // TRADE-OFF: the snapped lower edge (99.55) sits above the raw calculated
    // minimum (99.52985) to stay inside the band — a BUY may rest above target.
    expect(prices[0]).toBeGreaterThan(bandMin);
  });

  it("is unchanged when both band edges are already tick-aligned", async () => {
    // center 100, 1% range, tick 0.05: band [99.5, 100.5], both on-tick.
    const exchange = makeExchange("0.05");
    const s = makeStrategy("bot-ep-both-on", exchange, {
      symbol: "PERP_X",
      gridSize: 2,
      orderQuantity: 1,
      gridRangePercent: 1,
    });
    await s.initialize(100);
    expect(levelsOf(s).map(l => l.price)).toEqual([99.5, 100.0, 100.5]);
  });

  it.each([
    // [center, gridRangePercent, tick, gridSize] — sweeps many shapes,
    // including cases where only one edge is tick-aligned.
    [100.03, 1, "0.05", 2],
    [100.03, 1, "0.05", 10],
    [99.97, 2, "0.05", 5],
    [1.2345, 3, "0.001", 7],
    [50000.13, 1.5, "0.5", 4],
    [0.7777, 4, "0.0001", 6],
  ])(
    "keeps a uniform grid in-band, tick-valid and distinct (center %p, %p%%, tick %p, gridSize %p)",
    async (center, gridRangePercent, tick, gridSize) => {
      const exchange = makeExchange(tick as string);
      const s = makeStrategy(`bot-ep-sweep-${center}-${tick}`, exchange, {
        symbol: "PERP_X",
        gridSize: gridSize as number,
        orderQuantity: 1,
        gridRangePercent: gridRangePercent as number,
      });
      await expect(s.initialize(center as number)).resolves.toBeUndefined();

      const c = center as number;
      const r = c * ((gridRangePercent as number) / 100);
      const bandMin = c - r / 2;
      const bandMax = c + r / 2;
      const prices = levelsOf(s).map(l => l.price);

      expect(prices).toHaveLength((gridSize as number) + 1);
      expect(new Set(prices).size).toBe(prices.length); // distinct
      for (const p of prices) {
        expect(p).toBeGreaterThanOrEqual(bandMin);
        expect(p).toBeLessThanOrEqual(bandMax);
        expect(isTickMultiple(p, tick as string)).toBe(true);
      }
      // Monotonically increasing: a valid grid geometry.
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThan(prices[i - 1]);
      }
      expect(exchange.createOrder).not.toHaveBeenCalled();
    }
  );

  it("rejects a range too narrow to hold the requested number of distinct levels", async () => {
    // Baseline 2, 1% range, 100 levels: the snapped band is narrower than one
    // 0.01 tick, so the levels collapse to a duplicate price. Init fails closed
    // and nothing is placed — the band is never widened to fit.
    const exchange = makeExchange("0.01");
    const s = makeStrategy("bot-ep-too-narrow", exchange, {
      symbol: "PERP_X",
      gridSize: 100,
      orderQuantity: 1,
      gridRangePercent: 1,
    });
    await expect(s.initialize(2)).rejects.toThrow(
      /collapse to duplicate price/
    );
    expect(exchange.createOrder).not.toHaveBeenCalled();
  });

  it("rejects a band that contains no valid tick at all", async () => {
    // A 1% band around 2 is ~0.02 wide; with a tick of 1 there is no valid tick
    // strictly inside, so construction refuses rather than guessing a grid.
    const exchange = makeExchange("1");
    const s = makeStrategy("bot-ep-no-tick", exchange, {
      symbol: "PERP_X",
      gridSize: 2,
      orderQuantity: 1,
      gridRangePercent: 1,
    });
    await expect(s.initialize(2)).rejects.toThrow(
      /collapse to duplicate price|contains no valid/
    );
    expect(exchange.createOrder).not.toHaveBeenCalled();
  });
});
