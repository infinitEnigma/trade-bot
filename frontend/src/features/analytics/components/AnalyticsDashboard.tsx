/** @format */

import React from "react";
import { BarChart3 } from "lucide-react";
import { SectionHeader } from "../../../shared/components/ui";
import { PerformanceMetrics } from "./PerformanceMetrics";
import { RiskMetrics } from "./RiskMetrics";
import { SectorPerformance } from "./SectorPerformance";
import { AnalyticsData } from "../types/analytics.types";

/**
 * Loading skeleton component
 */
const AnalyticsLoading: React.FC<{ progress: number; message: string }> = ({
  progress,
  message
}) => (
  <div className="glass-card p-6 animate-pulse">
    <div className="w-32 h-5 bg-surface rounded mb-4"></div>
    <div className="bg-surface rounded-lg h-[450px] flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 bg-primary/20 rounded-full mx-auto mb-2 animate-spin"></div>
        <p className="text-sm text-textMuted">{message}</p>
        <div className="w-32 h-2 bg-surface rounded-full mt-2 mx-auto">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  </div>
);

/**
 * Coming soon features component
 */
const ComingSoonFeatures: React.FC = () => (
  <div className="glass-card p-8 text-center border-dashed border-2 border-primary/20 bg-primary/5">
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
  </div>
);

interface AnalyticsDashboardProps {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  progress: number;
  symbol: string;
}

/**
 * AnalyticsDashboard component - main analytics display orchestrator
 */
export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  data,
  loading,
  error,
  progress,
  symbol,
}) => {
  if (loading) {
    return (
      <div className="space-y-8">
        <AnalyticsLoading
          progress={progress}
          message={`Analyzing ${symbol.replace('PERP_', '').replace('_USDC', '')} data...`}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 border-red-500/20 bg-red-500/5">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
            <div className="w-6 h-6 bg-red-500 rounded"></div>
          </div>
          <h3 className="text-lg font-semibold text-text mb-2">Failed to Load Analytics</h3>
          <p className="text-textMuted mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="glass-card p-6 border-yellow-500/20 bg-yellow-500/5">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 bg-yellow-500/10 rounded-full flex items-center justify-center">
            <div className="w-6 h-6 bg-yellow-400 rounded"></div>
          </div>
          <h3 className="text-lg font-semibold text-text mb-2">No Analytics Data</h3>
          <p className="text-textMuted mb-4">Unable to load analytics data at this time.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Performance Overview */}
      <div>
        <SectionHeader
          title="Performance Overview"
          subtitle="Comprehensive analysis of your trading performance"
        />
        <PerformanceMetrics metrics={data.metrics} />
      </div>

      {/* Risk Analytics */}
      <div>
        <SectionHeader
          title="Risk Analytics"
          subtitle="Risk-adjusted performance and volatility analysis"
        />
        <RiskMetrics metrics={data.metrics} />
      </div>

      {/* Sector Performance */}
      <div>
        <SectionHeader
          title="Sector Performance"
          subtitle="Performance breakdown by market sector"
        />
        <SectorPerformance sectorPerformance={data.sectorPerformance} />
      </div>

      {/* Coming Soon Features */}
      <ComingSoonFeatures />
    </div>
  );
};
