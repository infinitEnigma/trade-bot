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

  it("a MALFORMED response (missing balance) is unavailable, not a readable $0", async () => {
    const get = vi.mocked(kodiakApi.getKodiakBalance);
    get.mockImplementation(async (accountId?: string) => {
      if (accountId === "acct-b") return { success: true, data: {} } as never;
      return { success: true, data: { totalBalance: "100" } } as never;
    });

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() => expect(result.current.totalIsPartial).toBe(true));
    expect(result.current.totalAcrossExchanges).toBe(100);
    expect(result.current.failedAccounts).toEqual([
      { accountId: "acct-b", label: "lighter (testnet) idx-b" },
    ]);
  });

  it("a non-numeric balance is unavailable; a legitimate zero stays readable", async () => {
    const get = vi.mocked(kodiakApi.getKodiakBalance);
    get.mockImplementation(async (accountId?: string) => {
      if (accountId === "acct-a")
        return { success: true, data: { totalBalance: "0" } } as never;
      return { success: true, data: { totalBalance: "abc" } } as never;
    });

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() => expect(result.current.totalIsPartial).toBe(true));
    // Legitimate zero contributes; the malformed account is excluded + named.
    expect(result.current.totalAcrossExchanges).toBe(0);
    expect(result.current.failedAccounts).toEqual([
      { accountId: "acct-b", label: "lighter (testnet) idx-b" },
    ]);
  });

  it('rejects partially-numeric strings ("12abc") as unavailable, not 12', async () => {
    // Regression for the parseFloat prefix bug: parseFloat(\"12abc\") === 12,
    // which a strict validator must reject — only an ENTIRELY-numeric string
    // counts as readable.
    const get = vi.mocked(kodiakApi.getKodiakBalance);
    get.mockImplementation(async (accountId?: string) => {
      if (accountId === "acct-a")
        return { success: true, data: { totalBalance: "12abc" } } as never;
      return { success: true, data: { totalBalance: "100" } } as never;
    });

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() => expect(result.current.totalIsPartial).toBe(true));
    // "12abc" is excluded (not read as 12), so only acct-b's 100 contributes.
    expect(result.current.totalAcrossExchanges).toBe(100);
    expect(result.current.failedAccounts).toEqual([
      { accountId: "acct-a", label: "lighter (testnet) idx-a" },
    ]);
  });

  it("accepts scientific-notation strings and plain zeros as readable", async () => {
    const get = vi.mocked(kodiakApi.getKodiakBalance);
    get.mockImplementation(async (accountId?: string) => {
      if (accountId === "acct-a")
        return { success: true, data: { totalBalance: "1e3" } } as never;
      return { success: true, data: { totalBalance: "0.00" } } as never;
    });

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    // 1e3 + 0.00 = 1000, both fully-numeric strings → readable, not partial.
    await waitFor(() => expect(result.current.totalAcrossExchanges).toBe(1000));
    expect(result.current.totalIsPartial).toBe(false);
    expect(result.current.failedAccounts).toEqual([]);
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

/**
 * Regression (prod 2026-10-12): the trades query used to be gated on
 * `venuePnl count === 0`, turning it into a Kodiak-only PnL fallback and
 * starving exactly the accounts that HAVE trade history — on Lighter the
 * venue series is non-empty, so the Recent-Trades table never fetched and
 * rendered "No recent trades" forever. Trades must fetch whenever a
 * verified account is selected, regardless of the venue PnL series.
 */
describe("usePortfolioSummary trades query gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(accountsApi.listAccounts).mockResolvedValue({
      data: { accounts: [ACCOUNT_A] },
    } as never);
    vi.mocked(kodiakApi.getKodiakPositions).mockResolvedValue({
      data: { rows: [] },
    } as never);
    vi.mocked(kodiakApi.getKodiakTrades).mockResolvedValue({
      data: { rows: [{ symbol: "ETH", realized_pnl: "1.5" }] },
    } as never);
    vi.mocked(kodiakApi.getKodiakBalance).mockResolvedValue({
      success: true,
      data: { totalBalance: "100" },
    } as never);
  });

  it("fetches trades even when the venue PnL series is non-empty (Lighter)", async () => {
    // Non-empty venue series — the old gate would have disabled trades.
    // Cumulative levels: last(14) − first(4) = 10.
    vi.mocked(kodiakApi.getVenuePnl).mockResolvedValue({
      data: {
        points: [
          { timestamp: "1", trade_pnl: "4" },
          { timestamp: "2", trade_pnl: "14" },
        ],
      },
    } as never);

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() =>
      expect(vi.mocked(kodiakApi.getKodiakTrades)).toHaveBeenCalled()
    );
    await waitFor(() => expect(result.current.trades).toHaveLength(1));
    // With a venue series present, realized PnL reads the series (last −
    // first), never the row sum.
    expect(result.current.realizedPnl).toBe(10);
  });

  it("falls back to summing trade rows when no venue series exists (Kodiak)", async () => {
    vi.mocked(kodiakApi.getVenuePnl).mockResolvedValue({
      data: { points: [] },
    } as never);

    const { result } = renderHook(() => usePortfolioSummary(), { wrapper });

    await waitFor(() => expect(result.current.realizedPnl).toBe(1.5));
  });
});
