/** @format */

/**
 * useStrategyPerformance contract: lifetime ledger aggregate (Phase 1
 * strategy-page PnL), VERIFIED-gated like every private-ledger read, one
 * query key per strategy (shared by the workspace panel + BotControls), and
 * polling only while the caller says the bot is live.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../../infrastructure/api", () => ({
  tradingApi: { getStrategyPerformance: vi.fn() },
}));

const authState = { user: { id: "user-1", userLevel: "VERIFIED" } };
vi.mock("../../../features/auth", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAuth: () => authState as any,
}));

import { tradingApi } from "../../../infrastructure/api";
import {
  useStrategyPerformance,
  strategyPerformanceQueryKey,
} from "../../../features/strategies/hooks/useStrategyPerformance";

const PERF = {
  totalTrades: 5,
  totalPnL: 12.5,
  unknownPnlFills: 1,
  winRate: 75,
  avgTrade: 3.125,
  bestTrade: 10.25,
  worstTrade: -1.75,
  totalFees: 0.84,
  unknownFeeFills: 1,
  firstFillAt: "2026-10-01T10:00:00.000Z",
  lastFillAt: "2026-10-12T10:00:00.000Z",
};

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("useStrategyPerformance (Phase 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "user-1", userLevel: "VERIFIED" };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(tradingApi.getStrategyPerformance).mockResolvedValue({
      success: true,
      data: PERF,
    } as never);
  });

  it("fetches the aggregate for the strategy and passes it through", async () => {
    const { result } = renderHook(() => useStrategyPerformance("s1"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.performance?.totalPnL).toBe(12.5)
    );
    expect(tradingApi.getStrategyPerformance).toHaveBeenCalledWith("s1");
    // The F2 incompleteness counter travels with the payload — the render
    // sites need it to flag the sum as incomplete.
    expect(result.current.performance?.unknownPnlFills).toBe(1);
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("stays disabled below VERIFIED (no ledger call)", () => {
    authState.user = { id: "user-1", userLevel: "BASIC" };
    const { result } = renderHook(() => useStrategyPerformance("s1"), {
      wrapper,
    });

    expect(result.current.performance).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(tradingApi.getStrategyPerformance).not.toHaveBeenCalled();
  });

  it("stays disabled without a strategyId or when the caller disables it", () => {
    const { result: noId } = renderHook(
      () => useStrategyPerformance(undefined),
      { wrapper }
    );
    const { result: killed } = renderHook(
      () => useStrategyPerformance("s1", { enabled: false }),
      { wrapper }
    );

    expect(noId.current.performance).toBeNull();
    expect(killed.current.performance).toBeNull();
    expect(tradingApi.getStrategyPerformance).not.toHaveBeenCalled();
  });

  it("keys the cache per strategy and polls only while live", async () => {
    const { result } = renderHook(
      () => useStrategyPerformance("s1", { live: true }),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.performance?.totalTrades).toBe(5)
    );

    // One cache entry per strategy — the workspace panel and BotControls
    // share it, so a strategy never costs two fetches.
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: strategyPerformanceQueryKey("s1") });
    expect(query).toBeDefined();
    // live → 30s polling; not-live → no polling (a stopped strategy does not
    // change under you).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((query?.options as any).refetchInterval).toBe(30_000);

    const idle = renderHook(() => useStrategyPerformance("s2"), { wrapper });
    await waitFor(() =>
      expect(tradingApi.getStrategyPerformance).toHaveBeenCalledWith("s2")
    );
    const idleQuery = queryClient
      .getQueryCache()
      .find({ queryKey: strategyPerformanceQueryKey("s2") });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((idleQuery?.options as any).refetchInterval).toBe(false);
    idle.unmount();
  });

  it("surfaces fetch errors without fabricating figures", async () => {
    vi.mocked(tradingApi.getStrategyPerformance).mockRejectedValue(
      new Error("boom")
    );
    const { result } = renderHook(() => useStrategyPerformance("s1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // The render sites fall back to session counters on error — the hook
    // must never synthesize a zeroed aggregate.
    expect(result.current.performance).toBeNull();
  });
});
