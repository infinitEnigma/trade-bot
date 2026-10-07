/** @format */

/**
 * strategy_id compatibility collision (§3 #5 / R1): `bot.id` is the primary
 * cache key; a legacy strategy id still resolves to the hosting session
 * via `runs[]`; a WS event carrying the bot id patches the right row.
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
  useBotLifecycle,
  BOT_INSTANCES_QUERY_KEY,
} from "../../features/bots/hooks/useBotLifecycle";

// D4 session row: the session id differs from the legacy strategy column,
// and the strategy is reachable through the attached run.
const SESSION_ROW = {
  id: "session-1",
  strategy_id: "legacy-strategy",
  status: "RUNNING",
  total_trades: 2,
  total_pnl: 3,
  last_updated: "2026-09-29T12:00:00.000Z",
  config: null,
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
};

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("strategy_id compatibility collision (§3 #5 / R1)", () => {
  beforeEach(() => {
    socketInstances.length = 0;
    vi.mocked(io).mockClear();
    websocketClient.cleanup();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [SESSION_ROW],
    });
  });

  afterEach(() => {
    websocketClient.cleanup();
    vi.restoreAllMocks();
  });

  it("bot id is primary; legacy strategy id resolves via runs[]; WS patches by bot id", async () => {
    const byBotId = renderHook(() => useBotLifecycle("session-1"), {
      wrapper,
    });
    const byStrategyId = renderHook(() => useBotLifecycle("strategy-9"), {
      wrapper,
    });

    await waitFor(() =>
      expect(byBotId.result.current.bot?.id).toBe("session-1")
    );
    // Legacy strategy id resolves to the hosting session, not a ghost row.
    await waitFor(() =>
      expect(byStrategyId.result.current.bot?.id).toBe("session-1")
    );
    expect(byStrategyId.result.current.actualState).toBe("RUNNING");

    const connectPromise = websocketClient.connect();
    const fake = socketInstances[socketInstances.length - 1];
    fake.connected = true;
    fake.__emit("connect");
    await connectPromise;
    await waitFor(() =>
      expect(websocketClient.getStatus()).toBe(WebSocketStatus.CONNECTED)
    );

    // The backend emits the *bot* id — the patch must hit session-1, and a
    // legacy strategy id must never match a row key.
    fake.__emit("bot.stateChanged", {
      botId: "session-1",
      from: "RUNNING",
      to: "STOPPING",
      correlationId: "corr-r1",
      timestamp: Date.now(),
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ id: string; status: string }[]>([
          BOT_INSTANCES_QUERY_KEY,
        ])?.[0]
      ).toMatchObject({ id: "session-1", status: "STOPPING" })
    );
    await waitFor(() =>
      expect(byStrategyId.result.current.actualState).toBe("STOPPING")
    );

    byBotId.unmount();
    byStrategyId.unmount();
  });
});
