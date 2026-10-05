/**
 * useBotLifecycle Hook
 *
 * Subscribes to `bot.stateChanged` Socket.IO events from the backend
 * and updates the TanStack Query cache accordingly.
 *
 * The frontend should NEVER assume immediate state transitions.
 * Instead, it should rely on the authoritative server state.
 *
 * UI States:
 * - Stopped: Bot is stopped and ready to start
 * - Starting...: Bot is in the process of starting
 * - Running: Bot is actively trading
 * - Stopping...: Bot is in the process of stopping
 * - Connection lost: WebSocket connection lost
 * - Error: Bot encountered an error
 *
 * @format
 */

import { useEffect, useCallback, useState } from "react";
import {
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  websocketClient,
  BotStateChangedEventData,
  WebSocketStatus,
} from "../../../infrastructure/websocket/client";
import { tradingApi } from "../../../infrastructure/api";
import { BotInstance } from "../../strategies/types/strategies.types";
import {
  BotActualState,
  ConnectionStatus,
  STATE_DISPLAY_INFO,
} from "../types/bot-lifecycle.types";

/**
 * Query key for bot instances cache.
 */
export const BOT_INSTANCES_QUERY_KEY = "bot-instances";

/**
 * Get the display info for a bot state.
 */
export function getStateDisplayInfo(state: BotActualState) {
  return STATE_DISPLAY_INFO[state] || STATE_DISPLAY_INFO.UNKNOWN;
}

/**
 * Check if a state is transitional (loading).
 */
export function isTransitionalState(state: BotActualState): boolean {
  return state === "STARTING" || state === "STOPPING";
}

/**
 * Hook to track a single bot's lifecycle state.
 *
 * @param botId - The bot ID to track.
 * @returns Single bot lifecycle state.
 */
export function useBotState(botId: string) {
  const {
    bot,
    actualState,
    isTransitional,
    isConnectionLost,
    connectionStatus,
    isConnected,
    getStateDisplayInfo,
  } = useBotLifecycle(botId);

  const displayInfo = actualState ? getStateDisplayInfo(actualState) : null;

  return {
    bot,
    actualState,
    isTransitional,
    isConnectionLost,
    connectionStatus,
    isConnected,
    displayInfo,
  };
}

/**
 * Page-level subscription to the shared bot-instances cache.
 *
 * Read-only view over the same single-owner query as useBotLifecycle (no
 * second writer): the Strategies grid needs the full list for its
 * strategy→bot lookup, while per-card BotControls use useBotState.
 */
export function useBotsList() {
  const { bots, isLoading, error, refetch } = useBotLifecycle();
  return { bots, isLoading, error, refetch };
}

/**
 * Hook to manage bot lifecycle state.
 *
 * @param botId - Optional bot ID to track a specific bot. If not provided, tracks all bots.
 * @returns Bot lifecycle state and connection status.
 */
