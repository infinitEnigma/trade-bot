/** @format */

import { useEffect, useState, useCallback } from "react";
import { UserLevel, Balance as DomainBalance } from "../../../../../../shared/src";
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
 * Convert domain Balance class to legacy format for frontend compatibility
 */
function convertDomainBalanceToLegacy(domainBalance: DomainBalance): Balance {
    return {
        walletBalance: domainBalance.total,
        accountBalance: domainBalance.total,
        availableBalance: domainBalance.available,
        reservedBalance: domainBalance.locked,
        totalAssets: domainBalance.total,
        timestamp: domainBalance.lastUpdated.toISOString()
    };
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
    const fetchBalance = useCallback(async () => {
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
                // Handle both domain Balance class and legacy format
                let balanceToSet: Balance | null = null;
                if (lastData instanceof DomainBalance) {
                    // Convert domain balance to legacy format
                    balanceToSet = convertDomainBalanceToLegacy(lastData);
                } else if (lastData && typeof lastData === 'object' && 'timestamp' in lastData) {
                    // Already in legacy format
                    balanceToSet = lastData as unknown as Balance;
                }
                setBalance(balanceToSet);
            }

            // Then trigger refresh (will notify subscribers via subscription)
            await globalBalanceManager.forceRefresh();

        } catch (err) {
            setError((err as Error).message);
            console.error("Balance fetch error:", err);
        } finally {
            setLoading(false);
        }
    }, [user?.userLevel]);

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
    }, [fetchBalance]);

    // Subscribe to global balance manager for auto-refresh
    useEffect(() => {
        if (!autoRefresh || user?.userLevel !== UserLevel.VERIFIED) {
            return;
        }

        console.log(`💰 useBalance: Subscribing ${hookId} to global manager`);

        // Subscribe to global balance updates
        const unsubscribe = globalBalanceManager.subscribe(hookId, (newBalance) => {
            console.log(`💰 useBalance: Received update for ${hookId}`);

            // Handle both domain Balance class and legacy format
            let balanceToSet: Balance | null = null;
            if (newBalance instanceof DomainBalance) {
                // Convert domain balance to legacy format
                balanceToSet = convertDomainBalanceToLegacy(newBalance);
            } else if (newBalance && typeof newBalance === 'object' && 'timestamp' in newBalance) {
                // Already in legacy format
                balanceToSet = newBalance as unknown as Balance;
            }

            setBalance(balanceToSet);
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
