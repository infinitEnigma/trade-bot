/** @format */

import React, { useState, useEffect, Suspense } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth";
import {
  accountsApi,
  ExchangeAccountDto,
} from "../../../infrastructure/api/accounts";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  DollarSign,
  Settings,
  Key,
  Loader2,
  Target,
  RefreshCw,
  X,
} from "lucide-react";

import { Link } from "react-router-dom";
import { Card } from "../../../shared/components/ui/Card";
import { SectionHeader } from "../../../shared/components/ui/SectionHeader";
import { tradingApi } from "../../../infrastructure/api";
import { websocketClient } from "../../../infrastructure/websocket/client";

import { UserProgressCard } from "../../../shared/components/user/UserProgressCard";
import { LoadingSpinner } from "../../../shared/components/ui";
import { usePortfolioSummary } from "../../../shared/hooks";
import type { VenuePnlPoint } from "../../../shared/hooks/usePortfolioSummary";
import { globalBalanceManager } from "../../../shared/services/balance-manager";
import {
  Container,
  ElectricalNetworkBackground,
  Grid,
  Section,
} from "../../../shared/components/layout";

// Type definitions for Dashboard components
interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  format?: "currency" | "number" | "pnl";
}

interface PortfolioChartProps {
  data: PerformanceData[];
  selectedSymbol?: string;
  onSymbolChange?: (symbol: string) => void;
}

interface PerformanceData {
  time: string;
  value: number;
}

// Lazy load heavy components
const PriceChart = React.lazy(
  () => import("../../../shared/components/charts/PriceChart")
);
const WalletConnectDialog = React.lazy(() =>
  import("../../../shared/components/WalletConnectDialog").then(module => ({
    default: module.WalletConnectDialog,
  }))
);
// Components removed during cleanup - using simple alternatives
const StatsCard = ({ title, value, icon: Icon, format }: StatsCardProps) => (
  <div className="glass-card p-6">
    <div className="flex items-center justify-between mb-4">
      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
        <Icon className="w-5 h-5 text-primary" />
      </div>
    </div>
    <h3
      className={`text-lg font-bold mb-1 ${
        format === "pnl"
          ? value >= 0
            ? "text-success"
            : "text-danger"
          : "text-text"
      }`}
    >
      {format === "currency"
        ? `$${value.toLocaleString()}`
        : format === "pnl"
          ? `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString()}`
          : value}
    </h3>
    <p className="text-xs text-textMuted">{title}</p>
  </div>
);

/**
 * Portfolio equity curve.
 *
 * P0: fed by the venue's own trade_pnl LEVEL series (hourly buckets) via
 * `portfolio-venue-pnl` — the same source as the realized card. The old
 * per-trade accumulation from fill rows was flat on Lighter (every row
 * carries realized_pnl "0" by construction); Kodiak keeps that path via
 * `calculatePortfolioPerformance` on real rows.
 */