export function useBotLifecycle(botId?: string) {
  const queryClient = useQueryClient();
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  const fetchBotInstances = async (): Promise<BotInstance[]> => {
    const response = await tradingApi.getBotInstances();
    const rows = Array.isArray(response?.data) ? response.data : [];
    if (response?.success && rows.length > 0) {
      return rows.map(
        (bot: {
          id: string;
          strategy_id: string;
          status: string;
          total_trades: number;
          total_pnl: number;
          last_updated: string;
          config?: unknown;
          needs_user_action?: boolean;
          needs_user_action_reason?: string | null;
        }) => ({
          // L19: `id` is the bot-instance id, never the strategy id — stop,
          // emergency-stop and the `bot.stateChanged` cache patch are all
          // keyed on it. Mapping it to `strategy_id` (the legacy "one strategy
          // ⇒ one bot" convention) sent the strategy UUID to
          // `/api/bot/management/stop`, which 404s.
          id: bot.id,
          strategy_id: bot.strategy_id,
          status: bot.status as BotInstance["status"],
          total_trades: bot.total_trades,
          total_pnl: bot.total_pnl,
          last_updated: bot.last_updated,
          // P0-3: carry the backend's "needs action" verdict through so the UI
          // can say so explicitly instead of leaving a dead bot looking merely
          // connection-lost.
          needsUserAction: bot.needs_user_action === true,
          needsUserActionReason: bot.needs_user_action_reason ?? null,
          config: bot.config || {
            type: "GRID" as const,
            config: {
              symbol: "",
              leverage: 1,
              gridSize: 10,
              gridRange: 5,
              orderQuantity: 1,
            },
          },
        })
      );
    }
    return [];
  };

  const botsQuery: UseQueryResult<BotInstance[], Error> = useQuery({
    // Single owner of the bot-instances cache: BotControls mounts one
    // useBotState per strategy card, and every instance of this hook shares
    // this key. It must stay enabled unconditionally — an `enabled` gate keyed
    // on user level lets one card's mount flip the shared observer into a
    // pending state with `data: undefined`, and every other card reading
    // `botsQuery.data.map` (via useBotState → bot) throws, unmounting the
    // whole page behind the AnimatePresence blank background.
    queryKey: [BOT_INSTANCES_QUERY_KEY],
    queryFn: fetchBotInstances,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Anti-stuck guard: while any tracked bot sits in a transitional state
    // (STARTING/STOPPING), poll the authoritative server state. A
    // `bot.stateChanged` event missed during a WebSocket outage can
    // otherwise leave the UI stuck on "Starting..."/"Stopping..." forever.
    refetchInterval: query => {
      const bots = query.state.data ?? [];
      const hasTransitional = bots.some(b =>
        isTransitionalState(b.status as BotActualState)
      );
      return hasTransitional ? 3_000 : false;
    },
  });

  const updateBotStateInCache = useCallback(
    (data: BotStateChangedEventData) => {
      queryClient.setQueryData<BotInstance[]>(
        [BOT_INSTANCES_QUERY_KEY],
        oldData => {
          if (!oldData) return oldData;

          return oldData.map(bot => {
            if (bot.id === data.botId || bot.strategy_id === data.botId) {
              return {
                ...bot,
                status: data.to as BotInstance["status"],
                last_updated: new Date(data.timestamp).toISOString(),
              };
            }
            return bot;
          });
        }
      );
    },
    [queryClient]
  );

  const handleBotStateChanged = useCallback(
    (data: BotStateChangedEventData) => {
      console.log(
        `📡 Bot state changed: ${data.botId} ${data.from} -> ${data.to}`
      );
      updateBotStateInCache(data);
    },
    [updateBotStateInCache]
  );

  const handleStatusChange = useCallback(
    (status: WebSocketStatus) => {
      switch (status) {
        case WebSocketStatus.CONNECTED:
          setConnectionStatus("connected");
          queryClient.invalidateQueries({
            queryKey: [BOT_INSTANCES_QUERY_KEY],
          });
          break;
        case WebSocketStatus.CONNECTING:
          setConnectionStatus("connecting");
          break;
        case WebSocketStatus.RECONNECTING:
          setConnectionStatus("reconnecting");
          break;
        case WebSocketStatus.DISCONNECTED:
          setConnectionStatus("disconnected");
          break;
        case WebSocketStatus.ERROR:
          setConnectionStatus("error");
          break;
      }
    },
    [queryClient]
  );

  useEffect(() => {
    websocketClient.onBotStateChanged(handleBotStateChanged);
    websocketClient.onStatusChange(handleStatusChange);

    const initialStatus = websocketClient.getStatus();
    // Apply outside the synchronous effect body to avoid cascading renders
    queueMicrotask(() => handleStatusChange(initialStatus));

    return () => {
      websocketClient.offBotStateChanged(handleBotStateChanged);
      websocketClient.offStatusChange(handleStatusChange);
    };
  }, [handleBotStateChanged, handleStatusChange]);

  const bot = botId
    ? botsQuery.data?.find(b => b.id === botId || b.strategy_id === botId)
    : undefined;
  const actualState: BotActualState | undefined = bot?.status as
    BotActualState | undefined;
  const isTransitional = actualState ? isTransitionalState(actualState) : false;
  const isConnectionLost =
    connectionStatus === "disconnected" || connectionStatus === "error";

  return {
    bots: botsQuery.data ?? [],
    isLoading: botsQuery.isLoading,
    error: botsQuery.error,
    refetch: botsQuery.refetch,

    bot,
    actualState,
    isTransitional,
    isConnectionLost,

    connectionStatus,
    isConnected: connectionStatus === "connected",

    getStateDisplayInfo,
  };
}
