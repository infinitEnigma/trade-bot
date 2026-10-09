/** @format */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth";
import { UserRole } from "../../../shared/types";
import { Card } from "../../../shared/components/ui/Card";
import { SectionHeader } from "../../../shared/components/ui/SectionHeader";
import { TimeWindowSelector } from "../../../shared/components/ui/TimeWindowSelector";
import { AnalyticsLoading } from "../../../shared/components/feedback/AnalyticsLoading";
import { useAnalytics } from "../hooks/useAnalytics";
import { AnalyticsTimeWindow } from "../types/analytics.types";
import { BarChart3, TrendingUp, Lock, Shield, RefreshCw } from "lucide-react";

// Access Denied Component
const AccessDenied: React.FC<{ requiredRole: string }> = ({ requiredRole }) => {
  const navigate = useNavigate();
  return (
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
            Access to detailed trading analytics and performance insights
            requires {requiredRole} qualification.
          </p>
          <div className="space-y-3">
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <Lock className="w-4 h-4" />
                <span className="text-sm font-medium">
                  Alpha Testing Feature
                </span>
              </div>
              <p className="text-xs text-textMuted">
                This feature is part of our private testing program and requires
                wallet qualification.
              </p>
            </div>
            <button
              onClick={() => navigate("/dashboard")}
              className="btn-secondary w-full"
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// F1/HD2: page-level mock deleted — every rendered metric below comes from
// `data.metrics`, which analyticsService computes from real price rows.
// Not rendered (hardcoded in the service, not derivable from real rows here):
// winRate, totalTrades, avgTradeDuration, sharpeRatio, beta, alpha,
// marketCorrelation — and the fake sectorPerformance section is gone (HD2).

const Analytics: React.FC = () => {
  const { user } = useAuth();
  const [selectedSymbol] = useState("PERP_BTC_USDC");
  const [selectedTimeWindow, setSelectedTimeWindow] =
    useState<AnalyticsTimeWindow>({
      label: "30 Days",
      days: 30,
      value: "30d",
    });

  // Load analytics data - moved before conditional to comply with Rules of Hooks
  const { data, loading, error, progress, timeWindows, refetch } = useAnalytics(
    {
      symbol: selectedSymbol,
      timeWindow: selectedTimeWindow,
      user, // Pass user data for stable subscription ID
    }
  );

  // Check if user has QUALIFIED_ALPHA role
  if (!user?.roles?.includes(UserRole.QUALIFIED_ALPHA)) {
    return <AccessDenied requiredRole="QUALIFIED_ALPHA" />;
  }

  return (
    <div className="container mx-auto px-4 py-10 space-y-10 bg-background">
      <div className="flex items-center justify-end">
        {/* H1: no local AppHeader — the global one renders at App.tsx. */}

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
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <AnalyticsLoading
          progress={progress}
          message={`Analyzing ${selectedTimeWindow.days} days of ${selectedSymbol.replace("PERP_", "").replace("_USDC", "")} data...`}
        />
      )}

      {/* Error State */}
      {error && !loading && (
        <Card className="p-6 border-red-500/20 bg-red-500/5">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
              <Shield className="w-6 h-6 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-text mb-2">
              Failed to Load Analytics
            </h3>
            <p className="text-textMuted mb-4">{error}</p>
            <button onClick={() => refetch()} className="btn-primary">
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
              subtitle="Market performance over the selected time window"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-text mb-1">
                  {data.metrics.totalReturn >= 0 ? "+" : ""}
                  {data.metrics.totalReturn.toFixed(1)}%
                </h3>
                <p className="text-xs text-textMuted">Total Return</p>
              </Card>
            </div>
          </div>

          {/* Risk Analytics */}
          <div className="mb-8">
            <SectionHeader
              title="Risk Analytics"
              subtitle="Risk-adjusted performance and volatility analysis"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-text mb-4">
                  Risk Metrics
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-textMuted">Max Drawdown</span>
                    <span className="text-sm font-medium text-red-400">
                      -{data.metrics.maxDrawdown.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-textMuted">Volatility</span>
                    <span className="text-sm font-medium text-text">
                      {data.metrics.volatility.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-semibold text-text mb-4">
                  Best/Worst Days
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-textMuted">Best Day</span>
                    <span className="text-sm font-medium text-green-400">
                      {data.metrics.bestDay}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-textMuted">Worst Day</span>
                    <span className="text-sm font-medium text-red-400">
                      {data.metrics.worstDay}
                    </span>
                  </div>
                </div>
              </Card>
            </div>
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
                <div className="font-medium text-text mb-1">
                  Trade Timing Analysis
                </div>
                <div className="text-textMuted">
                  Optimal entry/exit timing patterns
                </div>
              </div>
              <div className="p-3 bg-surface rounded-lg">
                <div className="font-medium text-text mb-1">Risk Heatmaps</div>
                <div className="text-textMuted">
                  Visual risk distribution analysis
                </div>
              </div>
              <div className="p-3 bg-surface rounded-lg">
                <div className="font-medium text-text mb-1">
                  Performance Forecasting
                </div>
                <div className="text-textMuted">
                  AI-powered performance predictions
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Analytics;
