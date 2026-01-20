/** @format */

import React from "react";
import { TrendingUp, Activity, BarChart3, Users } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { AnalyticsMetrics } from "../types/analytics.types";

interface PerformanceMetricsProps {
  metrics: AnalyticsMetrics;
}

/**
 * PerformanceMetrics component - displays key performance indicators
 */
export const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({ metrics }) => {
  const cards = [
    {
      title: "Total Return",
      value: `${metrics.totalReturn.toFixed(1)}%`,
      icon: TrendingUp,
      color: "success" as const,
    },
    {
      title: "Win Rate",
      value: `${metrics.winRate}%`,
      icon: Activity,
      color: "primary" as const,
    },
    {
      title: "Total Trades",
      value: metrics.totalTrades.toLocaleString(),
      icon: BarChart3,
      color: "info" as const,
    },
    {
      title: "Avg Trade Duration",
      value: metrics.avgTradeDuration,
      icon: Users,
      color: "warning" as const,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card) => (
        <Card key={card.title} className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className={`w-10 h-10 rounded-lg bg-${card.color}/10 flex items-center justify-center`}>
              <card.icon className={`w-5 h-5 text-${card.color}`} />
            </div>
            <span className="text-xs text-textMuted">{card.title}</span>
          </div>
          <div className="text-2xl font-bold text-text mb-1">
            {card.value}
          </div>
          <p className="text-xs text-textMuted">
            {card.title.toLowerCase()}
          </p>
        </Card>
      ))}
    </div>
  );
};
