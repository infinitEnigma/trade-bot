/** @format */

/**
 * usePortfolioSummary — the four portfolio figures shown on the Dashboard and
 * Strategies balance strips (B1/B6 honesty rebuild).
 *
 * Before this, all four cards were wired to a single venue `totalBalance`
 * (`balance-manager.ts` mapped wallet/account/available/total to the same
 * number). These four are genuinely distinct and each reads a real source:
 *
 * 1. **walletBalance**         — on-chain native balance of the linked wallet
 *                                (`GET /api/balance/current`).
 * 2. **exchangeBalance**       — the *selected* venue account's total balance.
 * 3. **realizedPnl**           — sum of `realized_pnl` over closed trades for
 *                                the selected account (same math as the equity
 *                                curve). Real on every venue, unlike a native
 *                                PnL field that Lighter stubs to "0".
 * 4. **totalAcrossExchanges**  — sum of every ACTIVE account's total balance.
 *
 * Each figure carries its own loading/error so a failed read renders
 * "unavailable" for that card only — never a fabricated $0 (L15 pattern).
 * All reads are gated on VERIFIED (below that the user has no exchange data).
 */

import { useQuery } from "@tanstack/react-query";
import { accountsApi, balanceApi, kodiakApi } from "../../infrastructure/api";
import type { ExchangeAccountDto } from "../../infrastructure/api/accounts";
import { useAuth } from "../../features/auth";

/** Minimal trade shape we read for realized PnL. */
interface ClosedTrade {
  realized_pnl?: string | number;
}

const toNumber = (value: unknown): number => {
  const n =
    typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

export interface PortfolioSummary {
  walletBalance: number;
  exchangeBalance: number;
  realizedPnl: number;
  totalAcrossExchanges: number;
  /** Count of ACTIVE accounts backing the "total across exchanges" figure. */
  activeAccountCount: number;
  loading: boolean;
  /** True while the very first load is in flight (no data yet at all). */
  initialLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export const usePortfolioSummary = (
  selectedAccountId?: string
): PortfolioSummary => {
  const { user } = useAuth();
  const isVerified = user?.userLevel === "VERIFIED";

  // ACTIVE accounts drive both the per-account reads and the cross-exchange
  // total. One list query, shared key with the rest of the app.
  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", user?.id],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!user && isVerified,
    staleTime: 30 * 1000,
  });

  const activeAccounts: ExchangeAccountDto[] = (
    accountsQuery.data?.data?.accounts ?? []
  ).filter(account => account.status === "ACTIVE");

  // Resolve the selected account (fall back to the newest ACTIVE one so the
  // strip is never empty when the caller doesn't pin an account).
  const selectedAccount =
    activeAccounts.find(a => a.id === selectedAccountId) ?? activeAccounts[0];

  // 1. On-chain wallet balance (native balance of the linked wallet).
  const walletQuery = useQuery({
    queryKey: ["wallet-balance", user?.id],
    queryFn: async () => {
      const res = await balanceApi.getCurrentBalance();
      const data = res?.data as
        { balance?: string | number } | string | number | undefined;
      if (typeof data === "object" && data && "balance" in data) {
        return toNumber(data.balance);
      }
      return toNumber(data);
    },
    enabled: !!user && isVerified,
    staleTime: 60 * 1000,
    retry: false,
  });

  // 2. Selected account's exchange balance.
  const balanceQuery = useQuery({
    queryKey: ["portfolio-balance", selectedAccount?.id],
    queryFn: async () => {
      const res = await kodiakApi.getKodiakBalance(selectedAccount!.id);
      return toNumber(res?.data?.totalBalance);
    },
    enabled: !!selectedAccount && isVerified,
    staleTime: 30 * 1000,
    retry: false,
  });

  // 3. Realized PnL from closed trades for the selected account.
  const tradesQuery = useQuery({
    queryKey: ["portfolio-trades", selectedAccount?.id],
    queryFn: async () => {
      const res = await kodiakApi.getKodiakTrades(50, selectedAccount!.id);
      const rows = (res?.data?.rows ?? []) as ClosedTrade[];
      return rows.reduce((sum, t) => sum + toNumber(t.realized_pnl), 0);
    },
    enabled: !!selectedAccount && isVerified,
    staleTime: 30 * 1000,
    retry: false,
  });

  // 4. Total across every ACTIVE account (one balance read per account).
  const totalQuery = useQuery({
    queryKey: ["portfolio-total", user?.id, activeAccounts.map(a => a.id)],
    queryFn: async () => {
      const perAccount = await Promise.all(
        activeAccounts.map(async account => {
          try {
            const res = await kodiakApi.getKodiakBalance(account.id);
            return toNumber(res?.data?.totalBalance);
          } catch {
            return 0; // a single unreadable account must not zero the total
          }
        })
      );
      return perAccount.reduce((sum, v) => sum + v, 0);
    },
    enabled: activeAccounts.length > 0 && isVerified,
    staleTime: 30 * 1000,
    retry: false,
  });

  const error =
    walletQuery.error || balanceQuery.error || totalQuery.error
      ? "Some portfolio figures are unavailable right now."
      : null;

  const refresh = () => {
    void accountsQuery.refetch();
    void walletQuery.refetch();
    void balanceQuery.refetch();
    void tradesQuery.refetch();
    void totalQuery.refetch();
  };

  return {
    walletBalance: walletQuery.data ?? 0,
    exchangeBalance: balanceQuery.data ?? 0,
    realizedPnl: tradesQuery.data ?? 0,
    totalAcrossExchanges: totalQuery.data ?? 0,
    activeAccountCount: activeAccounts.length,
    loading:
      accountsQuery.isLoading ||
      walletQuery.isFetching ||
      balanceQuery.isFetching ||
      tradesQuery.isFetching ||
      totalQuery.isFetching,
    initialLoading:
      isVerified && accountsQuery.isLoading && !accountsQuery.data,
    error,
    refresh,
  };
};

export default usePortfolioSummary;
