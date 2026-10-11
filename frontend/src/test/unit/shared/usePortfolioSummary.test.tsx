/** @format */

/**
 * F3: multi-account balance aggregation failure states.
 *
 * An unreadable account must never be folded into a silent $0 that
 * understates the total portfolio. The total is a partial sum, flagged as
 * partial, with the failed accounts named — and the hook-level error fires.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../../infrastructure/api", () => ({
  accountsApi: { listAccounts: vi.fn() },
  balanceApi: { getCurrentBalance: vi.fn() },
  kodiakApi: {
    getKodiakBalance: vi.fn(),
    getKodiakPositions: vi.fn(),
    getKodiakTrades: vi.fn(),
    getVenuePnl: vi.fn(),
  },
}));

vi.mock("../../../features/auth", () => ({
  useAuth: () => ({ user: { id: "user-1", userLevel: "VERIFIED" } }),
}));

import { accountsApi, kodiakApi } from "../../../infrastructure/api";
import { usePortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";

const ACCOUNT_A = {
  id: "acct-a",
  userId: "user-1",
  exchange: "lighter",
  environment: "testnet",
  accountRef: "idx-a",
  status: "ACTIVE",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const ACCOUNT_B = {
  ...ACCOUNT_A,
  id: "acct-b",
  accountRef: "idx-b",
};

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("usePortfolioSummary total across exchanges (F3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(accountsApi.listAccounts).mockResolvedValue({
      data: { accounts: [ACCOUNT_A, ACCOUNT_B] },
    } as never);
    vi.mocked(kodiakApi.getKodiakPositions).mockResolvedValue({
      data: { rows: [] },
    } as never);
    vi.mocked(kodiakApi.getKodiakTrades).mockResolvedValue({
      data: { rows: [] },
    } as never);
    // No venue series → the Kodiak trades fallback runs (both mocked empty).
    vi.mocked(kodiakApi.getVenuePnl).mockResolvedValue({
      data: { points: [] },
    } as never);
    vi.mocked(kodiakApi.getKodiakBalance).mockResolvedValue({
      success: true,
      data: { totalBalance: "100" },
    } as never);
  });

  it("sums every readable account and reports no failure", async () => {
    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() => expect(result.current.totalAcrossExchanges).toBe(200));
    expect(result.current.totalIsPartial).toBe(false);
    expect(result.current.failedAccounts).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("an unreadable account becomes a NAMED failure, never a silent $0", async () => {
    const get = vi.mocked(kodiakApi.getKodiakBalance);
    get.mockImplementation(async (accountId?: string) => {
      if (accountId === "acct-b") throw new Error("Balance unavailable: down");
      return { success: true, data: { totalBalance: "100" } } as never;
    });

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() => expect(result.current.totalIsPartial).toBe(true));
    // The readable account contributes; the unreadable one is excluded AND
    // reported — the total is a labelled partial sum (100, not 100+0).
    expect(result.current.totalAcrossExchanges).toBe(100);
    expect(result.current.failedAccounts).toEqual([
      { accountId: "acct-b", label: "lighter (testnet) idx-b" },
    ]);
    // The partial total also trips the hook-level error banner.
    expect(result.current.error).toBe(
      "Some portfolio figures are unavailable right now."
    );
  });

  it("a total where EVERY account fails is an empty partial, not $0-as-truth", async () => {
    vi.mocked(kodiakApi.getKodiakBalance).mockRejectedValue(
      new Error("Balance unavailable: all down")
    );

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() => expect(result.current.failedAccounts).toHaveLength(2));
    expect(result.current.totalIsPartial).toBe(true);
    expect(result.current.totalAcrossExchanges).toBe(0);
    expect(result.current.error).not.toBeNull();
  });
});
