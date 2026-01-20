/** @format */

import React from "react";
import { Card } from "../../../shared/components/ui";
import { AnalyticsMetrics } from "../types/analytics.types";

interface RiskMetricsProps {
  metrics: AnalyticsMetrics;
}

/**
 * RiskMetrics component - displays risk and volatility metrics
 */
export const RiskMetrics: React.FC<RiskMetricsProps> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text mb-4">Risk Metrics</h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Sharpe Ratio</span>
            <span className="text-sm font-medium text-text">{metrics.sharpeRatio}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Max Drawdown</span>
            <span className="text-sm font-medium text-red-400">-{Math.abs(metrics.maxDrawdown).toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Volatility</span>
            <span className="text-sm font-medium text-text">{metrics.volatility.toFixed(1)}%</span>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text mb-4">Market Correlation</h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Beta</span>
            <span className="text-sm font-medium text-text">{metrics.beta}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Alpha</span>
            <span className="text-sm font-medium text-green-400">+{metrics.alpha}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Correlation</span>
            <span className="text-sm font-medium text-text">{metrics.marketCorrelation}</span>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text mb-4">Best/Worst Days</h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Best Day</span>
            <span className="text-sm font-medium text-green-400">{metrics.bestDay}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-textMuted">Worst Day</span>
            <span className="text-sm font-medium text-red-400">{metrics.worstDay}</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
