/** @format */

/**
 * useRecentTrades contract: ledger feed (NOT the venue proxy), VERIFIED-gated,
 * per-filter query keys, latest-N passthrough of ledger rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../../infrastructure/api", () => ({
  tradingApi: { getLedgerTrades: vi.fn() },
}));

const authState = { user: { id: "user-1", userLevel: "VERIFIED" } };
vi.mock("../../../features/auth", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAuth: () => authState as any,
}));

import { tradingApi } from "../../../infrastructure/api";
import { useRecentTrades } from "../../../shared/hooks/useRecentTrades";

const ROW = {
  id: "t1",
  strategyId: "s1",
  strategyName: "My Grid",
  botId: "b1",
  exchangeAccountId: "acc1",
  orderId: "o1",
  symbol: "PERP_ETH_USDC",
  side: "BUY",
  quantity: 0.01,
  price: 2000.5,
  fee: null,
  pnl: null,
  status: "FILLED",
  executedAt: "2026-10-12T10:00:00.000Z",
};

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("useRecentTrades (Batch 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "user-1", userLevel: "VERIFIED" };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(tradingApi.getLedgerTrades).mockResolvedValue({
      data: { rows: [ROW] },
    } as never);
  });

  it("passes ledger rows through with no filters", async () => {
    const { result } = renderHook(() => useRecentTrades(), { wrapper });

    await waitFor(() => expect(result.current.trades).toHaveLength(1));
    expect(result.current.trades[0].symbol).toBe("PERP_ETH_USDC");
    expect(tradingApi.getLedgerTrades).toHaveBeenCalledWith({
      exchangeAccountId: undefined,
      strategyId: undefined,
      limit: undefined,
    });
  });

  it("forwards account/strategy scope to the ledger endpoint", async () => {
    const { result } = renderHook(
      () => useRecentTrades({ exchangeAccountId: "acc1", strategyId: "s1" }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.trades).toHaveLength(1));
    expect(tradingApi.getLedgerTrades).toHaveBeenCalledWith({
      exchangeAccountId: "acc1",
      strategyId: "s1",
      limit: undefined,
    });
  });

  it("stays disabled below VERIFIED (no ledger call)", () => {
    authState.user = { id: "user-1", userLevel: "BASIC" };
    const { result } = renderHook(() => useRecentTrades(), { wrapper });

    expect(result.current.trades).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(tradingApi.getLedgerTrades).not.toHaveBeenCalled();
  });
});
