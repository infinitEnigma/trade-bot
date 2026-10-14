/** @format */

import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { BOT_INSTANCES_QUERY_KEY } from "../../bots/hooks";
import type { BotInstance } from "../../strategies/types/strategies.types";

/**
 * Needs-attention count for the VERIFIED header CTA ("Resolve alert").
 *
 * Reads the SAME single-owner `["bot-instances"]` cache the Strategies grid
 * owns — never a second writer, never a second fetch. The header mounts for
 * every tier, so this hook must not fire the bot query below VERIFIED: it
 * reads `getQueryData` directly (no observer at all — a disabled `useQuery`
 * still registers an observer on the shared key, which is what blanked the
 * Strategies page in the shared-observer incident).
 *
 * `useSyncExternalStore` re-renders the header the moment `BotStatusPanel`'s
 * fetch (or a WS patch) lands in the cache, without the header itself
 * enabling anything.
 */
export function useNeedsAttentionCount(enabled: boolean): number {
  const queryClient = useQueryClient();

  const snapshot = useSyncExternalStore(
    callback => {
      if (!enabled) return () => {};
      return queryClient.getQueryCache().subscribe(callback);
    },
    () => {
      if (!enabled) return 0;
      const bots =
        queryClient.getQueryData<BotInstance[]>([BOT_INSTANCES_QUERY_KEY]) ??
        [];
      return bots.filter(
        b => b.needsUserAction || b.status === "UNKNOWN" || b.status === "ERROR"
      ).length;
    },
    () => 0
  );

  return snapshot;
}
