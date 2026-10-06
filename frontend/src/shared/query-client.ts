/** @format */

import { QueryClient } from "@tanstack/react-query";

/**
 * App-scoped React Query client. Lives outside the component tree so
 * non-component modules (useAuth's session cleanup) can reach it without
 * breaking `react-refresh/only-export-components` in WalletProvider.
 *
 * NOTE: entries keyed by a user id (`["user", id]`, `["exchange-accounts",
 * id]`, …) survive a login/register/logout unless cleared — see
 * `clearQueryCache` below.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      refetchOnWindowFocus: false, // Don't refetch on window focus
      refetchOnReconnect: false, // Don't refetch on reconnect
    },
  },
});

/**
 * Drop every cached query (Fix A). The client is app-scoped, so entries
 * keyed by the previous user id (`["user", oldId]`, `["exchange-accounts",
 * oldId]`, …) survive a login/register/logout unless explicitly cleared —
 * that is what leaked the previous wallet + userLevel into a new account.
 */
export const clearQueryCache = async (): Promise<void> => {
  queryClient.clear();
};
