/** @format */

/**
 * useStrategyPerformance — the lifetime fill-ledger aggregate behind the
 * strategy-page PnL figures (Phase 1).
 *
 * Reads `GET /api/strategies/:id/performance` — the platform's own ledger
 * (fills attributed to the strategy), NOT the session counters on
 * `bot_instances` (those reset to 0 on every stop/start because each start
 * inserts a fresh session row). One query key per strategy, shared by both
 * render sites (workspace bot panel + BotControls RUNNING line) so a strategy
 * never costs two fetches.
 *
 * Gated on VERIFIED like every private-ledger read (`useRecentTrades`
 * precedent): below that the user has no exchange accounts, hence no fills.
 */

import { useQuery } from "@tanstack/react-query";
import { tradingApi } from "../../../infrastructure/api";
import type { StrategyPerformance } from "../../../infrastructure/api/trading";
import { useAuth } from "../../auth";

export interface StrategyPerformanceOptions {
  /** Extra kill-switch from the caller (e.g. no bot attached). */
  enabled?: boolean;
  /**
   * Poll while the strategy's bot is RUNNING (~30s) so the figures track
   * new fills; false = one fetch per mount/invalidation (stopped strategies
   * do not change under you).
   */
  live?: boolean;
}

export interface StrategyPerformanceResult {
  /** null until the first successful fetch — never fabricated zeros. */
  performance: StrategyPerformance | null;
  isLoading: boolean;
  /** Non-null = the fetch failed; render the session fallback, not an error. */
  error: unknown;
  /** Epoch ms of the last successful fetch (0 = never) — freshness chips. */
  dataUpdatedAt: number;
}

export const strategyPerformanceQueryKey = (strategyId: string | undefined) =>
  ["strategy-performance", strategyId ?? null] as const;

export const useStrategyPerformance = (
  strategyId: string | undefined,
  options: StrategyPerformanceOptions = {}
): StrategyPerformanceResult => {
  const { user } = useAuth();
  const isVerified = user?.userLevel === "VERIFIED";

  const query = useQuery({
    queryKey: strategyPerformanceQueryKey(strategyId),
    queryFn: async () => {
      const res = await tradingApi.getStrategyPerformance(strategyId!);
      return (res?.data ?? null) as StrategyPerformance | null;
    },
    enabled: (options.enabled ?? true) && isVerified && !!strategyId,
    staleTime: 15 * 1000,
    // Live only while the caller says the bot is RUNNING; never poll in a
    // background tab.
    refetchInterval: options.live ? 30 * 1000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });

  return {
    performance: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    dataUpdatedAt: query.dataUpdatedAt,
  };
};

export default useStrategyPerformance;
