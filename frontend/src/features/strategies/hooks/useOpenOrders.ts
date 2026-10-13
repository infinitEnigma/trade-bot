/** @format */

import { useQuery } from "@tanstack/react-query";
import {
  marketApi,
  type OpenOrderRow,
} from "../../../infrastructure/api/market";

/**
 * Phase 3 open-orders query — the chart's order levels (and later the
 * workspace's open-orders table) share this cache entry.
 *
 * The scope mirrors `GET /api/market/orders`: `exchangeAccountId` selects the
 * account (the backend falls back to the legacy Kodiak default when absent —
 * D4's unscoped fallback for strategies without a binding) and `symbol`
 * narrows to one market (backend normalises venue forms, bare `BTC` included).
 * Both go into the cache key so two accounts (or two symbols) never share rows.
 */
export interface OpenOrdersScope {
  exchangeAccountId?: string;
  symbol?: string;
}

/** Same shape as the API-layer dedupe key (market.ts) — one cache per scope. */
export const openOrdersQueryKey = ({
  exchangeAccountId,
  symbol,
}: OpenOrdersScope = {}): readonly [string, string, string, string] =>
  [
    "market",
    "orders",
    exchangeAccountId ?? "default",
    symbol ?? "all",
  ] as const;

export const useOpenOrders = (
  scope: OpenOrdersScope = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: openOrdersQueryKey(scope),
    queryFn: async (): Promise<{
      success: boolean;
      data: OpenOrderRow[];
      timestamp?: number;
    }> => marketApi.getOpenOrders(scope),
    // The backend pins rows to a 5 s venue cache (OPEN_ORDERS_TTL_MS) — poll
    // at the same cadence so price levels track the resting book.
    staleTime: 5000,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    enabled: options.enabled ?? true,
  });
