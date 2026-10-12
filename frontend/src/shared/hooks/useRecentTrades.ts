/** @format */

/**
 * useRecentTrades — the ledger trades feed behind the Recent-Trades surfaces
 * (Batch 2 of the multi-account trades plan).
 *
 * Reads `GET /api/trades` (the platform's own durable ledger — fills the
 * engine executed, strategy- and account-attributed), NOT the per-account
 * venue proxy that feeds the realized-PnL fallback in usePortfolioSummary.
 * Latest-N semantics: the newest `limit` rows (default 50).
 *
 * Scoping:
 * - no filters → every fill the caller's bots recorded (Dashboard default);
 * - `exchangeAccountId` → one exchange account's fills;
 * - `strategyId` → one strategy's fills (strategy card).
 *
 * Gated on VERIFIED like every private-data read (below that the user has no
 * exchange accounts, hence no bots, hence no ledger rows).
 */

import { useQuery } from "@tanstack/react-query";
import { tradingApi } from "../../infrastructure/api";
import type { LedgerTradeRow } from "../../infrastructure/api/trading";
import { useAuth } from "../../features/auth";

export interface RecentTradesFilters {
  /** Scope to one exchange account's fills. */
  exchangeAccountId?: string;
  /** Scope to one strategy's fills. */
  strategyId?: string;
  /** Newest N rows (backend default 50, cap 200). */
  limit?: number;
  /** Extra kill-switch from the caller (e.g. render-gated sections). */
  enabled?: boolean;
}

export interface RecentTradesResult {
  trades: LedgerTradeRow[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  /** Re-fetch on demand (e.g. a refresh button). */
  refetch: () => void;
}

export const useRecentTrades = (
  filters: RecentTradesFilters = {}
): RecentTradesResult => {
  const { user } = useAuth();
  const isVerified = user?.userLevel === "VERIFIED";

  const query = useQuery({
    queryKey: [
      "ledger-trades",
      filters.exchangeAccountId ?? null,
      filters.strategyId ?? null,
      filters.limit ?? null,
    ],
    queryFn: async () => {
      const res = await tradingApi.getLedgerTrades({
        exchangeAccountId: filters.exchangeAccountId,
        strategyId: filters.strategyId,
        limit: filters.limit,
      });
      return (res?.data?.rows ?? []) as LedgerTradeRow[];
    },
    enabled: (filters.enabled ?? true) && isVerified,
    staleTime: 30 * 1000,
    retry: false,
  });

  return {
    trades: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
  };
};

export default useRecentTrades;
