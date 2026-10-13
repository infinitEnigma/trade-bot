/** @format */

/**
 * Phase 3.1 (review P2-4) account-positions query: the account scope lands
 * in the cache key AND on the wire (backend C3b), rows surface for the
 * workspace panel, and the enabled gate keeps the fetch off until a strategy
 * is selected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AccountPositionRow } from "../../../infrastructure/api/market";

vi.mock("../../../infrastructure/api/market", () => ({
  marketApi: { getPositions: vi.fn() },
}));

import { marketApi } from "../../../infrastructure/api/market";
import {
  accountPositionsQueryKey,
  useAccountPositions,
} from "../../../features/strategies/hooks/useAccountPositions";

const ROW: AccountPositionRow = {
  symbol: "PERP_BTC_USDC",
  position_qty: "0.5",
  unsettled_pnl: "12.5",
  mark_price: "65000",
  average_open_price: "64000",
};

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("accountPositionsQueryKey", () => {
  it("falls back to all for an empty scope", () => {
    expect(accountPositionsQueryKey()).toEqual(["market", "positions", "all"]);
  });

  it("carries the account so two accounts never share rows", () => {
    expect(accountPositionsQueryKey({ exchangeAccountId: "acct-1" })).toEqual([
      "market",
      "positions",
      "acct-1",
    ]);
  });
});

describe("useAccountPositions", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(marketApi.getPositions)
      .mockReset()
      .mockResolvedValue({ success: true, data: [ROW] } as never);
  });

  it("fetches the account book and surfaces the rows", async () => {
    const { result } = renderHook(
      () => useAccountPositions({ exchangeAccountId: "acct-1" }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data?.data).toEqual([ROW]));
    expect(marketApi.getPositions).toHaveBeenCalledWith("acct-1");
  });

  it("keeps the fetch off while disabled (no strategy selected)", () => {
    renderHook(() => useAccountPositions({}, { enabled: false }), { wrapper });
    expect(marketApi.getPositions).not.toHaveBeenCalled();
  });
});
