/** @format */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  DollarSign,
  Zap,
  Settings,
  LogOut,
  Key,
  Loader2,
  Shield,
  ChevronDown,
  User,
  CreditCard,
  BarChart3,
  Bell,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Target,
  Timer,
  RefreshCw,
  Sparkles,
  Plus,
  X,
  Download,
  Filter,
  SortAsc,
} from "lucide-react";

import { Link } from "react-router-dom";
import { WalletConnectDialog } from "../components/WalletConnectDialog";
import EmptyState from "../components/dashboard/EmptyState";
import StatsCard from "../components/dashboard/StatsCard";

// Calculate real portfolio performance from trades data
const calculatePortfolioPerformance = (
  trades: any[],
  initialBalance = 10000
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

  sortedTrades.forEach((trade) => {
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
  const { user, logout } = useAuth();
  const [selectedSymbol, setSelectedSymbol] = useState("PERP_BTC_USDC");
  const [showWalletDialog, setShowWalletDialog] = useState(false);

  // Fetch Kodiak data
  const { data: positionsData, isLoading: positionsLoading } = useQuery({
    queryKey: ["kodiak-positions"],
    queryFn: () => api.getKodiakPositions(),
    enabled: user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED",
  });

  const { data: tradesData, isLoading: tradesLoading } = useQuery({
    queryKey: ["kodiak-trades"],
    queryFn: () => api.getKodiakTrades(),
    enabled: user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED",
  });

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ["kodiak-balance"],
    queryFn: () => api.getKodiakBalance(),
    enabled: user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED",
  });

  // Process positions data
  const positions = positionsData?.success
    ? positionsData.data?.rows || []
    : [];
  const profitablePositions = positions.filter(
    (p: any) => p.unsettled_pnl >= 0
  ).length;

  // Process balance data
  console.log("Balance data:", balanceData);
  console.log("balanceData?.success:", balanceData?.success);
  console.log("balanceData?.data:", balanceData?.data);
  const balance = balanceData?.success ? balanceData.data : null;
  console.log("Processed balance:", balance);
  const totalBalance = balance
    ? parseFloat(balance.totalBalance || "0")
    : 10600;
  console.log("Total balance:", totalBalance);
  const pnl = balance ? parseFloat(balance.total_pnl_24_h || "0") : 600;
  const pnlPercent = totalBalance > 0 ? (pnl / (totalBalance - pnl)) * 100 : 0;

  // Get volume data from balance or use fallback
  const dailyVolume = balance
    ? parseFloat(balance.trading_volume_last_24_hours || "0")
    : 12500;

  // Use only real data - no mock fallbacks
  const portfolio =
    balance !== null
      ? {
          totalBalance,
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

  // Progress Indicator Component
  const ProgressIndicator = ({
    value,
    max = 100,
    label,
  }: {
    value: number;
    max?: number;
    label: string;
  }) => (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="font-medium">
          {value}/{max}
        </span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-linear-to-r from-primary to-accent rounded-full transition-all duration-500"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );

  // Metric Card Component
  const MetricCard = ({
    label,
    value,
    trend,
    icon,
  }: {
    label: string;
    value: string;
    trend: "up" | "down" | "neutral";
    icon: React.ReactNode;
  }) => (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-text-secondary text-sm">{label}</div>
        <div
          className={`p-2 rounded-lg ${
            trend === "up"
              ? "bg-green-500/10 text-green-400"
              : trend === "down"
              ? "bg-red-500/10 text-red-400"
              : "bg-gray-500/10 text-gray-400"
          }`}
        >
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Enhanced Header */}
      <header className="glass-surface border-b border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-linear-to-br from-primary to-accent flex items-center justify-center shadow-lg hover-lift">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-bg-surface animate-pulse"></div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-linear-to-r from-primary via-accent to-purple-500 bg-clip-text text-transparent">
                  Trade Bot
                </h1>
                <p className="text-xs text-text-tertiary">
                  Automated Trading Platform
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-4">
                <Link
                  to="/strategies"
                  className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200 flex items-center gap-2"
                >
                  <Activity className="w-4 h-4" />
                  Strategies
                </Link>
                <Link
                  to="/analytics"
                  className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200 flex items-center gap-2"
                >
                  <BarChart3 className="w-4 h-4" />
                  Analytics
                </Link>
                <Link
                  to="/settings"
                  className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200 flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
              </div>

              {/* User Profile with enhanced dropdown */}
              <div className="relative group">
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-linear-to-r from-bg-surface to-bg-surface-light border border-white/5 cursor-pointer hover:border-white/10 transition-all">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-linear-to-br from-primary to-accent flex items-center justify-center">
                      <span className="text-sm font-bold text-white">
                        {user?.email?.[0]?.toUpperCase() || "U"}
                      </span>
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-bg-surface bg-green-500"></div>
                  </div>
                  <div className="hidden md:block">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">
                        {user?.email?.split("@")[0] || "User"}
                      </span>
                      <span
                        className={`px-2 py-1 text-xs rounded-full font-medium ${
                          user?.userLevel === "VERIFIED"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-yellow-500/20 text-yellow-400"
                        }`}
                      >
                        {user?.userLevel || "BASIC"}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      Last login: Just now
                    </p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-text-tertiary" />
                </div>

                {/* Dropdown Menu */}
                <div className="absolute right-0 top-full mt-2 w-64 glass-card opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform translate-y-2 group-hover:translate-y-0">
                  <div className="p-4 border-b border-white/5">
                    <p className="text-sm font-medium text-text-primary">
                      {user?.email}
                    </p>
                    <p className="text-xs text-text-tertiary mt-1">
                      Trading Account
                    </p>
                  </div>
                  <div className="p-2">
                    <Link
                      to="/profile"
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <User className="w-4 h-4" />
                      <span className="text-sm">Profile Settings</span>
                    </Link>
                    <Link
                      to="/billing"
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span className="text-sm">Billing</span>
                    </Link>
                    <button
                      onClick={logout}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="text-sm">Logout</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Portfolio Overview */}
        {balanceLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-[rgba(19,19,26,0.7)] backdrop-blur-md border border-white/5 rounded-xl p-6"
              >
                <div className="animate-pulse">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 bg-white/10 rounded-lg"></div>
                    <div className="w-20 h-4 bg-white/10 rounded"></div>
                  </div>
                  <div className="w-24 h-8 bg-white/10 rounded mb-2"></div>
                  <div className="w-16 h-4 bg-white/10 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : portfolio ? (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-text-primary mb-2">
                  Portfolio Overview
                </h2>
                <p className="text-text-tertiary">
                  Real-time performance and analytics
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button className="btn-secondary flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                <button className="btn-primary flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  New Strategy
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatsCard
                title="Total Balance"
                value={portfolio?.totalBalance || 0}
                change={portfolio?.pnlPercent || 0}
                icon={<Wallet className="w-6 h-6 text-primary" />}
                color="primary"
                format="currency"
                loading={balanceLoading}
              />
              <StatsCard
                title="24h P&L"
                value={portfolio?.pnl || 0}
                change={portfolio?.pnlPercent || 0}
                icon={<DollarSign className="w-6 h-6 text-success" />}
                color="success"
                format="currency"
              />
              <StatsCard
                title="24h Volume"
                value={portfolio?.dailyVolume || 0}
                change={12.5}
                icon={<Activity className="w-6 h-6 text-warning" />}
                color="warning"
                format="currency"
              />
              <StatsCard
                title="Active Positions"
                value={positions.length}
                change={
                  profitablePositions > 0
                    ? (profitablePositions / positions.length) * 100
                    : 0
                }
                icon={<TrendingUp className="w-6 h-6 text-info" />}
                color="info"
              />
            </div>
          </div>
        ) : user?.userLevel === "BASIC" ? (
          <div className="bg-[rgba(19,19,26,0.7)] backdrop-blur-md border border-white/5 rounded-xl p-8 mb-8 text-center">
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
          </div>
        ) : (
          <div className="bg-[rgba(19,19,26,0.7)] backdrop-blur-md border border-white/5 rounded-xl p-8 mb-8 text-center">
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
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section */}
          <div className="lg:col-span-2 bg-[rgba(19,19,26,0.7)] backdrop-blur-md border border-white/5 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-text">
                Portfolio Performance
              </h2>
              <div className="flex items-center gap-2">
                {["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"].map(
                  (symbol) => (
                    <button
                      key={symbol}
                      onClick={() => setSelectedSymbol(symbol)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        selectedSymbol === symbol
                          ? "bg-primary text-white"
                          : "text-textMuted hover:text-text hover:bg-white/5"
                      }`}
                    >
                      {symbol.replace("PERP_", "").replace("_USDC", "")}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={portfolioData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#13131a",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "8px",
                      color: "#e2e8f0",
                    }}
                    formatter={(value: number | undefined) => [
                      value ? `$${value.toLocaleString()}` : "$0",
                      "Value",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorValue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-[rgba(19,19,26,0.7)] backdrop-blur-md border border-white/5 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-text mb-4">
              Quick Actions
            </h2>
            <div className="space-y-3">
              <Link
                to="/strategies"
                className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                <Activity className="w-4 h-4" />
                Manage Strategies
              </Link>
            </div>

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
          </div>
        </div>

        {/* Positions & Recent Trades */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Enhanced Positions Table */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-text-primary">
                  Open Positions
                </h2>
                <p className="text-sm text-text-tertiary mt-1">
                  {positions.length} active positions • {profitablePositions}{" "}
                  profitable
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm">
                  Filter
                </button>
                <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm">
                  Sort
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/5">
              <table className="table-enhanced w-full">
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
                        <EmptyState
                          icon={<Target className="w-6 h-6" />}
                          title="No Open Positions"
                          description="Start trading by creating a new strategy or opening a position manually."
                          variant="info"
                        />
                        <div className="space-y-3">
                          <Link
                            to="/strategies"
                            className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
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
          </div>

          {/* Recent Trades */}
          <div className="bg-[rgba(19,19,26,0.7)] backdrop-blur-md border border-white/5 rounded-xl p-6">
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
          </div>
        </div>
      </div>

      {/* Wallet Connect Dialog */}
      <WalletConnectDialog
        isOpen={showWalletDialog}
        onClose={() => setShowWalletDialog(false)}
      />
    </div>
  );
};

export default Dashboard;