const PortfolioChart = ({ data }: PortfolioChartProps) => {
  const points = data ?? [];
  const chartData = points.map((point, index) => ({
    ...point,
    index,
    label: `${point.time} (#${index})`,
  }));
  const firstValue = points[0]?.value ?? 0;
  const lastValue = points.length > 0 ? points[points.length - 1].value : 0;
  const pnl = lastValue - firstValue;
  const pnlPositive = pnl >= 0;

  if (points.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 text-textMuted mx-auto mb-4" />
          <p className="text-textMuted">No portfolio data</p>
          <p className="text-xs text-textMuted mt-2">
            Closed trades will build the equity curve here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-80">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-textMuted">
          {points.length} data points •{" "}
          <span className={pnlPositive ? "text-success" : "text-danger"}>
            {pnlPositive ? "+" : ""}$
            {pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>{" "}
          realized
        </p>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis
              dataKey="index"
              tickFormatter={index =>
                chartData[Number(index)]?.time ?? String(index)
              }
              stroke="var(--text-secondary)"
              fontSize={12}
              tick={{ fill: "var(--text-secondary)" }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              stroke="var(--text-secondary)"
              fontSize={12}
              tick={{ fill: "var(--text-secondary)" }}
              tickFormatter={(value: number) =>
                `$${Number(value).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}`
              }
              width={80}
              domain={["dataMin", "dataMax"]}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length > 0) {
                  const point = payload[0].payload as PerformanceData & {
                    index: number;
                  };
                  return (
                    <div className="glass-card p-3 border border-white/10">
                      <p className="text-sm font-medium">
                        Trade #{point.index} • {point.time}
                      </p>
                      <p className="text-sm text-primary">
                        Equity: $
                        {point.value.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              name="Equity"
              stroke="var(--primary)"
              fill="var(--primary)"
              fillOpacity={0.15}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// F3: honest relative time for the "Last Sync" row (from query dataUpdatedAt).
const formatRelativeTime = (timestampMs: number): string => {
  if (!timestampMs) return "Never";
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

// Calculate real portfolio performance from trades data
// (Kodiak fallback path — Lighter plots the venue series instead.)
const calculatePortfolioPerformance = (
  trades: {
    realized_pnl?: string | number;
    close_timestamp?: number;
    open_timestamp?: number;
  }[],
  initialBalance: number,
  currentTime = Date.now()
) => {
  if (!trades || trades.length === 0) {
    // D2: no fabricated point — the chart renders its own empty state.
    return [];
  }

  // Sort trades by close timestamp
  const sortedTrades = [...trades].sort(
    (a, b) => (a.close_timestamp || 0) - (b.close_timestamp || 0)
  );

  const performance = [{ time: "Start", value: initialBalance }];
  let currentBalance = initialBalance;

  sortedTrades.forEach(trade => {
    const pnl = parseFloat(String(trade.realized_pnl ?? "0"));
    currentBalance += pnl;

    const timestamp = new Date(
      trade.close_timestamp || trade.open_timestamp || currentTime
    );
    const timeString = timestamp.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    performance.push({
      time: timeString,
      value: Math.max(0, currentBalance), // Ensure non-negative
    });
  });

  return performance;
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [selectedSymbol, setSelectedSymbol] = useState("PERP_BTC_USDC");

  // F3: real WS status — synchronous getter + change listener (kickoff check 3).
  const [wsStatus, setWsStatus] = useState<string>(websocketClient.getStatus());
  useEffect(() => {
    const handleStatus = (status: string) => setWsStatus(status);
    websocketClient.onStatusChange(handleStatus);
    return () => websocketClient.offStatusChange(handleStatus);
  }, []);

  // F3: Bot Engine row from the same engine-status query Strategies uses.
  const { data: engineStatus } = useQuery({
    queryKey: ["engine-status"],
    queryFn: () => tradingApi.getEngineStatus(),
    staleTime: 120000,
    gcTime: 300000,
    refetchInterval: 300000,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    enabled: !!user,
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

  // Fetch portfolio data - optimized with proper deduplication

  // L2: venue-agnostic portfolio selection. Every ACTIVE account is listed
  // with an explicit switcher (previously the first ACTIVE kodiak account
  // was pinned, hiding Lighter accounts). Default is the most recently
  // created ACTIVE account — deterministic, not "kodiak first".
  const [portfolioAccountId, setPortfolioAccountId] = useState("");
  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", user?.id],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!user,
    staleTime: 30 * 1000,
  });
  const portfolioAccounts: ExchangeAccountDto[] = (
    accountsQuery.data?.data?.accounts ?? []
  )
    .filter(account => account.status === "ACTIVE")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  const activePortfolioAccountId =
    portfolioAccountId || portfolioAccounts[0]?.id || "";

  // B1/B6: the four portfolio figures — each from a real, distinct source
  // (on-chain wallet, selected exchange balance, venue-exact unrealized PnL,
  // venue-computed realized PnL, total across all ACTIVE accounts). Scoped
  // to the selected account.
  const portfolioSummary = usePortfolioSummary(activePortfolioAccountId);
  // Positions/trades/balance are venue-dispatched server-side (kodiak rows
  // → kodiak-integration, lighter rows → the Lighter portfolio reader), so
  // every ACTIVE selection is queried — no venue gate here anymore.

  // The balance widget is app-global: pin it to the displayed account.
  useEffect(() => {
    globalBalanceManager.setActiveExchangeAccountId(
      activePortfolioAccountId || null
    );
  }, [activePortfolioAccountId]);

  // P0 single-source: positions/trades/venue-PnL come from the hook's
  // portfolio-* keys only (tables + curve read the hook below).

  // P0 single-source (continued): the kodiak-trades twin is gone too.
  // Tables + curve read the hook's rows/series below — one query per
  // endpoint, one refresh timer each.

  // Process positions data — single-source from the hook.
  const positions = portfolioSummary.positions;
  const positionsLoading = portfolioSummary.positionsLoading;
  const positionsUpdatedAt = portfolioSummary.positionsUpdatedAt;
  // F3: "Last Sync" reflects the most recent successful positions read.
  const lastSyncLabel = positionsUpdatedAt
    ? formatRelativeTime(positionsUpdatedAt)
    : "Never";
  const profitablePositions = positions.filter(
    p => parseFloat(String(p.unsettled_pnl ?? "0")) >= 0
  ).length;

  // Trades table — single-source from the hook (Kodiak native rows).
  const trades = portfolioSummary.trades;
  const tradesLoading = portfolioSummary.tradesLoading;
  const tradesError = portfolioSummary.tradesError;

  // P0: the D1 dead trio (pnl/pnlPercent/dailyVolume = 0) is gone. The
  // portfolio gate reads the hook's exchange balance, not useBalance.
  const totalBalance = portfolioSummary.exchangeBalance;
  // Stable render-time fallback for rows missing both timestamps
  // (react-hooks/purity: no Date.now() inside render).
  const [renderTime] = useState(() => Date.now());

  // For VERIFIED users, always show portfolio (even with zero balances)
  // For REGISTERED users, show if balance data exists
  const shouldShowPortfolio =
    user?.userLevel === "VERIFIED" ||
    (user?.userLevel === "REGISTERED" && totalBalance > 0);

  const portfolio = shouldShowPortfolio
    ? {
        totalBalance,
        totalTrades: trades.length,
      }
    : null;

  // P0: the equity curve plots the venue's own trade_pnl LEVEL series
  // (hourly buckets), not per-trade accumulation — Lighter fill rows carry
  // realized_pnl "0" by construction, which is why the old curve was flat.
  // Kodiak (no venue series) keeps the trade-derived curve from real rows.
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
      : trades.length > 0
        ? calculatePortfolioPerformance(trades, totalBalance)
        : [];

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
        {/* ✅ User Progress Card - Shows account progression */}
        <div className="mb-8">
          <ElectricalNetworkBackground />
          <UserProgressCard />
        </div>

        {/* ✅ Market Chart Section - Full Width */}
        <div className="mb-8 contain-layout">
          <Suspense
            fallback={
              <Card className="h-96 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </Card>
            }
          >
            <PriceChart />
          </Suspense>
        </div>
        {/* Portfolio Overview — P0 single-source: the loading/error gate
            reads the hook (one balance system), not useBalance. */}
        {portfolioSummary.initialLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="p-6 flex items-center justify-center">
                <LoadingSpinner />
              </Card>
            ))}
          </div>
        ) : portfolioSummary.error ? (
          <Card className="mb-8 border-warning/20 bg-warning/5">
            <div className="flex items-start gap-3 p-6">
              <Activity className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-text">
                  Portfolio figures unavailable
                </h3>
                <p className="text-sm text-textMuted mt-1 break-words">
                  {portfolioSummary.error}
                </p>
                <p className="text-xs text-textMuted mt-2">
                  Positions and trades below carry their own error state — this
                  card only reflects the failed figure read, not a zero balance.
                </p>
              </div>
            </div>
          </Card>
        ) : portfolio ? (
          <div className="mb-8">
            <SectionHeader
              title="Portfolio Overview"
              subtitle="Real-time performance and analytics"
              actions={
                <>
                  <button
                    onClick={() => {
                      void portfolioSummary.refresh();
                    }}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                  </button>
                  {/* HD1: /strategies requires VERIFIED — a REGISTERED
                      landing spot must not offer a button that bounces. */}
                  {user?.userLevel === "VERIFIED" && (
                    <Link
                      to="/strategies"
                      className="btn-primary flex items-center gap-2"
                    >
                      <Target className="w-4 h-4" />
                      New Strategy
                    </Link>
                  )}
                </>
              }
            />

            {/* Five distinct, real figures (B1/B6; 2026-10-09 PnL fix):
                on-chain wallet, selected exchange balance, venue-exact
                unrealized PnL, venue-computed realized PnL, and the total
                across every ACTIVE exchange account. Each reads its own
                source — no card is a duplicate of another. */}
            <Grid cols={{ default: 1, md: 2, lg: 3, xl: 5 }} gap={6}>
              <StatsCard
                title="Wallet (on-chain)"
                value={portfolioSummary.walletBalance}
                icon={Wallet}
                format="currency"
              />
              <StatsCard
                title="Exchange balance"
                value={portfolioSummary.exchangeBalance}
                icon={DollarSign}
                format="currency"
              />
              <StatsCard
                title="Unrealized PnL (open positions)"
                value={portfolioSummary.unrealizedPnl}
                icon={Activity}
                format="pnl"
              />
              <StatsCard
                title="Realized PnL (7d, venue)"
                value={portfolioSummary.realizedPnl}
                icon={Activity}
                format="pnl"
              />
              <StatsCard
                title={`Total across ${
                  portfolioSummary.activeAccountCount || 0
                } exchange account${
                  portfolioSummary.activeAccountCount === 1 ? "" : "s"
                }`}
                value={portfolioSummary.totalAcrossExchanges}
                icon={TrendingUp}
                format="currency"
              />
            </Grid>
          </div>
        ) : user?.userLevel === "BASIC" ? (
          <Card className="text-center mb-8">
            <Wallet className="w-12 h-12 text-textMuted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">
              Connect Your Wallet
            </h3>
            <p className="text-textMuted mb-4">
              Your next step is connecting your wallet — use the wallet widget
              on this page to reach REGISTERED status. Exchange accounts come
              after that.
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() =>
                  document
                    .getElementById("wallet-widget")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
                className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 inline-flex items-center gap-2"
              >
                <Wallet className="w-5 h-5" />
                Go to Wallet
              </button>
              <Link
                to="/settings"
                className="text-sm text-textMuted hover:text-text underline underline-offset-4"
              >
                Exchange account settings
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="text-center mb-8">
            <Activity className="w-12 h-12 text-textMuted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">
              Connect Your Trading Account
            </h3>
            <p className="text-textMuted mb-4">
              Connect your trading account in Settings to see your portfolio,
              positions and recent trades here.
            </p>
            <Link
              to="/settings"
              className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Key className="w-5 h-5" />
              Connect Account
            </Link>
          </Card>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section — realized-only equity curve (unrealized overlay
              stays an Analytics-boundary item). Caption keeps a flat 0
              readable as information, not breakage. */}
          <Card className="lg:col-span-2">
            <Suspense
              fallback={
                <div className="h-80 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              }
            >
              <PortfolioChart
                data={portfolioData}
                selectedSymbol={selectedSymbol}
                onSymbolChange={setSelectedSymbol}
              />
            </Suspense>
            <p className="text-xs text-textMuted mt-2">
              Realized PnL from the venue (trade_pnl level, last-minus-first
              over 7d, transfers excluded) — a flat 0 means no closed PnL in the
              window yet. Unrealized (open positions) is on the cards above.
            </p>
          </Card>

          {/* Quick Actions */}
          <Card>
            <h2 className="text-lg font-semibold text-text mb-4">
              Quick Actions
            </h2>
            <div className="space-y-3">
              {/* HD1: /strategies requires VERIFIED — REGISTERED must not
                  see a link that bounces them back here. */}
              {user?.userLevel === "VERIFIED" && (
                <Link
                  to="/strategies"
                  className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  <Activity className="w-4 h-4" />
                  Manage Strategies
                </Link>
              )}
            </div>

            {/* Wallet Status Widget - visible for all authenticated users (BASIC and above).
                BASIC users connect + sign here to upgrade to REGISTERED. */}
            <div
              id="wallet-widget"
              className="mt-6 pt-6 border-t border-white/5"
            >
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                }
              >
                <WalletConnectDialog />
              </Suspense>
            </div>

            <div className="mt-6 pt-6 border-t border-white/5">
              <h3 className="text-sm font-medium text-textMuted mb-3">
                System Status
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">API Connection</span>
                  <span
                    className={`flex items-center gap-2 text-sm ${
                      wsStatus === "connected"
                        ? "text-success"
                        : wsStatus === "connecting" ||
                            wsStatus === "reconnecting"
                          ? "text-warning"
                          : "text-textMuted"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        wsStatus === "connected"
                          ? "bg-success"
                          : wsStatus === "connecting" ||
                              wsStatus === "reconnecting"
                            ? "bg-warning"
                            : "bg-textMuted"
                      }`}
                    />
                    {wsStatus === "connected"
                      ? "Connected"
                      : wsStatus === "connecting" || wsStatus === "reconnecting"
                        ? "Connecting…"
                        : "Disconnected"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">Bot Engine</span>
                  <span
                    className={`flex items-center gap-2 text-sm ${
                      engineRunning === null
                        ? "text-textMuted"
                        : engineRunning
                          ? "text-success"
                          : "text-warning"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        engineRunning === null
                          ? "bg-textMuted"
                          : engineRunning
                            ? "bg-success"
                            : "bg-warning"
                      }`}
                    />
                    {engineRunning === null
                      ? "Unknown"
                      : engineRunning
                        ? "Running"
                        : "Not running"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">Last Sync</span>
                  <span className="text-sm text-textMuted">
                    {lastSyncLabel}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Positions & Recent Trades */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Enhanced Positions Table */}
          <Card>
            <SectionHeader
              title="Open Positions"
              subtitle={`${positions.length} active positions • ${profitablePositions} profitable`}
              actions={
                <>
                  {portfolioAccounts.length > 0 && (
                    <select
                      value={activePortfolioAccountId}
                      onChange={event =>
                        setPortfolioAccountId(event.target.value)
                      }
                      aria-label="Exchange account"
                      className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-text focus:border-primary/50 focus:outline-none"
                    >
                      {portfolioAccounts.map(account => (
                        <option key={account.id} value={account.id}>
                          {account.exchange} · {account.environment} ·{" "}
                          {account.accountRef}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              }
            />

            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="table-enhanced w-full min-w-150">
                <thead>
                  <tr>
                    <th className="text-left">Symbol</th>
                    <th className="text-left">Side</th>
                    <th className="text-left">Size</th>
                    <th className="text-left">Entry Price</th>
                    <th className="text-left">Current Price</th>
                    <th className="text-left">PnL</th>
                    <th className="text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positionsLoading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                          <p className="text-text-secondary">
                            Loading positions...
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : positions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8">
                        <div className="flex flex-col items-center justify-center py-8">
                          <Target className="w-12 h-12 text-textMuted mb-4" />
                          <h3 className="text-lg font-semibold text-text mb-2">
                            No Open Positions
                          </h3>
                          <p className="text-textMuted text-center mb-4">
                            Start trading by creating a new strategy or opening
                            a position manually.
                          </p>
                        </div>
                        <div className="space-y-3">
                          {/* HD1: only VERIFIED may enter /strategies. */}
                          {user?.userLevel === "VERIFIED" && (
                            <Link
                              to="/strategies"
                              className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                            >
                              <Activity className="w-4 h-4" />
                              Manage Strategies
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    positions.map((position, index: number) => {
                      const pnl = parseFloat(
                        String(position.unsettled_pnl ?? "0")
                      );
                      const size = parseFloat(
                        String(position.position_qty ?? "0")
                      );
                      const markPrice = parseFloat(
                        String(position.mark_price ?? "0")
                      );
                      const entryPrice = parseFloat(
                        String(position.average_open_price ?? "0")
                      );
                      const pnlPercent =
                        entryPrice > 0
                          ? ((markPrice - entryPrice) / entryPrice) * 100
                          : 0;

                      return (
                        <tr key={index} className="group">
                          <td className="font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-linear-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                                <span className="text-xs font-bold">
                                  {position.symbol?.[5] || "?"}
                                </span>
                              </div>
                              <span>
                                {position.symbol
                                  ?.replace("PERP_", "")
                                  .replace("_USDC", "") || "N/A"}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
                                size > 0
                                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                  : "bg-red-500/20 text-red-400 border border-red-500/30"
                              }`}
                            >
                              {size > 0 ? (
                                <>
                                  <TrendingUp className="w-4 h-4 mr-1" />
                                  LONG
                                </>
                              ) : (
                                <>
                                  <TrendingDown className="w-4 h-4 mr-1" />
                                  SHORT
                                </>
                              )}
                            </span>
                          </td>
                          <td className="font-mono">
                            {Math.abs(size).toFixed(4)}
                          </td>
                          <td className="font-mono">
                            $
                            {entryPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="font-mono">
                            $
                            {markPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td>
                            <div
                              className={`inline-flex items-center px-3 py-1.5 rounded-lg ${
                                pnl >= 0
                                  ? "bg-green-500/10 text-green-400"
                                  : "bg-red-500/10 text-red-400"
                              }`}
                            >
                              <span className="font-medium">
                                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                              </span>
                              <span className="ml-2 text-xs opacity-80">
                                ({pnlPercent >= 0 ? "+" : ""}
                                {pnlPercent.toFixed(2)}%)
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="p-1.5 rounded hover:bg-white/5"
                                title="Close"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <button
                                className="p-1.5 rounded hover:bg-white/5"
                                title="Edit"
                              >
                                <Settings className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Recent Trades */}
          <Card>
            <h2 className="text-lg font-semibold text-text mb-4">
              Recent Trades
            </h2>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-textMuted">
                    <th className="pb-3 font-medium">Date & Time</th>
                    <th className="pb-3 font-medium">Symbol</th>
                    <th className="pb-3 font-medium">Side</th>
                    <th className="pb-3 font-medium">Price</th>
                    <th className="pb-3 font-medium text-right">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {tradesLoading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                        <p className="text-sm text-textMuted">
                          Loading trades...
                        </p>
                      </td>
                    </tr>
                  ) : tradesError && user?.userLevel !== "VERIFIED" ? (
                    // Show error for REGISTERED users if API fails
                    <tr>
                      <td colSpan={5} className="py-8 text-center">
                        <p className="text-sm text-danger">
                          Unable to load trades data
                        </p>
                      </td>
                    </tr>
                  ) : trades.length === 0 ? (
                    // Show "No recent trades" for all cases (success with empty data, or API error for VERIFIED users)
                    <tr>
                      <td colSpan={5} className="py-8 text-center">
                        <p className="text-sm text-textMuted">
                          No recent trades
                        </p>
                      </td>
                    </tr>
                  ) : (
                    trades.map((trade, index: number) => {
                      const timestamp = new Date(
                        trade.close_timestamp ||
                          trade.open_timestamp ||
                          renderTime
                      );
                      const dateString = timestamp.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      });
                      const timeString = timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                      return (
                        <tr key={index} className="border-t border-white/5">
                          <td className="py-3 text-sm text-textMuted">
                            <div className="flex flex-col">
                              <span className="font-medium">{dateString}</span>
                              <span className="text-xs opacity-75">
                                {timeString}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 text-sm text-text font-medium">
                            {trade.symbol
                              ?.replace("PERP_", "")
                              .replace("_USDC", "") || "N/A"}
                          </td>
                          <td className="py-3">
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded ${
                                trade.side === "LONG"
                                  ? "bg-success/20 text-success"
                                  : "bg-danger/20 text-danger"
                              }`}
                            >
                              {trade.side === "LONG" ? "LONG" : "SHORT"}
                            </span>
                          </td>
                          <td className="py-3 text-sm text-text">
                            $
                            {parseFloat(
                              String(
                                trade.avg_close_price ??
                                  trade.avg_open_price ??
                                  "0"
                              )
                            ).toLocaleString()}
                          </td>
                          <td className="py-3 text-sm text-text text-right">
                            {parseFloat(
                              String(trade.closed_position_qty ?? "0")
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </Section>
    </Container>
  );
};

export default Dashboard;
