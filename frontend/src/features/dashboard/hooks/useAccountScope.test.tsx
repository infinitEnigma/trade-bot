/** @format */

/**
 * useAccountScope (Stage 2): the single URL-persisted account selection.
 * Default = newest ACTIVE; valid canonical URL wins; valid legacy
 * `?tradesAccount=` migrates (read-then-strip); stale / foreign /
 * non-ACTIVE ids fall back to the default AND are stripped.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockListAccounts = vi.fn();
vi.mock("../../../infrastructure/api/accounts", () => ({
  accountsApi: {
    listAccounts: (...args: unknown[]) => mockListAccounts(...args),
  },
}));

const mockSetActive = vi.fn();
vi.mock("../../../shared/services/balance-manager", () => ({
  globalBalanceManager: {
    setActiveExchangeAccountId: (id: string | null) => mockSetActive(id),
  },
}));

import { useAccountScope } from "./useAccountScope";

const ACCOUNT_OLD = {
  id: "acct-old",
  userId: "user-1",
  exchange: "kodiak",
  environment: "testnet",
  accountRef: "idx-old",
  status: "ACTIVE",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const ACCOUNT_NEW = {
  ...ACCOUNT_OLD,
  id: "acct-new",
  exchange: "lighter",
  accountRef: "idx-new",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const ACCOUNT_REVOKED = {
  ...ACCOUNT_OLD,
  id: "acct-revoked",
  status: "REVOKED",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

let queryClient: QueryClient;
let lastPath = "";
const LocationProbe = () => {
  const location = useLocation();
  useEffect(() => {
    lastPath = `${location.pathname}${location.search}`;
  }, [location]);
  return null;
};
const wrapper =
  (initialEntries: string[]) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <LocationProbe />
        {children}
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("useAccountScope (Stage 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastPath = "";
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockListAccounts.mockResolvedValue({
      data: { accounts: [ACCOUNT_OLD, ACCOUNT_NEW, ACCOUNT_REVOKED] },
    });
  });

  it("defaults to the newest ACTIVE account and labels every row", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper(["/dashboard"]),
    });

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-new")
    );
    // REVOKED rows never surface, however fresh.
    expect(result.current.accounts.map(a => a.id)).toEqual([
      "acct-new",
      "acct-old",
    ]);
    expect(result.current.accountLabels).toEqual({
      "acct-new": "lighter (testnet) idx-new",
      "acct-old": "kodiak (testnet) idx-old",
    });
    // The global balance widget follows the displayed account.
    expect(mockSetActive).toHaveBeenLastCalledWith("acct-new");
  });

  it("honours a valid canonical URL value without rewriting it", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper(["/dashboard?exchangeAccountId=acct-old"]),
    });

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-old")
    );
    expect(lastPath).toBe("/dashboard?exchangeAccountId=acct-old");
    expect(mockSetActive).toHaveBeenLastCalledWith("acct-old");
  });

  it("migrates a valid legacy ?tradesAccount= to the canonical param", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper(["/dashboard?tradesAccount=acct-old"]),
    });

    // Existing shared links / bookmarks still land scoped…
    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-old")
    );
    // …then the URL collapses to the single canonical key.
    await waitFor(() =>
      expect(lastPath).toBe("/dashboard?exchangeAccountId=acct-old")
    );
  });

  it("a canonical value wins over legacy; leftover legacy still collapses", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper([
        "/dashboard?exchangeAccountId=acct-old&tradesAccount=acct-new",
      ]),
    });

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-old")
    );
    await waitFor(() =>
      expect(lastPath).toBe("/dashboard?exchangeAccountId=acct-old")
    );
  });

  it("an unknown id falls back to the default AND is stripped", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper(["/dashboard?exchangeAccountId=nope-deleted"]),
    });

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-new")
    );
    await waitFor(() => expect(lastPath).toBe("/dashboard"));
  });

  it("a non-ACTIVE id falls back to the default AND is stripped", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper(["/dashboard?exchangeAccountId=acct-revoked"]),
    });

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-new")
    );
    await waitFor(() => expect(lastPath).toBe("/dashboard"));
  });

  it("a stale legacy id falls back to the default AND is stripped", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper(["/dashboard?tradesAccount=gone"]),
    });

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-new")
    );
    await waitFor(() => expect(lastPath).toBe("/dashboard"));
  });

  it("selectAccount persists the canonical param (URL round-trip)", async () => {
    const { result } = renderHook(() => useAccountScope("user-1"), {
      wrapper: wrapper(["/dashboard?tradesAccount=acct-old"]),
    });

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-old")
    );

    act(() => result.current.selectAccount("acct-new"));

    await waitFor(() =>
      expect(result.current.selectedAccountId).toBe("acct-new")
    );
    expect(lastPath).toBe("/dashboard?exchangeAccountId=acct-new");
    expect(mockSetActive).toHaveBeenLastCalledWith("acct-new");
  });
});
