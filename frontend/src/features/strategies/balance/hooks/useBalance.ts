/** @format */

import { useEffect, useState } from "react";
import { UserLevel } from "@trade-bot/shared";
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
 * useBalance hook - migrated to trading/balance feature
 * Now uses global balance manager for coordinated API requests
 */
export const useBalance = (autoRefresh: boolean = true) => {
    const { user } = useAuth();
    const [balance, setBalance] = useState<Balance | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Unique ID for this hook instance
    const hookId = `balance-hook-${Math.random().toString(36).substr(2, 9)}`;

    // Initial fetch (only for VERIFIED users)
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

            // Use global manager's last known data first
            const lastData = globalBalanceManager.getLastBalanceData();
            if (lastData) {
                setBalance(lastData);
            }

            // Then trigger refresh (will notify subscribers via subscription)
            await globalBalanceManager.forceRefresh();

        } catch (err) {
            setError((err as Error).message);
            console.error("Balance fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    // Manual refresh function using global manager
    const refresh = async () => {
        try {
            setLoading(true);
            await globalBalanceManager.forceRefresh();
        } catch (err) {
            setError((err as Error).message);
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

        console.log(`💰 useBalance: Subscribing ${hookId} to global manager`);

        // Subscribe to global balance updates
        const unsubscribe = globalBalanceManager.subscribe(hookId, (newBalance) => {
            console.log(`💰 useBalance: Received update for ${hookId}`);
            setBalance(newBalance);
            setError(null);
        });

        // Cleanup subscription
        return () => {
            console.log(`💰 useBalance: Unsubscribing ${hookId}`);
            unsubscribe();
        };
    }, [autoRefresh, user?.userLevel, hookId]);

    return {
        balance,
        loading,
        error,
        refresh,
    };
};

export default useBalance;
