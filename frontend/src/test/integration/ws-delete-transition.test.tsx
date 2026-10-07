/** @format */

/**
 * Bot deleted during transition (§3 #7): delete of a live/transitional bot
 * is refused with 409 — row stays, no crash, transition still converges.
 * Delete of a terminal bot drops the row; stray events are no-ops.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const socketInstances: Array<{
  connected: boolean;
  __emit: (event: string, ...args: unknown[]) => void;
}> = [];

type FakeEntry = {
  connected: boolean;
  __emit: (event: string, ...args: unknown[]) => void;
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const anyH: Array<(event: string, ...args: unknown[]) => void> = [];
    const socket = {
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        (handlers[event] ??= []).push(fn);
      }),
      onAny: vi.fn((fn: (event: string, ...args: unknown[]) => void) => {
        anyH.push(fn);
      }),
      __emit: (event: string, ...args: unknown[]) => {
        anyH.forEach(fn => fn(event, ...args));
        handlers[event]?.forEach(fn => fn(...args));
      },
    };
    socketInstances.push(socket as unknown as FakeEntry);
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
  tradingApi: { getBotInstances: vi.fn(), deleteBotInstance: vi.fn() },
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

const STARTING_ROW = {
  id: "bot-1",
  strategy_id: "strategy-1",
  status: "STARTING",
  total_trades: 0,
  total_pnl: 0,
  last_updated: "2026-09-29T12:00:00.000Z",
  config: null,
};

const STOPPED_ROW = { ...STARTING_ROW, status: "STOPPED" };

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

function cacheStatus(): string | undefined {
  return queryClient.getQueryData<{ status: string }[]>([
    BOT_INSTANCES_QUERY_KEY,
  ])?.[0]?.status;
}

async function connectFakeSocket() {
  const p = websocketClient.connect();
  const fake = socketInstances[socketInstances.length - 1];
  fake.connected = true;
  fake.__emit("connect");
  await p;
  await waitFor(() =>
    expect(websocketClient.getStatus()).toBe(WebSocketStatus.CONNECTED)
  );
  return fake;
}

describe("bot deleted during transition (§3 #7)", () => {
  beforeEach(() => {
    socketInstances.length = 0;
    vi.mocked(io).mockClear();
    websocketClient.cleanup();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    websocketClient.cleanup();
    vi.restoreAllMocks();
  });

  it("409 on transitional bot keeps row; transition converges", async () => {
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [STARTING_ROW],
    });
    const err = new Error("Bot is still active") as Error & {
      response?: { status: number };
    };
    err.response = { status: 409 };
    vi.mocked(tradingApi.deleteBotInstance).mockRejectedValue(err);

    const { result, unmount } = renderHook(() => useBotLifecycle("bot-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.bot?.id).toBe("bot-1"));
    expect(result.current.isTransitional).toBe(true);

    const fake = await connectFakeSocket();

    await expect(tradingApi.deleteBotInstance("bot-1")).rejects.toThrow(
      "still active"
    );
    expect(
      queryClient.getQueryData<unknown[]>([BOT_INSTANCES_QUERY_KEY])
    ).toHaveLength(1);
    expect(result.current.isTransitional).toBe(true);

    fake.__emit("bot.stateChanged", {
      botId: "bot-1",
      from: "STARTING",
      to: "RUNNING",
      correlationId: "corr-del-1",
      timestamp: Date.now(),
    });
    await waitFor(() => expect(cacheStatus()).toBe("RUNNING"));
    await waitFor(() => expect(result.current.isTransitional).toBe(false));

    unmount();
  });

  it("terminal delete drops row; stray events are no-ops", async () => {
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [STOPPED_ROW],
    });
    vi.mocked(tradingApi.deleteBotInstance).mockResolvedValue({
      success: true,
    });

    const { result, unmount } = renderHook(() => useBotLifecycle(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.bots).toHaveLength(1));

    const fake = await connectFakeSocket();

    await tradingApi.deleteBotInstance("bot-1");
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [],
    });
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.bots).toHaveLength(0));

    fake.__emit("bot.stateChanged", {
      botId: "bot-1",
      from: "STOPPED",
      to: "RUNNING",
      correlationId: "corr-del-2",
      timestamp: Date.now(),
    });
    await act(async () => {});
    expect(result.current.bots).toHaveLength(0);

    unmount();
  });
});
