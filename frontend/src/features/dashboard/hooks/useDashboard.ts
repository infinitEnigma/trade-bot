/** @format */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth";
import { useBalance } from "../../strategies/balance/hooks";
import { dashboardService } from "../services/dashboardService";
import { BalanceData, Position, Trade } from "../types/dashboard.types";

interface ApiError extends Error {
    response?: {
        status?: number;
    };
}

/**
 * Dashboard hook - manages all dashboard data fetching and state
 */
export const useDashboard = () => {
    const { user } = useAuth();
    const { balance: balanceData, loading: balanceLoading } = useBalance();

    // Check if user has Kodiak access (only VERIFIED users for automatic loading)
    const hasKodiakAccess =
        user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED";
    const hasAutomaticKodiakAccess = user?.userLevel === "VERIFIED"; // Only VERIFIED get automatic loading

    // 🔧 FIXED: Single combined query to prevent duplicate API calls
    // Previously: 2 separate queries both calling the same endpoints
    // Now: 1 query fetching both positions and trades together
    const {
        data: kodiakData,
        isLoading: kodiakLoading,
        error: kodiakError,
        refetch: refetchKodiakData,
        dataUpdatedAt: kodiakUpdatedAt,
    } = useQuery({
        queryKey: ["kodiak-data"], // Single key instead of separate position/trade keys
        queryFn: async () => {
            // Fetch both positions and trades in parallel but deduplicated at API level
            const [positionsResult, tradesResult] = await Promise.allSettled([
                dashboardService.getPositions(),
                dashboardService.getTrades(),
            ]);

            return {
                positions: positionsResult.status === 'fulfilled' ? positionsResult.value : [],
                trades: tradesResult.status === 'fulfilled' ? tradesResult.value : [],
            };
        },
        enabled: hasAutomaticKodiakAccess, // Only automatic for VERIFIED users
        staleTime: 60000,         // ⬆️ Increased to 60 seconds (from 30s) - data is fresh for 1 minute
        gcTime: 300000,           // 5 minutes - cache retention
        refetchOnWindowFocus: false, // 🚫 Disable focus refetch to reduce requests
        refetchInterval: 120000,     // 🔄 Auto-refresh every 2 minutes (from 30s)
        retry: (failureCount, error: Error) => {
            const apiError = error as ApiError;
            if (apiError?.response?.status === 429) return false; // Don't retry rate limits
            if (apiError?.response?.status === 400) return false;
            return failureCount < 2;
        },
    });

    // Process data from combined query
    const positions: Position[] = kodiakData?.positions || [];
    const trades: Trade[] = kodiakData?.trades || [];
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

    // Manual refresh function
    const refreshKodiakData = async () => {
        await refetchKodiakData();
    };

    // Data freshness indicators
    // Since React Query handles freshness internally with staleTime: 60000,
    // we can rely on the query's behavior rather than manual calculations
    const lastKodiakUpdate = kodiakUpdatedAt || 0;

    // For UI freshness indicators, we'll use a simpler approach
    // that doesn't require Date.now() calls during render
    const kodiakDataFresh = lastKodiakUpdate > 0;
    const kodiakDataStale = false; // Let React Query handle staleness internally

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
        isLoading: balanceLoading || kodiakLoading,
        balanceLoading,
        positionsLoading: kodiakLoading,
        tradesLoading: kodiakLoading,

        // Errors
        error: kodiakError,

        // Access flags
        hasKodiakAccess,
        hasAutomaticKodiakAccess,

        // Manual controls
        refreshKodiakData,

        // Data freshness
        kodiakDataFresh,
        kodiakDataStale,
        lastKodiakUpdate,
    };
};
