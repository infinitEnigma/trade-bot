/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * L19 contract: the shared ["bot-instances"] cache must carry the bot-instance
 * id (`bot_instances.id`) — never the strategy id — because stop,
 * emergency-stop and the `bot.stateChanged` cache patch are all keyed on it.
 * Before the fix the cache mapped `id: bot.strategy_id`, so
 * `/api/bot/management/stop` received the strategy UUID and 404'd.
 */

vi.mock("../../../infrastructure/api", () => ({
  tradingApi: { getBotInstances: vi.fn() },
}));

vi.mock("../../../infrastructure/websocket/client", () => ({
  websocketClient: {
    onBotStateChanged: vi.fn(),
    offBotStateChanged: vi.fn(),
    onStatusChange: vi.fn(),
    offStatusChange: vi.fn(),
    getStatus: vi.fn(() => "disconnected"),
  },
  WebSocketStatus: {
    DISCONNECTED: "disconnected",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    RECONNECTING: "reconnecting",
    ERROR: "error",
  },
}));

import { tradingApi } from "../../../infrastructure/api";
import { websocketClient } from "../../../infrastructure/websocket/client";
import { useBotLifecycle } from "../../../features/bots/hooks/useBotLifecycle";

/** One row exactly as `GET /api/bot/management/instances` returns it (022: session row, no strategy_id). */
const API_ROW = {
  id: "bot-1",
  status: "RUNNING",
  total_trades: 4,
  total_pnl: 12.5,
  last_updated: "2026-09-29T12:00:00.000Z",
  config: null,
};

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("useBotLifecycle bot-instances mapping (L19)", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [API_ROW],
    });
  });

  it("keeps the bot id from /api/bot/management/instances in `id`", async () => {
    const { result } = renderHook(() => useBotLifecycle(), { wrapper });

    await waitFor(() => expect(result.current.bots).toHaveLength(1));

    expect(result.current.bots[0].id).toBe("bot-1");
    expect(result.current.bots[0].strategy_id).toBeUndefined();
  });

  it("resolves a single bot by the bot id (what stop/emergency-stop send)", async () => {
    const { result } = renderHook(() => useBotLifecycle("bot-1"), { wrapper });

    await waitFor(() => expect(result.current.bot?.id).toBe("bot-1"));
    expect(result.current.actualState).toBe("RUNNING");
  });

  it("patches the cached row when bot.stateChanged carries the bot id", async () => {
    const { result } = renderHook(() => useBotLifecycle(), { wrapper });
    await waitFor(() => expect(result.current.bots).toHaveLength(1));

    // The backend emits `bot.id` as `botId` on every state change.
    const handler = vi.mocked(websocketClient.onBotStateChanged).mock
      .calls[0][0];
    act(() => {
      handler({
        botId: "bot-1",
        from: "RUNNING",
        to: "STOPPED",
        correlationId: "corr-1",
        timestamp: Date.now(),
      });
    });

    // The cache patch itself is synchronous...
    expect(
      queryClient.getQueryData<{ status: string }[]>(["bot-instances"])?.[0]
        ?.status
    ).toBe("STOPPED");
    // ...and the subscribed hook re-renders with it (React Query batches the
    // notification, so give it a tick).
    await waitFor(() => expect(result.current.bots[0].status).toBe("STOPPED"));
  });

  it("resolves a strategy to its hosting session via runs (D4)", async () => {
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [
        {
          ...API_ROW,
          id: "session-1",
          runs: [
            {
              id: "run-1",
              strategy_id: "strategy-9",
              config_version: 1,
              config: {},
              notional_amount: "100",
              state: "RUNNING",
              last_error_code: null,
            },
          ],
        },
      ],
    });
    const { result } = renderHook(() => useBotLifecycle("strategy-9"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.bot?.id).toBe("session-1"));
  });
});
