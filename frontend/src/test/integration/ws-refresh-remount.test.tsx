/** @format */

/**
 * Refresh during STARTING (§3 #9): remount with fresh cache still shows
 * transitional state and converges via refetch. No stale UI, no crash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../infrastructure/api", () => ({
  tradingApi: { getBotInstances: vi.fn() },
}));

import { tradingApi } from "../../infrastructure/api";
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

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("refresh during STARTING (§3 #9)", () => {
  beforeEach(() => {
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [STARTING_ROW],
    });
  });

  it("remount shows STARTING then converges to RUNNING", async () => {
    let qc = makeClient();
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useBotLifecycle("bot-1"), {
      wrapper: wrap,
    });
    await waitFor(() => expect(first.result.current.bot?.id).toBe("bot-1"));
    expect(first.result.current.actualState).toBe("STARTING");
    expect(first.result.current.isTransitional).toBe(true);
    first.unmount();

    qc = makeClient();
    const wrap2 = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const second = renderHook(() => useBotLifecycle("bot-1"), {
      wrapper: wrap2,
    });
    await waitFor(() => expect(second.result.current.bot?.id).toBe("bot-1"));
    expect(second.result.current.actualState).toBe("STARTING");
    expect(second.result.current.isTransitional).toBe(true);

    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [{ ...STARTING_ROW, status: "RUNNING" }],
    });
    await act(async () => {
      await second.result.current.refetch();
    });
    await waitFor(() =>
      expect(
        qc.getQueryData<{ status: string }[]>([BOT_INSTANCES_QUERY_KEY])?.[0]
          ?.status
      ).toBe("RUNNING")
    );
    await waitFor(() =>
      expect(second.result.current.isTransitional).toBe(false)
    );
    expect(second.result.current.actualState).toBe("RUNNING");

    second.unmount();
  });
});
