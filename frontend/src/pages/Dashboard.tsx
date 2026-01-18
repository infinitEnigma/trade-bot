/** @format */

import React, { useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
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
import { Card } from "../components/ui/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
import { AppHeader } from "../components/ui/AppHeader";
import { UserProgressCard } from "../components/ui/UserProgressCard";
import { DashboardCardSkeleton } from "../components/ui/EnhancedLoading";
import { useBalance } from "../hooks/useBalance";
import { PageLayout, Container, Grid, Section } from "../components/layout";

// Lazy load heavy components
const PriceChart = React.lazy(() => import("../components/PriceChart"));
const WalletConnectDialog = React.lazy(() =>
  import("../components/WalletConnectDialog").then(module => ({
    default: module.WalletConnectDialog,
  }))
);
const EmptyState = React.lazy(
  () => import("../components/dashboard/EmptyState")
);
const StatsCard = React.lazy(() => import("../components/dashboard/StatsCard"));
const PortfolioChart = React.lazy(
  () => import("../components/dashboard/PortfolioChart")
);

// Calculate real portfolio performance from trades data
const calculatePortfolioPerformance = (
  trades: any[],
  initialBalance = 10000 // TODO: find first balance, replace arbitrary 10000
) => {
  if (!trades || trades.length === 0) {
    return [{ time: "No data", value: initialBalance }];
  }

  // Sort trades by close timestamp
  const sortedTrades = [...trades].sort(
    (a, b) => (a.close_timestamp || 0) - (b.close_timestamp || 0)
  );

  const performance = [{ time: "Start", value: initialBalance }];
  let currentBalance = initialBalance;

  sortedTrades.forEach(trade => {
    const pnl = parseFloat(trade.realized_pnl || "0");
    currentBalance += pnl;

    const timestamp = new Date(
      trade.close_timestamp || trade.open_timestamp || Date.now()
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
  //const [showWalletDialog, setShowWalletDialog] = useState(false);

  // ✅ Fetch real balance data - moved to top
  const { balance: realBalance, loading: realBalanceLoading } = useBalance();

  // Fetch Kodiak data - optimized with proper deduplication
  const hasKodiakAccess =
    user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED";

  const { data: positionsData, isLoading: positionsLoading } = useQuery({
    queryKey: ["kodiak-positions"],
    queryFn: () => api.getKodiakPositions(),
    enabled: hasKodiakAccess,
    staleTime: 30000, // 30 seconds
    gcTime: 300000, // 5 minutes
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 400) return false;
      return failureCount < 2;
    },
  });

  const { data: tradesData, isLoading: tradesLoading } = useQuery({
    queryKey: ["kodiak-trades"],
    queryFn: () => api.getKodiakTrades(),
    enabled: hasKodiakAccess,
    staleTime: 30000,
    gcTime: 300000,
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 400) return false;
      return failureCount < 2;
    },
  });

  // Remove duplicate balance query - use only useBalance hook

  // Process positions data
  const positions = positionsData?.success
    ? positionsData.data?.rows || []
    : [];
  const profitablePositions = positions.filter(
    (p: any) => p.unsettled_pnl >= 0
  ).length;

  // Process balance data from useBalance hook
  const totalBalance = realBalance?.accountBalance || 0;
  const pnl = 0; // TODO: Add PNL calculation from trading data
  const pnlPercent = 0; // TODO: Calculate percentage
  const dailyVolume = 0; // TODO: Add volume tracking

  // Use only real data - no mock fallbacks
  const portfolio = realBalance
    ? {
        totalBalance: realBalance.accountBalance,
        pnl,
        pnlPercent,
        dailyVolume,
        totalTrades: tradesData?.success
          ? tradesData.data?.rows?.length || 0
          : 0,
      }
    : null;

  // Calculate real portfolio performance chart data
  const portfolioData =
    tradesData?.success && tradesData.data?.rows
      ? calculatePortfolioPerformance(tradesData.data.rows, totalBalance)
      : [{ time: "No data", value: totalBalance || 10000 }];

  return (
    <PageLayout header={<AppHeader />}>
      <Container className="py-6 space-y-10">
        <Section>
        {/* ✅ User Progress Card - Shows account progression */}
        <div className="mb-8">
          <UserProgressCard />
        </div>

        {/* ✅ Market Chart Section - Full Width */}
        <div className="mb-8">
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
        {/* Portfolio Overview */}
        {realBalanceLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <DashboardCardSkeleton />
            <DashboardCardSkeleton />
            <DashboardCardSkeleton />
            <DashboardCardSkeleton />
          </div>
        ) : portfolio ? (
          <div className="mb-8">
            <SectionHeader
              title="Portfolio Overview"
              subtitle="Real-time performance and analytics"
              actions={
                <>
                  <button className="btn-secondary flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                  </button>
                  <button className="btn-primary flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    New Strategy
                  </button>
                </>
              }
            />

            <Grid cols={{ default: 1, md: 2, lg: 4 }} gap={6}>
              <Suspense fallback={<DashboardCardSkeleton />}>
                <StatsCard
                  title="Wallet Balance"
                  value={realBalance?.walletBalance || 0}
                  change={0}
                  icon={Wallet}
                  color="primary"
                  format="currency"
                  loading={realBalanceLoading}
                />
              </Suspense>
              <Suspense fallback={<DashboardCardSkeleton />}>
                <StatsCard
                  title="Account Balance"
                  value={realBalance?.accountBalance || 0}
                  change={0}
                  icon={DollarSign}
                  color="success"
                  format="currency"
                />
              </Suspense>
              <Suspense fallback={<DashboardCardSkeleton />}>
                <StatsCard
                  title="Available Balance"
                  value={realBalance?.availableBalance || 0}
                  change={0}
                  icon={Activity}
                  color="warning"
                  format="currency"
                />
              </Suspense>
              <Suspense fallback={<DashboardCardSkeleton />}>
                <StatsCard
                  title="Total Assets"
                  value={realBalance?.totalAssets || 0}
                  change={0}
                  icon={TrendingUp}
                  color="info"
                  format="currency"
                />
              </Suspense>
            </Grid>
          </div>
        ) : user?.userLevel === "BASIC" ? (
          <Card className="text-center mb-8">
            <Wallet className="w-12 h-12 text-textMuted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">
              Connect Your Kodiak Account
            </h3>
            <p className="text-textMuted mb-4">
              Connect your trading account to view your portfolio data and
              trading performance.
            </p>
            <Link
              to="/settings"
              className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Key className="w-4 h-4" />
              Connect Account
            </Link>
          </Card>
        ) : (
          <Card className="text-center mb-8">
            <Activity className="w-12 h-12 text-textMuted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">
              No Portfolio Data Available
            </h3>
            <p className="text-textMuted mb-4">
              Unable to fetch portfolio data at this time. Please try refreshing
              the page or contact support if the issue persists.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              Refresh Page
            </button>
          </Card>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section */}
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
          </Card>

          {/* Quick Actions */}
          <Card>
            <h2 className="text-lg font-semibold text-text mb-4">
              Quick Actions
            </h2>
            <div className="space-y-3">
              <Link
                to="/strategies"
                className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                <Activity className="w-4 h-4" />
                Manage Strategies
              </Link>
            </div>

            {/* Wallet Status Widget - only for registered users */}
            {(user?.userLevel === "REGISTERED" ||
              user?.userLevel === "VERIFIED") && (
              <div className="mt-6 pt-6 border-t border-white/5">
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
            )}

            <div className="mt-6 pt-6 border-t border-white/5">
              <h3 className="text-sm font-medium text-textMuted mb-3">
                System Status
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">API Connection</span>
                  <span className="flex items-center gap-2 text-sm text-success">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    Connected
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">Bot Engine</span>
                  <span className="flex items-center gap-2 text-sm text-warning">
                    <span className="w-2 h-2 rounded-full bg-warning" />
                    Idle
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">Last Sync</span>
                  <span className="text-sm text-textMuted">Just now</span>
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
                  <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm">
                    Filter
                  </button>
                  <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm">
                    Sort
                  </button>
                </>
              }
            />

            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="table-enhanced w-full min-w-[600px]">
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
                        <Suspense
                          fallback={
                            <div className="flex flex-col items-center justify-center py-4">
                              <Loader2 className="w-6 h-6 animate-spin text-primary mb-2" />
                              <p className="text-sm text-textMuted">
                                Loading...
                              </p>
                            </div>
                          }
                        >
                          <EmptyState
                            icon={<Target className="w-6 h-6" />}
                            title="No Open Positions"
                            description="Start trading by creating a new strategy or opening a position manually."
                            variant="info"
                          />
                        </Suspense>
                        <div className="space-y-3">
                          <Link
                            to="/strategies"
                            className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                          >
                            <Activity className="w-4 h-4" />
                            Manage Strategies
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    positions.map((position: any, index: number) => {
                      const pnl = parseFloat(position.unsettled_pnl || "0");
                      const size = parseFloat(position.position_qty || "0");
                      const markPrice = parseFloat(position.mark_price || "0");
                      const entryPrice = parseFloat(
                        position.average_open_price || "0"
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
                                  <TrendingUp className="w-3 h-3 mr-1" />
                                  LONG
                                </>
                              ) : (
                                <>
                                  <TrendingDown className="w-3 h-3 mr-1" />
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
                  ) : !tradesData?.success ||
                    !tradesData.data?.rows ||
                    tradesData.data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center">
                        <p className="text-sm text-textMuted">
                          No recent trades
                        </p>
                      </td>
                    </tr>
                  ) : (
                    tradesData.data.rows.map((trade: any, index: number) => {
                      const timestamp = new Date(
                        trade.close_timestamp ||
                          trade.open_timestamp ||
                          Date.now()
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
                              trade.avg_close_price ||
                                trade.avg_open_price ||
                                "0"
                            ).toLocaleString()}
                          </td>
                          <td className="py-3 text-sm text-text text-right">
                            {parseFloat(trade.closed_position_qty || "0")}
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
    </PageLayout>
  );
};

export default Dashboard;
