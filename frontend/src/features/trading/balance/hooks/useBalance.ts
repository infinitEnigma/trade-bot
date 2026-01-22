/** @format */

import { useEffect, useState } from "react";
import { UserLevel } from "@trade-bot/shared";

// Import from infrastructure
import { balanceApi } from "../../../../infrastructure/api";

// Import from features
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
 */
export const useBalance = (autoRefresh: boolean = true) => {
    const { user } = useAuth();
    const [balance, setBalance] = useState<Balance | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ✅ Fetch balance from backend (only for VERIFIED users)
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
            console.error("Balance fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    // ✅ Refresh balance manually
    const refresh = async () => {
        try {
            setLoading(true);
            const response = await balanceApi.refreshBalance();

            if (response.success) {
                setBalance(response.data);
            } else {
                setError(response.error);
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    // ✅ Initial fetch and smart auto-refresh (only for VERIFIED users)
    useEffect(() => {
        fetchBalance();

        // Smart auto-refresh: only when tab is visible, user is active, and VERIFIED
        const shouldAutoRefresh = autoRefresh && user?.userLevel === UserLevel.VERIFIED;

        if (shouldAutoRefresh) {
            const interval = setInterval(() => {
                // Only refresh if tab is visible (user is actively using the app)
                if (document.visibilityState === 'visible') {
                    fetchBalance();
                }
            }, 300000); // ⬆️ Increased from 2min to 5min for better rate limit management

            return () => clearInterval(interval);
        }
    }, [user?.userLevel, autoRefresh]);

    return {
        balance,
        loading,
        error,
        refresh,
    };
};

export default useBalance;
