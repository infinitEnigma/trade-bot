/** @format */

import { useEffect, useState } from "react";
import { api } from "../lib/api";

export interface Balance {
  walletBalance: number;
  accountBalance: number;
  availableBalance: number;
  reservedBalance: number;
  totalAssets: number;
  timestamp: string;
}

export const useBalance = (autoRefresh: boolean = true) => {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ Fetch balance from backend
  const fetchBalance = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.getCurrentBalance();

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
      const response = await api.refreshBalance();

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

  // ✅ Initial fetch
  useEffect(() => {
    fetchBalance();

    // Auto-refresh every 60 seconds
    if (autoRefresh) {
      const interval = setInterval(fetchBalance, 60000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  return {
    balance,
    loading,
    error,
    refresh,
  };
};

export default useBalance;
