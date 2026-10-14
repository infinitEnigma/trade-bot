/** @format */

import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth";

import { websocketClient } from "../../../infrastructure/websocket/client";
import { usePortfolioSummary, useRecentTrades } from "../../../shared/hooks";
import type { VenuePnlPoint } from "../../../shared/hooks/usePortfolioSummary";
import { dashboardService } from "../services/dashboardService";
import { tradingApi } from "../../../infrastructure/api";
import { Container, Section } from "../../../shared/components/layout";
import { useAccountScope } from "../hooks/useAccountScope";
import { useNeedsAttentionCount } from "../hooks/useNeedsAttentionCount";

import { resolveDashboardAccess } from "../utils/dashboardAccess";
import { DashboardHeaderSection } from "../sections/DashboardHeaderSection";
import { MarketOverviewSection } from "../sections/MarketOverviewSection";
import { AccountOverviewSection } from "../sections/AccountOverviewSection";
import { TradingActivitySection } from "../sections/TradingActivitySection";
import { ExploreSection } from "../sections/ExploreSection";
import type { PerformanceData } from "../components/RealizedPnlChart";

// F4: the trade-derived fallback lives in `dashboardService` — the local
// copy (synthetic-baseline + clamp twin) is gone; one implementation, one
// set of semantics: cumulative realised PnL anchored at 0 without a real
// equity baseline, venue `realized_pnl` only, no non-negative clamp.
const calculatePortfolioPerformance = (
  trades: {
    realized_pnl?: string | number;
    close_timestamp?: number;
    open_timestamp?: number;
  }[]
): { time: string; value: number }[] =>
  dashboardService.calculatePortfolioPerformance(
    trades as Parameters<
      typeof dashboardService.calculatePortfolioPerformance
    >[0]
  );
/**
 * Dashboard — composition shell.
 *
 * The page owns only cross-section state and data: auth, the WS/engine status
 * queries, account scope, portfolio/trade/ledger queries, and the
 * realized-PnL series derivation. Every visible block lives in `sections/`;
 * tier-driven presentation is decided in one place (`dashboardAccess`) and
 * passed down as an `access` flag — the shell never branches on `userLevel`
 * directly. Section order is fixed for every tier; only contents change.
 *
 * Account scope: `useAccountScope` is the single source of truth for the
 * selected exchange account. It unifies the former local `portfolioAccountId`
 * and legacy `?tradesAccount=` param under one URL-persisted
 * `?exchangeAccountId=` selection (with legacy read-then-strip), and owns the
 * global balance-manager pinning effect.
 */

