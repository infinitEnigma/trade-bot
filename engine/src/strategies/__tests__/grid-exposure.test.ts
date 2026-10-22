/**
 * Shared grid-exposure calculator — the ONE implementation of the grid's
 * resting exposure rule, used by the engine (reports it) and the backend
 * (recomputes it independently to enforce admission).
 *
 * These tests live in the engine suite because that package already has a
 * jest config and already depends on `@trade-bot/shared` — the calculator
 * itself is shared code, but the cross-check that matters most (engine's
 * tick-quantized grid vs the calculator's exact rule) needs the engine.
 */

import {
  agreesWithin,
  computeGridExposure,
  computeGridLevelPrices,
  relativeDifference,
} from "@trade-bot/shared";
import { GridTradingStrategy } from "../grid";
import { ExchangeClient } from "../../domain/exchange";
import { GridStrategyConfig } from "../../types/strategy";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const CONFIG: GridStrategyConfig = {
  symbol: "PERP_BTC_USDC",
  gridSize: 10,
  orderQuantity: 1,
  gridRangePercent: 5,
};

function makeExchange(): {
  getTicker: jest.Mock;
  getOrder: jest.Mock;
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  getPositions: jest.Mock;
  listOpenOrders: jest.Mock;
  queryOrderByClientOrderId: jest.Mock;
  getMarketRules: jest.Mock;
} {
  return {
    getTicker: jest
      .fn()
      .mockResolvedValue({ symbol: CONFIG.symbol, price: 100 }),
    getOrder: jest.fn().mockResolvedValue({ orderId: "O", status: "OPEN" }),
    createOrder: jest.fn().mockResolvedValue({ orderId: "O1", status: "OPEN" }),
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

let snapTmpDir: string;
beforeEach(() => {
  snapTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-exposure-"));
  process.env.GRID_SNAPSHOT_DIR = snapTmpDir;
});
afterEach(() => {
  delete process.env.GRID_SNAPSHOT_DIR;
  if (snapTmpDir) {
    fs.rmSync(snapTmpDir, { recursive: true, force: true });
  }
});

describe("computeGridLevelPrices", () => {
  it("builds gridSize + 1 levels evenly spaced across the band", () => {
    const prices = computeGridLevelPrices(100, {
      gridSize: 2,
      gridRangePercent: 5,
      orderQuantity: 1,
    });
    expect(prices).toHaveLength(3);
    // Band = 100 ± 2.5 => [97.5, 102.5]; spacing 2.5.
    expect(prices[0]).toBeCloseTo(97.5, 10);
    expect(prices[1]).toBeCloseTo(100, 10);
    expect(prices[2]).toBeCloseTo(102.5, 10);
  });

  it("scales the band with the baseline price", () => {
    const prices = computeGridLevelPrices(200, {
      gridSize: 2,
      gridRangePercent: 5,
      orderQuantity: 1,
    });
    expect(prices[0]).toBeCloseTo(195, 10);
    expect(prices[1]).toBeCloseTo(200, 10);
    expect(prices[2]).toBeCloseTo(205, 10);
  });

  it("rejects invalid inputs (fail-closed, never a plausible-looking figure)", () => {
    const cfg = { gridSize: 10, gridRangePercent: 5, orderQuantity: 1 };
    expect(() => computeGridLevelPrices(0, cfg)).toThrow(/positive finite/);
    expect(() => computeGridLevelPrices(Number.NaN, cfg)).toThrow(
      /positive finite/
    );
    expect(() => computeGridLevelPrices(100, { ...cfg, gridSize: 0 })).toThrow(
      /gridSize/
    );
    expect(() =>
      computeGridLevelPrices(100, { ...cfg, orderQuantity: 0 })
    ).toThrow(/orderQuantity/);
    expect(() =>
      computeGridLevelPrices(100, { ...cfg, gridRangePercent: -1 })
    ).toThrow(/gridRangePercent/);
  });
});

describe("computeGridExposure", () => {
  const cfg = { gridSize: 10, gridRangePercent: 5, orderQuantity: 1 };

  it("sums only the levels the engine would arm a BUY on", () => {
    // 11 levels from 97.5 to 102.5; BUY-eligible are level.price >= 100.
    const result = computeGridExposure(100, 100, cfg);
    expect(result.levels).toHaveLength(11);
    expect(result.buyLevels).toHaveLength(6);
    expect(result.buyLevels[0]?.price).toBeCloseTo(100, 10);
    expect(result.estimatedRestingNotional).toBeCloseTo(607.5, 8);
  });

  it("marks every level below the current price as ineligible", () => {
    const result = computeGridExposure(100, 102.6, cfg);
    // Only levels >= 102.6 remain eligible — none, since the top is 102.5.
    expect(result.buyLevels).toHaveLength(0);
    expect(result.estimatedRestingNotional).toBe(0);
    expect(result.maxOrderNotional).toBe(0);
  });

  it("reports the largest single order notional among the eligible levels", () => {
    const result = computeGridExposure(100, 100, cfg);
    // The top eligible level (102.5) carries the biggest order.
    expect(result.maxOrderNotional).toBeCloseTo(102.5, 8);
  });

  it("scales the exposure with the order quantity", () => {
    const single = computeGridExposure(100, 100, cfg);
    const ten = computeGridExposure(100, 100, { ...cfg, orderQuantity: 10 });
    expect(ten.estimatedRestingNotional).toBeCloseTo(
      single.estimatedRestingNotional * 10,
      6
    );
  });

  it("moves the exposure when the baseline price moves", () => {
    const at100 = computeGridExposure(100, 100, cfg).estimatedRestingNotional;
    const at200 = computeGridExposure(200, 200, cfg).estimatedRestingNotional;
    expect(at200).toBeCloseTo(at100 * 2, 6);
  });
});

describe("engine grid vs the shared calculator", () => {
  it("agree on the resting exposure for a tick-quantized grid", async () => {
    // The engine snaps levels to the market tick; the shared calculator does
    // not. The two must still agree closely enough for the backend's
    // cross-check tolerance to accept them.
    const exchange = makeExchange();
    const strategy = new GridTradingStrategy(
      "bot-1",
      CONFIG,
      exchange as unknown as ExchangeClient
    );
    await strategy.initialize(100);

    const shared = computeGridExposure(100, 100, {
      gridSize: CONFIG.gridSize,
      gridRangePercent: CONFIG.gridRangePercent,
      orderQuantity: CONFIG.orderQuantity,
    });

    expect(
      agreesWithin(
        strategy.estimatedRestingNotional,
        shared.estimatedRestingNotional,
        0.001
      )
    ).toBe(true);
  });
});

describe("relativeDifference / agreesWithin", () => {
  it("returns 0 for identical figures and Infinity for non-finite ones", () => {
    expect(relativeDifference(100, 100)).toBe(0);
    // Symmetric relative difference: |a-b| / max(|a|,|b|) = 1/101.
    expect(relativeDifference(100, 101)).toBeCloseTo(1 / 101, 12);
    expect(relativeDifference(101, 100)).toBeCloseTo(1 / 101, 12);
    expect(relativeDifference(Number.NaN, 100)).toBe(Number.POSITIVE_INFINITY);
    expect(relativeDifference(100, Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it("treats two zeros as agreeing", () => {
    expect(relativeDifference(0, 0)).toBe(0);
    expect(agreesWithin(0, 0, 0)).toBe(true);
  });

  it("fails the check when either side is not finite", () => {
    expect(agreesWithin(Number.NaN, 100, 0.01)).toBe(false);
    expect(agreesWithin(100, Number.POSITIVE_INFINITY, 0.01)).toBe(false);
  });

  it("rejects a forged estimate that differs beyond the tolerance", () => {
    expect(agreesWithin(607.5, 607.5, 0.001)).toBe(true);
    expect(agreesWithin(607.5, 1000, 0.001)).toBe(false);
    // A small relative difference stays inside the band.
    expect(agreesWithin(100, 100.05, 0.001)).toBe(true);
    expect(agreesWithin(100, 100.5, 0.001)).toBe(false);
  });
});
