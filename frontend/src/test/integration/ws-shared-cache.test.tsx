/** @format */

/**
 * Shared-cache observers (§3 #4): two `useBotState` cards + `useBotsList`
 * share the single-owner `["bot-instances"]` query — one fetch, N
 * consistent readers; a real WS `bot.stateChanged` lands on every observer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const socketInstances: Array<{
  connected: boolean;
  __emit: (event: string, ...args: unknown[]) => void;
}> = [];

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const anyHandlers: Array<(event: string, ...args: unknown[]) => void> = [];
    const socket = {
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        (handlers[event] ??= []).push(fn);
      }),
      onAny: vi.fn((fn: (event: string, ...args: unknown[]) => void) => {
        anyHandlers.push(fn);
      }),
      __emit: (event: string, ...args: unknown[]) => {
        anyHandlers.forEach(fn => fn(event, ...args));
        handlers[event]?.forEach(fn => fn(...args));
      },
    };
    socketInstances.push(
      socket as unknown as {
        connected: boolean;
        __emit: (event: string, ...args: unknown[]) => void;
      }
    );
    return socket;
  }),
}));

vi.mock("../../infrastructure/config", () => ({
  getWebSocketUrl: () => "ws://test",
}));

vi.mock("../../infrastructure/api/session-refresh", () => ({
  refreshSessionOnce: vi.fn(async () => false),
}));

vi.mock("../../infrastructure/api", () => ({
  tradingApi: { getBotInstances: vi.fn() },
}));

import { io } from "socket.io-client";
import { tradingApi } from "../../infrastructure/api";
import {
  websocketClient,
  WebSocketStatus,
} from "../../infrastructure/websocket/client";
import {
  useBotState,
  useBotsList,
} from "../../features/bots/hooks/useBotLifecycle";

const API_ROWS = [
  {
    id: "bot-1",
    strategy_id: "strategy-1",
    status: "RUNNING",
    total_trades: 4,
    total_pnl: 12.5,
    last_updated: "2026-09-29T12:00:00.000Z",
    config: null,
  },
  {
    id: "bot-2",
    strategy_id: "strategy-2",
    status: "STOPPED",
    total_trades: 1,
    total_pnl: 0,
    last_updated: "2026-09-29T12:00:00.000Z",
    config: null,
  },
];

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("shared-cache observers (§3 #4)", () => {
  beforeEach(() => {
    socketInstances.length = 0;
    vi.mocked(io).mockClear();
    websocketClient.cleanup();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: API_ROWS,
    });
  });

  afterEach(() => {
    websocketClient.cleanup();
    vi.restoreAllMocks();
  });

  it("one fetch feeds every card; a WS patch lands on all observers", async () => {
    const card1 = renderHook(() => useBotState("bot-1"), { wrapper });
    const card2 = renderHook(() => useBotState("bot-2"), { wrapper });
    const list = renderHook(() => useBotsList(), { wrapper });

    await waitFor(() =>
      expect(card1.result.current.actualState).toBe("RUNNING")
    );
    await waitFor(() =>
      expect(card2.result.current.actualState).toBe("STOPPED")
    );
    await waitFor(() => expect(list.result.current.bots).toHaveLength(2));

    // Single shared query → exactly one network fetch for N observers.
    expect(vi.mocked(tradingApi.getBotInstances).mock.calls.length).toBe(1);

    // Connect the real client so the hook's WS listener chain is live, then
    // drive a real `bot.stateChanged` through the fake socket.
    const connectPromise = websocketClient.connect();
    const fake = socketInstances[socketInstances.length - 1];
    fake.connected = true;
    fake.__emit("connect");
    await connectPromise;
    await waitFor(() =>
      expect(websocketClient.getStatus()).toBe(WebSocketStatus.CONNECTED)
    );

    fake.__emit("bot.stateChanged", {
      botId: "bot-1",
      from: "RUNNING",
      to: "STOPPING",
      correlationId: "corr-shared",
      timestamp: Date.now(),
    });

    // The patch lands on every observer of the shared key.
    await waitFor(() =>
      expect(card1.result.current.actualState).toBe("STOPPING")
    );
    expect(card2.result.current.actualState).toBe("STOPPED");
    expect(list.result.current.bots.find(b => b.id === "bot-1")?.status).toBe(
      "STOPPING"
    );
    expect(list.result.current.bots).toHaveLength(2);

    card1.unmount();
    card2.unmount();
    list.unmount();
  });
});
