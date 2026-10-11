/** @format */

import { kodiakApi } from "../../../infrastructure/api";
import {
  Position,
  Trade,
  PortfolioPerformancePoint,
} from "../types/dashboard.types";

/**
 * Dashboard Service
 * Handles all dashboard-related data fetching and business logic
 */
export class DashboardService {
  private static instance: DashboardService;

  private constructor() {}

  public static getInstance(): DashboardService {
    if (!DashboardService.instance) {
      DashboardService.instance = new DashboardService();
    }
    return DashboardService.instance;
  }

  /**
   * Get Kodiak positions
   */
  async getPositions(): Promise<Position[]> {
    try {
      const response = await kodiakApi.getKodiakPositions();
      return response.success ? response.data?.rows || [] : [];
    } catch (error) {
      console.error("Dashboard service getPositions error:", error);
      return [];
    }
  }

  /**
   * Get Kodiak trades
   */
  async getTrades(): Promise<Trade[]> {
    try {
      const response = await kodiakApi.getKodiakTrades();
      return response.success ? response.data?.rows || [] : [];
    } catch (error) {
      console.error("Dashboard service getTrades error:", error);
      return [];
    }
  }

  /**
   * Trade-derived performance series (Kodiak fallback path — Lighter has a
   * venue-computed level series and never uses this).
   *
   * F4 semantics — what this curve is and is NOT:
   * - With `initialBalance` (a real, appropriately-timed equity baseline the
   *   caller sourced), the points are an EQUITY curve: baseline + cumulative
   *   venue-reported `realized_pnl`.
   * - Without one, the points are cumulative REALISED PnL anchored at 0 —
   *   labelled as PnL, never as account equity. The old behaviour invented a
   *   $10,000 start and clamped the curve at 0; both are gone.
   * - Trades whose venue `realized_pnl` is absent or unparseable are SKIPPED,
   *   not approximated by `(close − open) × qty` — that fallback omits fees,
   *   funding and partial-close accounting and was never venue truth
   *   (Lighter fill rows carry `realized_pnl: "0"` by construction).
   */
  calculatePortfolioPerformance(
    trades: Trade[],
    initialBalance?: number
  ): PortfolioPerformancePoint[] {
    if (!trades || trades.length === 0) {
      return initialBalance === undefined
        ? []
        : [{ time: "No data", value: initialBalance }];
    }

    // Only venue-reported realised PnL moves the curve; unknown is skipped.
    const realizedRows = trades
      .map(trade => {
        const realized = parseFloat(trade.realized_pnl ?? "");
        return {
          realized,
          timestamp: trade.close_timestamp || trade.open_timestamp || 0,
        };
      })
      .filter(
        (row): row is { realized: number; timestamp: number } =>
          Number.isFinite(row.realized) && row.timestamp > 0
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    if (realizedRows.length === 0) {
      // Nothing venue-reported to plot: unavailable, not fabricated.
      return initialBalance === undefined
        ? []
        : [{ time: "No data", value: initialBalance }];
    }

    const performance: PortfolioPerformancePoint[] = [
      initialBalance === undefined
        ? { time: "Start", value: 0 }
        : { time: "Start", value: initialBalance },
    ];
    let current = initialBalance ?? 0;

    realizedRows.forEach(row => {
      current += row.realized;
      // No non-negative clamp: a drawdown below the baseline is information,
      // not a rendering defect.
      performance.push({
        time: new Date(row.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        value: current,
      });
    });

    return performance;
  }

  /**
   * Get profitable positions count
   */
  getProfitablePositionsCount(positions: Position[]): number {
    return positions.filter(p => parseFloat(p.unsettled_pnl || "0") >= 0)
      .length;
  }

  /**
   * Format currency values
   */
  formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  }
}

export const dashboardService = DashboardService.getInstance();
