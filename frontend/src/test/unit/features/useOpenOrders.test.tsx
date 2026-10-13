/** @format */

/**
 * Phase 3 open-orders query: the scope (account + symbol) lands in the cache
 * key AND on the wire, the rows surface for the chart/table consumers, and the
 * `enabled` gate lets the chart stay idle when the charted venue has no
 * ACTIVE account.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OpenOrderRow } from "../../../infrastructure/api/market";

vi.mock("../../../infrastructure/api/market", () => ({
  marketApi: { getOpenOrders: vi.fn() },
}));

import { marketApi } from "../../../infrastructure/api/market";
import {
  openOrdersQueryKey,
  useOpenOrders,
} from "../../../features/strategies/hooks/useOpenOrders";

/** One row as `GET /api/market/orders` returns it (backend `OpenOrderRow`). */
const ROW: OpenOrderRow = {
  orderId: "o-1",
  clientOrderId: null,
  symbol: "PERP_BTC_USDC",
  side: "BUY",
  orderType: "LIMIT",
  price: 123.45,
  quantity: 0.5,
  filledQuantity: 0,
  status: "NEW",
  createdAtMs: 1_700_000_000_000,
  exchange: "kodiak",
};

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("openOrdersQueryKey", () => {
  it("falls back to default/all for an empty scope", () => {
    expect(openOrdersQueryKey()).toEqual([
      "market",
      "orders",
      "default",
      "all",
    ]);
  });

  it("carries account + symbol so two scopes never share rows", () => {
    expect(
      openOrdersQueryKey({
        exchangeAccountId: "acct-1",
        symbol: "PERP_BTC_USDC",
      })
    ).toEqual(["market", "orders", "acct-1", "PERP_BTC_USDC"]);
  });
});

describe("useOpenOrders", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(marketApi.getOpenOrders)
      .mockReset()
      .mockResolvedValue({
        success: true,
        data: [ROW],
        timestamp: 1,
      } as never);
  });

  it("fetches the scoped book and surfaces the rows", async () => {
    const { result } = renderHook(
      () =>
        useOpenOrders({
          exchangeAccountId: "acct-1",
          symbol: "PERP_BTC_USDC",
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data?.data).toEqual([ROW]));
    expect(marketApi.getOpenOrders).toHaveBeenCalledWith({
      exchangeAccountId: "acct-1",
      symbol: "PERP_BTC_USDC",
    });
  });

  it("keeps the fetch off while disabled (chart venue has no ACTIVE account)", () => {
    renderHook(
      () => useOpenOrders({ symbol: "PERP_BTC_USDC" }, { enabled: false }),
      { wrapper }
    );
    expect(marketApi.getOpenOrders).not.toHaveBeenCalled();
  });
});