const Dashboard: React.FC = () => {
  const { user } = useAuth();

  // Tier model — the single source of truth for tier-driven presentation.
  const access = resolveDashboardAccess(user);

  // F3: real WS status — synchronous getter + change listener.
  const [wsStatus, setWsStatus] = useState<string>(websocketClient.getStatus());
  useEffect(() => {
    const handleStatus = (status: string) => setWsStatus(status);
    websocketClient.onStatusChange(handleStatus);
    return () => websocketClient.offStatusChange(handleStatus);
  }, []);

  // F3: Bot Engine row from the same engine-status query Strategies uses.
  // VERIFIED-only: engine/journal state is meaningless below VERIFIED (the WS
  // initializer never connects there), so the query never fires there — the
  // same render-gating that keeps bot queries out of lower tiers.
  const { data: engineStatus } = useQuery({
    queryKey: ["engine-status"],
    queryFn: () => tradingApi.getEngineStatus(),
    staleTime: 120000,
    gcTime: 300000,
    refetchInterval: 300000,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    enabled: access.sections.systemStatus,
    retry: (failureCount, error: unknown) => {
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 429) return false;
      if (err.response?.status === 403) return false;
      return failureCount < 1;
    },
  });
  const engineRunning: boolean | null =
    typeof engineStatus?.data?.running === "boolean"
      ? engineStatus.data.running
      : null;

  // Account scope — the single source of truth for the selected exchange
  // account (URL-persisted `?exchangeAccountId=`, default newest ACTIVE).
  // Owns the global balance-manager pinning effect.
  const {
    accounts: portfolioAccounts,
    selectedAccountId: activePortfolioAccountId,
    accountLabels,
    selectAccount,
    isLoading: scopeLoading,
  } = useAccountScope(user?.id);

  // B1/B6: the portfolio figures — each from a real, distinct source. Scoped
  // to the selected account.
  const portfolioSummary = usePortfolioSummary(activePortfolioAccountId);

  // Trades ledger — the platform's own ledger (GET /api/trades), NOT the
  // venue proxy. Latest-N; scoped to the selected account via the unified
  // scope (falls back to all accounts when none is selected).
  const {
    trades: ledgerTrades,
    isLoading: ledgerTradesLoading,
    error: ledgerTradesError,
  } = useRecentTrades(
    activePortfolioAccountId
      ? { exchangeAccountId: activePortfolioAccountId }
      : {}
  );
  void scopeLoading;

  // The chart plots the venue's own trade_pnl LEVEL series (hourly buckets),
  // not per-trade accumulation — Lighter fill rows carry realized_pnl "0" by
  // construction, which is why the old curve was flat. Kodiak (no venue
  // series) keeps the trade-derived curve from real rows.
  const venueTrades = portfolioSummary.trades;
  const toSeriesTime = (timestampMs: number): string =>
    new Date(timestampMs).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const portfolioData: PerformanceData[] =
    portfolioSummary.venuePnlPoints.length > 1
      ? [...portfolioSummary.venuePnlPoints]
          .map((p: VenuePnlPoint) => ({
            t: parseFloat(String(p.timestamp ?? "0")),
            v: parseFloat(String(p.tradePnl ?? p.trade_pnl ?? "0")),
          }))
          .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
          .sort((a, b) => a.t - b.t)
          .map(p => ({ time: toSeriesTime(p.t), value: p.v }))
      : venueTrades.length > 0
        ? calculatePortfolioPerformance(venueTrades)
        : [];

  // Stage 4: VERIFIED header alert CTA. Cache-only read of the shared
  // bot-instances cache — never fires the bot query below VERIFIED (the
  // render-gated `BotStatusPanel` is the single owner that populates it).
  const needsAttentionCount = useNeedsAttentionCount(
    access.sections.systemStatus
  );

  return (
    <Container
      size={{
        default: "lg", // Mobile: constrained
        xl: "xl", // Large desktop: reasonable width
        "2xl": "2xl", // Ultra-wide: wider
        "3xl": "3xl", // 1080p: even wider
        "4xl": "4xl", // 1440p: maximum readable
      }}
      className="py-2 space-y-4"
    >
      <Section>
        {/* Fixed section order for every tier; only contents change. */}
        <DashboardHeaderSection
          access={access}
          needsAttentionCount={needsAttentionCount}
        />
        <MarketOverviewSection />
        <AccountOverviewSection
          access={access}
          portfolioSummary={portfolioSummary}
          portfolioAccounts={portfolioAccounts}
          activeAccountId={activePortfolioAccountId}
          onAccountSelect={selectAccount}
          accountLabels={accountLabels}
        />
        <TradingActivitySection
          access={access}
          portfolioSummary={portfolioSummary}
          portfolioData={portfolioData}
          activeAccountId={activePortfolioAccountId}
          accountLabels={accountLabels}
          ledgerTrades={ledgerTrades}
          ledgerTradesLoading={ledgerTradesLoading}
          ledgerTradesError={ledgerTradesError}
          wsStatus={wsStatus}
          engineRunning={engineRunning}
          journalIntegrity={engineStatus?.data?.journalIntegrity}
          journalIntegrityAlert={engineStatus?.data?.journalIntegrityAlert}
        />
        {/* Always last, every tier: tier-aware next steps, no dead ends. */}
        <ExploreSection
          access={access}
          onRefresh={portfolioSummary.refresh}
          refreshing={portfolioSummary.loading}
        />
      </Section>
    </Container>
  );
};

export default Dashboard;
