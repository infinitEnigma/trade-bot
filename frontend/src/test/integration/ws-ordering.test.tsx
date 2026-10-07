/** @format */

/**
 * Socket event vs REST refetch ordering (§3 #3): when a WS patch and a REST
 * refetch race, the fresher writer wins and the next poll self-heals —
 * no stale "Starting…" persists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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
  useBotLifecycle,
  BOT_INSTANCES_QUERY_KEY,
} from "../../features/bots/hooks/useBotLifecycle";

const API_ROW = {
  id: "bot-1",
  strategy_id: "strategy-1",
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

function cacheStatus(): string | undefined {
  return queryClient.getQueryData<{ status: string }[]>([
    BOT_INSTANCES_QUERY_KEY,
  ])?.[0]?.status;
}

describe("socket event vs REST refetch ordering (§3 #3)", () => {
  beforeEach(() => {
    socketInstances.length = 0;
    vi.mocked(io).mockClear();
    websocketClient.cleanup();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [API_ROW],
    });
  });

  afterEach(() => {
    websocketClient.cleanup();
    vi.restoreAllMocks();
  });

  it("REST refetch overwrites a stale WS patch; a fresher WS event wins after", async () => {
    const { result, unmount } = renderHook(() => useBotLifecycle(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.bots).toHaveLength(1));

    const connectPromise = websocketClient.connect();
    const fake = socketInstances[socketInstances.length - 1];
    fake.connected = true;
    fake.__emit("connect");
    await connectPromise;
    await waitFor(() =>
      expect(websocketClient.getStatus()).toBe(WebSocketStatus.CONNECTED)
    );

    // A stale WS event paints STARTING while the server already says STOPPED.
    fake.__emit("bot.stateChanged", {
      botId: "bot-1",
      from: "RUNNING",
      to: "STARTING",
      correlationId: "corr-stale",
      timestamp: Date.now(),
    });
    await waitFor(() => expect(cacheStatus()).toBe("STARTING"));

    // The authoritative REST refetch (same tick the 3s poll would fire)
    // carries the newer STOPPED — it must win over the stale WS patch.
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [{ ...API_ROW, status: "STOPPED" }],
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(cacheStatus()).toBe("STOPPED"));
    await waitFor(() => expect(result.current.actualState).toBeUndefined());

    // A fresher WS event arriving after the refetch still applies.
    fake.__emit("bot.stateChanged", {
      botId: "bot-1",
      from: "STOPPED",
      to: "STARTING",
      correlationId: "corr-fresh",
      timestamp: Date.now(),
    });
    await waitFor(() => expect(cacheStatus()).toBe("STARTING"));

    unmount();
  });

  it("events for an unknown bot id never leak into tracked rows", async () => {
    const { result, unmount } = renderHook(() => useBotLifecycle(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.bots).toHaveLength(1));

    const connectPromise = websocketClient.connect();
    const fake = socketInstances[socketInstances.length - 1];
    fake.connected = true;
    fake.__emit("connect");
    await connectPromise;
    await waitFor(() =>
      expect(websocketClient.getStatus()).toBe(WebSocketStatus.CONNECTED)
    );

    fake.__emit("bot.stateChanged", {
      botId: "bot-unknown",
      from: "RUNNING",
      to: "STARTING",
      correlationId: "corr-unknown",
      timestamp: Date.now(),
    });
    // Give the listener chain a tick, then assert nothing moved.
    await act(async () => {});
    expect(cacheStatus()).toBe("RUNNING");
    expect(result.current.bots).toHaveLength(1);

    unmount();
  });
});
