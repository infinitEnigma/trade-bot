/** @format */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth";
import { useBalance } from "../../trading/balance/hooks";
import { dashboardService } from "../services/dashboardService";
import { BalanceData, Position, Trade } from "../types/dashboard.types";

/**
 * Dashboard hook - manages all dashboard data fetching and state
 */
export const useDashboard = () => {
    const { user } = useAuth();
    const { balance: balanceData, loading: balanceLoading } = useBalance();

    // Check if user has Kodiak access
    const hasKodiakAccess =
        user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED";

    // Fetch positions
    const {
        data: positionsData,
        isLoading: positionsLoading,
        error: positionsError,
    } = useQuery({
        queryKey: ["kodiak-positions"],
        queryFn: () => dashboardService.getPositions(),
        enabled: hasKodiakAccess,
        staleTime: 30000, // 30 seconds
        gcTime: 300000, // 5 minutes
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 400) return false;
            return failureCount < 2;
        },
    });

    // Fetch trades
    const {
        data: tradesData,
        isLoading: tradesLoading,
        error: tradesError,
    } = useQuery({
        queryKey: ["kodiak-trades"],
        queryFn: () => dashboardService.getTrades(),
        enabled: hasKodiakAccess,
        staleTime: 30000,
        gcTime: 300000,
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 400) return false;
            return failureCount < 2;
        },
    });

    // Process data
    const positions: Position[] = positionsData || [];
    const trades: Trade[] = tradesData || [];
    const profitablePositions = dashboardService.getProfitablePositionsCount(positions);

    // Create balance object
    const balance: BalanceData | null = balanceData ? {
        walletBalance: balanceData.walletBalance || 0,
        accountBalance: balanceData.accountBalance || 0,
        availableBalance: balanceData.availableBalance || 0,
        totalAssets: balanceData.totalAssets || 0,
    } : null;

    // Create portfolio data
    const portfolio = balance ? {
        totalBalance: balance.accountBalance,
        pnl: 0, // TODO: Calculate from trades
        pnlPercent: 0, // TODO: Calculate percentage
        dailyVolume: 0, // TODO: Add volume tracking
        totalTrades: trades.length,
    } : null;

    // Calculate performance data
    const performanceData = dashboardService.calculatePortfolioPerformance(
        trades,
        balance?.accountBalance || 10000
    );

    return {
        // Data
        balance,
        positions,
        trades,
        portfolio,
        performanceData,

        // Metadata
        profitablePositions,
        positionsCount: positions.length,

        // Loading states
        isLoading: balanceLoading || positionsLoading || tradesLoading,
        balanceLoading,
        positionsLoading,
        tradesLoading,

        // Errors
        error: positionsError || tradesError,

        // Access flags
        hasKodiakAccess,
    };
};
