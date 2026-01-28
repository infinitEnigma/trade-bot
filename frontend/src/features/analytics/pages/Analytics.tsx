/** @format */

import React, { useState } from "react";
import { useAuth } from "../../auth";
import { UserRole } from "../../../shared/types";
import { AppHeader } from "../../../components/ui/AppHeader";
import { Card } from "../../../shared/components/ui/Card";
import { SectionHeader } from "../../../shared/components/ui/SectionHeader";
import { TimeWindowSelector } from "../../../shared/components/ui/TimeWindowSelector";
import { AnalyticsLoading } from "../../../shared/components/feedback/AnalyticsLoading";
import { useAnalytics } from "../hooks/useAnalytics";
import { AnalyticsTimeWindow } from "../types/analytics.types";
import {
  BarChart3,
  TrendingUp,
  Activity,
  Users,
  DollarSign,
  Lock,
  Shield,
  RefreshCw
} from "lucide-react";

// Access Denied Component
const AccessDenied: React.FC<{ requiredRole: string }> = ({ requiredRole }) => (
  <div className="min-h-screen flex items-center justify-center bg-background px-4">
    <div className="max-w-md w-full">
      <div className="glass-card p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-amber-500/10 rounded-full flex items-center justify-center">
          <Shield className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold text-text mb-4">
          Advanced Analytics
        </h1>
        <p className="text-textMuted mb-6">
          Access to detailed trading analytics and performance insights requires {requiredRole} qualification.
        </p>
        <div className="space-y-3">
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-amber-400 mb-2">
              <Lock className="w-4 h-4" />
              <span className="text-sm font-medium">Alpha Testing Feature</span>
            </div>
            <p className="text-xs text-textMuted">
              This feature is part of our private testing program and requires wallet qualification.
            </p>
          </div>
          <button
            onClick={() => window.history.back()}
            className="btn-secondary w-full"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  </div>
);

// Mock analytics data (replace with real data in production)
const mockAnalytics = {
  performance: {
    totalReturn: 12.5,
    winRate: 68.5,
    totalTrades: 1247,
    avgTradeDuration: "2.3 hours",
    bestDay: "+5.2%",
    worstDay: "-2.1%"
  },
  risk: {
    sharpeRatio: 1.8,
    maxDrawdown: 8.3,
    volatility: 12.4,
    beta: 0.85,
    alpha: 3.2
  },
  market: {
    marketCorrelation: 0.72,
    sectorPerformance: [
      { sector: "DeFi", performance: 15.2, contribution: 35 },
      { sector: "NFT", performance: -3.1, contribution: 15 },
      { sector: "Gaming", performance: 8.7, contribution: 25 },
      { sector: "Infrastructure", performance: 22.1, contribution: 25 }
    ]
  }
};

