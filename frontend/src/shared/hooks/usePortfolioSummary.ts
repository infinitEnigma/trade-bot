/** @format */

/**
 * usePortfolioSummary — the portfolio figures shown on the Dashboard and
 * Strategies balance strips (B1/B6 honesty rebuild; 2026-10-09 PnL fix).
 *
 * Before this, all four cards were wired to a single venue `totalBalance`
 * (`balance-manager.ts` mapped wallet/account/available/total to the same
 * number). These are genuinely distinct and each reads a real source:
 *
 * 1. **walletBalance**         — on-chain native balance of the linked wallet
 *                                (`GET /api/balance/current`).
 * 2. **exchangeBalance**       — the *selected* venue account's total balance.
 * 3. **unrealizedPnl**         — venue-exact open-position PnL: sum of
 *                                `unsettled_pnl` over the selected account's
 *                                positions (the same number the venue's own
 *                                portfolio page shows and the positions table
 *                                renders per-row). Zero open positions reads
 *                                0 — truthful, not fabricated.
 * 4. **realizedPnl**           — venue-computed realized PnL for the selected
 *                                account. Lighter fill rows carry NO per-fill
 *                                PnL (verified live 2026-10-09, account 123),
 *                                so this reads the venue's own `trade_pnl`
 *                                series (`GET /api/market/pnl`,
 *                                `ignore_transfers=true`). `trade_pnl` is a
 *                                cumulative realized level (≈ equity ex open
 *                                positions), so the figure is **last − first**
 *                                over the 7d window — never a sum (summing
 *                                levels fabricates millions). Kodiak keeps its
 *                                native per-trade `realizedPnl` rows via
 *                                `/trades` (the `/pnl` endpoint 404s there —
 *                                treated as "no venue series", never an
 *                                error).
 * 5. **totalAcrossExchanges**  — sum of every ACTIVE account's total balance.
 *
 * Each figure carries its own loading/error so a failed read renders
 * "unavailable" for that card only — never a fabricated $0 (L15 pattern).
 * All reads are gated on VERIFIED (below that the user has no exchange data).
 */

import { useQuery } from "@tanstack/react-query";
import { accountsApi, balanceApi, kodiakApi } from "../../infrastructure/api";
import type { ExchangeAccountDto } from "../../infrastructure/api/accounts";
import { useAuth } from "../../features/auth";

/** Minimal position shape we read for unrealized PnL. */
export interface PortfolioPosition {
  symbol?: string;
  position_qty?: string | number;
  average_open_price?: string | number;
  mark_price?: string | number;
  unsettled_pnl?: string | number;
  side?: string;
}

/** Minimal trade shape we read for realized PnL (Kodiak native rows). */
export interface PortfolioTrade {
  symbol?: string;
  side?: string;
  closed_position_qty?: string | number;
  avg_close_price?: string | number;
  avg_open_price?: string | number;
  realized_pnl?: string | number;
  close_timestamp?: number;
  open_timestamp?: number;
}

/** One point of the venue-computed realized-PnL series (Lighter `/pnl`). */
export interface VenuePnlPoint {
  timestamp?: string | number;
  tradePnl?: string | number;
  trade_pnl?: string | number;
  volume?: string | number;
}

