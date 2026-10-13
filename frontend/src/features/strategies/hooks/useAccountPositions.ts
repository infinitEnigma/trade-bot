/** @format */

import { useQuery } from "@tanstack/react-query";
import {
  marketApi,
  type AccountPositionRow,
} from "../../../infrastructure/api/market";

/** The positions scope — the account (absent = backend default fallback). */
export interface AccountPositionsScope {
  exchangeAccountId?: string;
}

/** Same shape as the API-layer dedupe key (market.ts) — one cache per account. */
export const accountPositionsQueryKey = ({
  exchangeAccountId,
}: AccountPositionsScope = {}): readonly [string, string, string] =>
  ["market", "positions", exchangeAccountId ?? "all"] as const;

/**
 * Phase 3.1 (review P2-4) account-positions query — the workspace's
 * positions view. Scope mirrors `GET /api/market/positions?exchangeAccountId=`
 * (backend C3b): one account's venue book; absent the account the backend
 * answers its default-account scope (the documented D4 unscoped fallback —
 * same as the open-orders read). Rows are account × market, NOT
 * strategy-attributed; the workspace filters to the selected strategy's
 * market and labels the attribution. Cadence matches the orders read (the
 * backend pins positions to a short venue cache — 5 s stale, 10 s poll).
 */
export const useAccountPositions = (
  scope: AccountPositionsScope = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: accountPositionsQueryKey(scope),
    queryFn: async (): Promise<{
      success: boolean;
      data: AccountPositionRow[];
    }> => marketApi.getPositions(scope.exchangeAccountId),
    staleTime: 5000,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    enabled: options.enabled ?? true,
  });
