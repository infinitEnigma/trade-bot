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
  it("prefers venue-reported realized_pnl", () => {
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

  it("falls back to (close − open) × qty when realized_pnl is absent", () => {
    const points = dashboardService.calculatePortfolioPerformance(
      [
        trade({
          avg_open_price: "100",
          avg_close_price: "110",
          closed_position_qty: "1",
          close_timestamp: 1000,
        }),
        trade({
          avg_open_price: "200",
          avg_close_price: "190",
          closed_position_qty: "1",
          close_timestamp: 2000,
        }),
      ],
      10000
    );

    // Start + 2 trades: +10 then -10 → back to flat.
    expect(points).toHaveLength(3);
    expect(points[1].value).toBe(10010);
    expect(points[2].value).toBe(10000);
  });

  it("returns a single Start point when there are no trades", () => {
    expect(dashboardService.calculatePortfolioPerformance([], 5000)).toEqual([
      { time: "No data", value: 5000 },
    ]);
  });

  it("scales the fallback PnL by closed quantity for a 14-trade series", () => {
    const trades = Array.from({ length: 14 }, (_, i) =>
      trade({
        avg_open_price: "100",
        avg_close_price: "101",
        closed_position_qty: "2",
        close_timestamp: 1000 + i,
      })
    );
    const points = dashboardService.calculatePortfolioPerformance(
      trades,
      10000
    );

    // Start + 14 trades × +2 → 10028 final equity.
    expect(points).toHaveLength(15);
    expect(points[14].value).toBe(10028);
  });
});