const toNumber = (value: unknown): number => {
  const n =
    typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

export interface PortfolioSummary {
  walletBalance: number;
  exchangeBalance: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalAcrossExchanges: number;
  /** Raw position rows for single-source table consumers. */
  positions: PortfolioPosition[];
  positionsLoading: boolean;
  positionsUpdatedAt: number;
  /** Raw trade rows (Kodiak fallback path) for single-source consumers. */
  trades: PortfolioTrade[];
  tradesLoading: boolean;
  tradesError: unknown;
  /** Venue realized series (plot-ready levels) for the equity curve. */
  venuePnlPoints: VenuePnlPoint[];
  venuePnlLoading: boolean;
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

  // 3. Unrealized PnL — venue-exact sum over the selected account's open
  // positions (same `unsettled_pnl` the positions table renders per-row).
  const positionsQuery = useQuery({
    queryKey: ["portfolio-positions", selectedAccount?.id],
    queryFn: async () => {
      const res = await kodiakApi.getKodiakPositions(selectedAccount!.id);
      return (res?.data?.rows ?? []) as PortfolioPosition[];
    },
    enabled: !!selectedAccount && isVerified,
    staleTime: 30 * 1000,
    retry: false,
  });
  const unrealizedPnl = (positionsQuery.data ?? []).reduce(
    (sum, p) => sum + toNumber(p.unsettled_pnl),
    0
  );

  // 4. Realized PnL for the selected account — venue-computed series first
  // (Lighter `/pnl`: fill rows carry no per-fill PnL), Kodiak native rows
  // as the fallback (its `/pnl` answers 404 → empty series, never an error).
  const venuePnlQuery = useQuery({
    queryKey: ["portfolio-venue-pnl", selectedAccount?.id],
    queryFn: async () => {
      const res = await kodiakApi.getVenuePnl(168, selectedAccount!.id);
      const points = (res?.data?.points ?? []) as VenuePnlPoint[];
      // trade_pnl is a cumulative realized level, not per-bucket deltas —
      // the windowed figure is last − first (sorted by timestamp). A sum
      // would fabricate millions.
      const levels = points
        .map(p => ({
          t: toNumber(p.timestamp),
          v: toNumber(p.tradePnl ?? p.trade_pnl),
        }))
        .sort((a, b) => a.t - b.t);
      return {
        points,
        total:
          levels.length > 1 ? levels[levels.length - 1].v - levels[0].v : 0,
        count: levels.length,
      };
    },
    enabled: !!selectedAccount && isVerified,
    staleTime: 60 * 1000,
    retry: false,
  });
  const tradesQuery = useQuery({
    queryKey: ["portfolio-trades", selectedAccount?.id],
    queryFn: async () => {
      const res = await kodiakApi.getKodiakTrades(50, selectedAccount!.id);
      return (res?.data?.rows ?? []) as PortfolioTrade[];
    },
    enabled: !!selectedAccount && isVerified && venuePnlQuery.data?.count === 0,
    staleTime: 30 * 1000,
    retry: false,
  });
  const realizedPnl =
    (venuePnlQuery.data?.count ?? 0) > 0
      ? (venuePnlQuery.data?.total ?? 0)
      : (tradesQuery.data ?? []).reduce(
          (sum, t) => sum + toNumber(t.realized_pnl),
          0
        );

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
    void positionsQuery.refetch();
    void venuePnlQuery.refetch();
    void tradesQuery.refetch();
    void totalQuery.refetch();
  };

  return {
    walletBalance: walletQuery.data ?? 0,
    exchangeBalance: balanceQuery.data ?? 0,
    unrealizedPnl,
    realizedPnl,
    totalAcrossExchanges: totalQuery.data ?? 0,
    activeAccountCount: activeAccounts.length,
    // Raw rows for single-source consumers (Dashboard tables read these —
    // no second query under a different key for the same endpoint).
    positions: positionsQuery.data ?? [],
    positionsLoading: positionsQuery.isLoading,
    positionsUpdatedAt: positionsQuery.dataUpdatedAt,
    trades: tradesQuery.data ?? [],
    tradesLoading: tradesQuery.isLoading,
    tradesError: tradesQuery.error,
    // Venue realized series (plot-ready levels) for the equity curve.
    venuePnlPoints: venuePnlQuery.data?.points ?? [],
    venuePnlLoading: venuePnlQuery.isLoading,
    loading:
      accountsQuery.isLoading ||
      walletQuery.isFetching ||
      balanceQuery.isFetching ||
      positionsQuery.isFetching ||
      venuePnlQuery.isFetching ||
      tradesQuery.isFetching ||
      totalQuery.isFetching,
    initialLoading:
      isVerified && accountsQuery.isLoading && !accountsQuery.data,
    error,
    refresh,
  };
};

export default usePortfolioSummary;
