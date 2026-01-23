/** @format */

import { useEffect, useState } from "react";
import { UserLevel } from "@trade-bot/shared";
import { balanceApi } from "../../../../infrastructure/api";
import { globalBalanceManager } from "../../../../shared/services/balance-manager";
import { useAuth } from "../../../auth";

export interface Balance {
    walletBalance: number;
    accountBalance: number;
    availableBalance: number;
    reservedBalance: number;
    totalAssets: number;
    timestamp: string;
}

/**
 * OPTIMIZED BALANCE HOOK
 *
 * Uses global balance manager instead of individual timers.
 * Prevents API call flood while maintaining data freshness.
 */
export const useOptimizedBalance = (autoRefresh: boolean = true) => {
    const { user } = useAuth();
    const [balance, setBalance] = useState<Balance | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Unique ID for this hook instance
    const hookId = `balance-hook-${Math.random().toString(36).substr(2, 9)}`;

    // Fetch balance initially (only for VERIFIED users)
    const fetchBalance = async () => {
        // Don't fetch for BASIC users
        if (user?.userLevel !== UserLevel.VERIFIED) {
            setBalance(null);
            setError(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const response = await balanceApi.getCurrentBalance();

            if (response.success) {
                setBalance(response.data);
            } else {
                // Handle missing Kodiak credentials gracefully
                if (response.error?.includes("Kodiak account not connected")) {
                    setBalance(null); // No balance data available
                    setError(null); // Don't show as error
                } else {
                    setError(response.error || "Failed to fetch balance");
                }
            }
        } catch (err) {
            setError((err as Error).message);
            console.error("Optimized balance fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    // Initial fetch
    useEffect(() => {
        fetchBalance();
    }, [user?.userLevel]);

    // Subscribe to global balance manager for auto-refresh
    useEffect(() => {
        if (!autoRefresh || user?.userLevel !== UserLevel.VERIFIED) {
            return;
        }

        console.log(`💰 Optimized Balance: Subscribing ${hookId} to global manager`);

        // Subscribe to global balance updates
        const unsubscribe = globalBalanceManager.subscribe(hookId, (newBalance) => {
            console.log(`💰 Optimized Balance: Received update for ${hookId}`);
            setBalance(newBalance);
            setError(null);
        });

        // Cleanup subscription
        return () => {
            console.log(`💰 Optimized Balance: Unsubscribing ${hookId}`);
            unsubscribe();
        };
    }, [autoRefresh, user?.userLevel, hookId]);

    // Manual refresh function
    const refresh = async () => {
        try {
            setLoading(true);
            // Use global manager for consistency
            await globalBalanceManager.forceRefresh();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return {
        balance,
        loading,
        error,
        refresh,
    };
};