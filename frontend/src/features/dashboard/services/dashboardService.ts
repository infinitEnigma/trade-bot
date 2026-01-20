/** @format */

import { tradingApi } from "../../../infrastructure/api";
import { Position, Trade, PortfolioPerformancePoint } from "../types/dashboard.types";

/**
 * Dashboard Service
 * Handles all dashboard-related data fetching and business logic
 */
export class DashboardService {
    private static instance: DashboardService;

    private constructor() { }

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
            const response = await tradingApi.getKodiakPositions();
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
            const response = await tradingApi.getKodiakTrades();
            return response.success ? response.data?.rows || [] : [];
        } catch (error) {
            console.error("Dashboard service getTrades error:", error);
            return [];
        }
    }

    /**
     * Calculate portfolio performance from trades
     */
    calculatePortfolioPerformance(
        trades: Trade[],
        initialBalance: number = 10000
    ): PortfolioPerformancePoint[] {
        if (!trades || trades.length === 0) {
            return [{ time: "No data", value: initialBalance }];
        }

        // Sort trades by close timestamp
        const sortedTrades = [...trades].sort(
            (a, b) => (a.close_timestamp || 0) - (b.close_timestamp || 0)
        );

        const performance = [{ time: "Start", value: initialBalance }];
        let currentBalance = initialBalance;

        sortedTrades.forEach(trade => {
            const pnl = parseFloat(trade.avg_close_price || "0") - parseFloat(trade.avg_open_price || "0");
            // For simplicity, assume each trade has 1 unit
            currentBalance += pnl;

            const timestamp = new Date(
                trade.close_timestamp || trade.open_timestamp || Date.now()
            );
            const timeString = timestamp.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
            });

            performance.push({
                time: timeString,
                value: Math.max(0, currentBalance), // Ensure non-negative
            });
        });

        return performance;
    }

    /**
     * Get profitable positions count
     */
    getProfitablePositionsCount(positions: Position[]): number {
        return positions.filter(p => parseFloat(p.unsettled_pnl || "0") >= 0).length;
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
