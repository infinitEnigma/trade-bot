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

    // Check if user has Kodiak access (only VERIFIED users for automatic loading)
    const hasKodiakAccess =
        user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED";
    const hasAutomaticKodiakAccess = user?.userLevel === "VERIFIED"; // Only VERIFIED get automatic loading

    // Fetch positions with optimized settings
    const {
        data: positionsData,
        isLoading: positionsLoading,
        error: positionsError,
        refetch: refetchPositions,
        dataUpdatedAt: positionsUpdatedAt,
    } = useQuery({
        queryKey: ["kodiak-positions"],
        queryFn: () => dashboardService.getPositions(),
        enabled: hasAutomaticKodiakAccess, // Only automatic for VERIFIED users
        staleTime: 60000,         // ⬆️ Increased to 60 seconds (from 30s)
        gcTime: 300000,           // 5 minutes
        refetchOnWindowFocus: false, // 🚫 Disable focus refetch to reduce requests
        refetchInterval: 120000,     // 🔄 Auto-refresh every 2 minutes (from 30s)
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 429) return false; // Don't retry rate limits
            if (error?.response?.status === 400) return false;
            return failureCount < 2;
        },
    });

    // Fetch trades with optimized settings
    const {
        data: tradesData,
        isLoading: tradesLoading,
        error: tradesError,
        refetch: refetchTrades,
        dataUpdatedAt: tradesUpdatedAt,
    } = useQuery({
        queryKey: ["kodiak-trades"],
        queryFn: () => dashboardService.getTrades(),
        enabled: hasAutomaticKodiakAccess, // Only automatic for VERIFIED users
        staleTime: 60000,          // ⬆️ Increased to 60 seconds (from 30s)
        gcTime: 300000,            // 5 minutes
        refetchOnWindowFocus: false, // 🚫 Disable focus refetch to reduce requests
        refetchInterval: 120000,      // 🔄 Auto-refresh every 2 minutes (from 30s)
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 429) return false; // Don't retry rate limits
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

    // Manual refresh function
    const refreshKodiakData = async () => {
        await Promise.all([
            refetchPositions(),
            refetchTrades(),
        ]);
    };

    // Data freshness indicators
    const lastKodiakUpdate = Math.max(positionsUpdatedAt || 0, tradesUpdatedAt || 0);
    const kodiakDataFresh = Date.now() - lastKodiakUpdate < 60000; // Fresh if updated within 1 minute
    const kodiakDataStale = Date.now() - lastKodiakUpdate > 300000; // Stale if older than 5 minutes

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
        hasAutomaticKodiakAccess,

        // Manual controls
        refreshKodiakData,

        // Data freshness
        kodiakDataFresh,
        kodiakDataStale,
        lastKodiakUpdate,
    };
};
