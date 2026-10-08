/** @format */

/**
 * Focused integration test: real `useBotLifecycle` + real `WebSocketClient`
 * singleton + fake socket.io socket + mocked `tradingApi.getBotInstances`.
 *
 * Covers audit §4.2 (top gap): WS reconnect → lifecycle convergence.
 * No router, no App render — just the Query-cache <-> WS boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const socketInstances: FakeSocket[] = [];

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const anyHandlers: Array<(event: string, ...args: unknown[]) => void> = [];
    const socket = {
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        socket.connected = false;
        handlers["disconnect"]?.forEach(fn => fn("io client disconnect"));
      }),
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
    socketInstances.push(socket);
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

interface FakeSocket {
  connected: boolean;
  disconnect: ReturnType<typeof vi.fn>;
  __emit: (event: string, ...args: unknown[]) => void;
}

function lastSocket(): FakeSocket {
  return socketInstances[socketInstances.length - 1] as unknown as FakeSocket;
}

function emitConnect(): void {
  const s = lastSocket() as unknown as { connected: boolean } & FakeSocket;
  s.connected = true;
  s.__emit("connect");
}

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

describe("WS reconnect → lifecycle convergence (audit §4.2)", () => {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("converges STARTING → RUNNING across disconnect + reconnect", async () => {
    const { result, unmount } = renderHook(() => useBotLifecycle(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.bots).toHaveLength(1));

    // Connect the real client; hook must observe CONNECTED.
    const connectPromise = websocketClient.connect();
    emitConnect();
    await connectPromise;
    await waitFor(() =>
      expect(websocketClient.getStatus()).toBe(WebSocketStatus.CONNECTED)
    );
    await waitFor(() =>
      expect(result.current.connectionStatus).toBe("connected")
    );

    // A. Server emits STARTING while connected → cache patches.
    lastSocket().__emit("bot.stateChanged", {
      botId: "bot-1",
      from: "RUNNING",
      to: "STARTING",
      correlationId: "corr-1",
      timestamp: Date.now(),
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ status: string }[]>([
          BOT_INSTANCES_QUERY_KEY,
        ])?.[0]?.status
      ).toBe("STARTING")
    );

    // B. Socket drops mid-STARTING (manual disconnect = backend unreachable).
    websocketClient.disconnect();
    expect(websocketClient.getStatus()).toBe(WebSocketStatus.DISCONNECTED);
    await waitFor(() =>
      expect(result.current.connectionStatus).toBe("disconnected")
    );

    // D. Backend converges to RUNNING while we are offline; drive the same
    // refetch the 3s transitional poll would fire (anti-stuck guard heals
    // the cache without WS). Fake timers freeze the initial fetch, so the
    // poll tick is driven manually instead of advancing a fake clock.
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [{ ...API_ROW, status: "RUNNING" }],
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ status: string }[]>([
          BOT_INSTANCES_QUERY_KEY,
        ])?.[0]?.status
      ).toBe("RUNNING")
    );

    // E. Reconnect → CONNECTED invalidation → refetch still RUNNING.
    const reconnectPromise = websocketClient.connect();
    emitConnect();
    await reconnectPromise;
    await waitFor(() =>
      expect(result.current.connectionStatus).toBe("connected")
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ status: string }[]>([
          BOT_INSTANCES_QUERY_KEY,
        ])?.[0]?.status
      ).toBe("RUNNING")
    );

    unmount();
  });
});
