/** @format */

import { describe, it, expect, vi } from "vitest";
import { dashboardService } from "./dashboardService";
import { Trade } from "../types/dashboard.types";

vi.mock("../../../infrastructure/api", () => ({
  kodiakApi: {
    getKodiakPositions: vi.fn(),
    getKodiakTrades: vi.fn(),
  },
}));

const trade = (overrides: Partial<Trade>): Trade => ({
  symbol: "PERP_BTC_USDC",
  side: "LONG",
  closed_position_qty: "1",
  ...overrides,
});

describe("dashboardService.calculatePortfolioPerformance", () => {
  it("builds an equity curve only from a caller-supplied baseline + venue PnL", () => {
    const points = dashboardService.calculatePortfolioPerformance(
      [
        trade({ realized_pnl: "25.5", close_timestamp: 1000 }),
        trade({ realized_pnl: "-5.5", close_timestamp: 2000 }),
      ],
      10000
    );

    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ time: "Start", value: 10000 });
    expect(points[1].value).toBe(10025.5);
    expect(points[2].value).toBe(10020);
  });

  it("without a baseline anchors cumulative realised PnL at 0 (F4: no fabricated start)", () => {
    const points = dashboardService.calculatePortfolioPerformance([
      trade({ realized_pnl: "25.5", close_timestamp: 1000 }),
      trade({ realized_pnl: "-5.5", close_timestamp: 2000 }),
    ]);

    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ time: "Start", value: 0 });
    expect(points[1].value).toBe(25.5);
    expect(points[2].value).toBe(20);
  });

  it("never invents a $10,000 default (F4: the old synthetic baseline is gone)", () => {
    // No baseline + no trades → unavailable, not a fabricated Start point.
    expect(dashboardService.calculatePortfolioPerformance([])).toEqual([]);
  });

  it("skips trades without venue realized_pnl instead of estimating them (F4)", () => {
    const points = dashboardService.calculatePortfolioPerformance(
      [
        // Venue-reported rows.
        trade({ realized_pnl: "10", close_timestamp: 1000 }),
        trade({ realized_pnl: "-4", close_timestamp: 3000 }),
        // Row with no realized_pnl — the old (close − open) × qty fallback
        // would have added +10 here; it must contribute NOTHING.
        trade({
          avg_open_price: "100",
          avg_close_price: "110",
          close_timestamp: 2000,
        }),
      ],
      10000
    );

    // Start + 2 venue rows only: 10000 → 10010 → 10006.
    expect(points).toHaveLength(3);
    expect(points[1].value).toBe(10010);
    expect(points[2].value).toBe(10006);
  });

  it("does not clamp the curve at zero (F4: drawdowns are information)", () => {
    const points = dashboardService.calculatePortfolioPerformance(
      [
        trade({ realized_pnl: "5", close_timestamp: 1000 }),
        trade({ realized_pnl: "-20", close_timestamp: 2000 }),
      ],
      10
    );

    expect(points[2].value).toBe(-5);
  });

  it("returns a single No-data point for empty trades when a baseline exists", () => {
    expect(dashboardService.calculatePortfolioPerformance([], 5000)).toEqual([
      { time: "No data", value: 5000 },
    ]);
  });

  it("returns unavailable when no row carries venue PnL and no baseline exists", () => {
    const points = dashboardService.calculatePortfolioPerformance([
      trade({
        avg_open_price: "100",
        avg_close_price: "101",
        closed_position_qty: "2",
        close_timestamp: 1000,
      }),
    ]);

    // No venue PnL, no baseline → nothing authoritative to plot.
    expect(points).toEqual([]);
  });
});