const Analytics: React.FC = () => {
  const { user } = useAuth();
  const [selectedSymbol] = useState("PERP_BTC_USDC");
  const [selectedTimeWindow, setSelectedTimeWindow] = useState<AnalyticsTimeWindow>({
    label: '30 Days',
    days: 30,
    value: '30d'
  });

  // Load analytics data - moved before conditional to comply with Rules of Hooks
  const { data, loading, error, progress, timeWindows, refetch } = useAnalytics({
    symbol: selectedSymbol,
    timeWindow: selectedTimeWindow,
    user, // Pass user data for stable subscription ID
  });

  // Check if user has QUALIFIED_ALPHA role
  if (!user?.roles?.includes(UserRole.QUALIFIED_ALPHA)) {
    return <AccessDenied requiredRole="QUALIFIED_ALPHA" />;
  }

  return (
    <div className="container mx-auto px-4 py-10 space-y-10 bg-background">
      <div className="flex items-center justify-between">
        <AppHeader
          title="Trading Analytics"
          subtitle="Advanced performance insights and market analysis"
        />

        {/* Time Window Selector */}
        <div className="flex items-center gap-4">
          <TimeWindowSelector
            timeWindows={timeWindows}
            selectedWindow={selectedTimeWindow}
            onWindowChange={setSelectedTimeWindow}
            disabled={loading}
          />
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <AnalyticsLoading
          progress={progress}
          message={`Analyzing ${selectedTimeWindow.days} days of ${selectedSymbol.replace('PERP_', '').replace('_USDC', '')} data...`}
        />
      )}

      {/* Error State */}
      {error && !loading && (
        <Card className="p-6 border-red-500/20 bg-red-500/5">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
              <Shield className="w-6 h-6 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-text mb-2">Failed to Load Analytics</h3>
            <p className="text-textMuted mb-4">{error}</p>
            <button
              onClick={() => refetch()}
              className="btn-primary"
            >
              Try Again
            </button>
          </div>
        </Card>
      )}

      {/* Analytics Content */}
      {data && !loading && !error && (
        <div className="container mx-auto px-4 py-8">
          {/* Performance Overview */}
        <div className="mb-8">
          <SectionHeader
            title="Performance Overview"
            subtitle="Comprehensive analysis of your trading performance"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                </div>
                <span className="text-xs text-green-400 font-medium">+{mockAnalytics.performance.totalReturn}%</span>
              </div>
              <h3 className="text-lg font-bold text-text mb-1">
                ${mockAnalytics.performance.totalReturn.toLocaleString()}
              </h3>
              <p className="text-xs text-textMuted">Total Return</p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <Activity className="w-5 h-5 text-blue-400" />
                </div>
                <span className="text-xs text-blue-400 font-medium">{mockAnalytics.performance.winRate}%</span>
              </div>
              <h3 className="text-lg font-bold text-text mb-1">
                {mockAnalytics.performance.winRate}%
              </h3>
              <p className="text-xs text-textMuted">Win Rate</p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-purple-400" />
                </div>
                <span className="text-xs text-purple-400 font-medium">{mockAnalytics.performance.totalTrades}</span>
              </div>
              <h3 className="text-lg font-bold text-text mb-1">
                {mockAnalytics.performance.totalTrades.toLocaleString()}
              </h3>
              <p className="text-xs text-textMuted">Total Trades</p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-orange-500/10 rounded-lg flex items-center justify-center">
                  <Users className="w-5 h-5 text-orange-400" />
                </div>
                <span className="text-xs text-orange-400 font-medium">{mockAnalytics.performance.avgTradeDuration}</span>
              </div>
              <h3 className="text-lg font-bold text-text mb-1">
                {mockAnalytics.performance.avgTradeDuration}
              </h3>
              <p className="text-xs text-textMuted">Avg Trade Duration</p>
            </Card>
          </div>
        </div>

        {/* Risk Analytics */}
        <div className="mb-8">
          <SectionHeader
            title="Risk Analytics"
            subtitle="Risk-adjusted performance and volatility analysis"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Risk Metrics</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Sharpe Ratio</span>
                  <span className="text-sm font-medium text-text">{mockAnalytics.risk.sharpeRatio}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Max Drawdown</span>
                  <span className="text-sm font-medium text-red-400">-{mockAnalytics.risk.maxDrawdown}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Volatility</span>
                  <span className="text-sm font-medium text-text">{mockAnalytics.risk.volatility}%</span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Market Correlation</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Beta</span>
                  <span className="text-sm font-medium text-text">{mockAnalytics.risk.beta}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Alpha</span>
                  <span className="text-sm font-medium text-green-400">+{mockAnalytics.risk.alpha}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Correlation</span>
                  <span className="text-sm font-medium text-text">{mockAnalytics.market.marketCorrelation}</span>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Best/Worst Days</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Best Day</span>
                  <span className="text-sm font-medium text-green-400">{mockAnalytics.performance.bestDay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-textMuted">Worst Day</span>
                  <span className="text-sm font-medium text-red-400">{mockAnalytics.performance.worstDay}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Sector Performance */}
        <div className="mb-8">
          <SectionHeader
            title="Sector Performance"
            subtitle="Performance breakdown by market sector"
          />

          <Card className="p-6">
            <div className="space-y-4">
              {mockAnalytics.market.sectorPerformance.map((sector) => (
                <div key={sector.sector} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <DollarSign className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium text-text">{sector.sector}</h4>
                      <p className="text-xs text-textMuted">{sector.contribution}% of portfolio</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`font-medium ${sector.performance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {sector.performance >= 0 ? '+' : ''}{sector.performance}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Coming Soon Features */}
        <Card className="p-8 text-center border-dashed border-2 border-primary/20 bg-primary/5">
          <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
            <BarChart3 className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold text-text mb-2">
            Advanced Analytics Coming Soon
          </h3>
          <p className="text-textMuted mb-4">
            We're working on even more detailed analytics including:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-surface rounded-lg">
              <div className="font-medium text-text mb-1">Trade Timing Analysis</div>
              <div className="text-textMuted">Optimal entry/exit timing patterns</div>
            </div>
            <div className="p-3 bg-surface rounded-lg">
              <div className="font-medium text-text mb-1">Risk Heatmaps</div>
              <div className="text-textMuted">Visual risk distribution analysis</div>
            </div>
            <div className="p-3 bg-surface rounded-lg">
              <div className="font-medium text-text mb-1">Performance Forecasting</div>
              <div className="text-textMuted">AI-powered performance predictions</div>
            </div>
          </div>
        </Card>
        </div>
      )}
    </div>
  );
};

export default Analytics;
