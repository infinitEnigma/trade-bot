/** @format */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth";
import { useBalance } from "../../strategies/balance/hooks";
import { dashboardService } from "../services/dashboardService";
import { BalanceData, Position, Trade } from "../types/dashboard.types";
import React from "react";

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
    const lastKodiakUpdate = kodiakUpdatedAt || 0;
    const currentTime = React.useMemo(() => Date.now(), []);
    const kodiakDataFresh = currentTime - lastKodiakUpdate < 60000; // Fresh if updated within 1 minute
    const kodiakDataStale = currentTime - lastKodiakUpdate > 300000; // Stale if older than 5 minutes

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
