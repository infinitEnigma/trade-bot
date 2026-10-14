/** @format */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";

export interface PerformanceData {
  time: string;
  value: number;
}

interface RealizedPnlChartProps {
  data: PerformanceData[];
}

/**
 * Realized-PnL chart (cumulative, from closed trades).
 *
 * P0: fed by the venue's own trade_pnl LEVEL series (hourly buckets) via
 * `portfolio-venue-pnl` — the same source as the realized card. The old
 * per-trade accumulation from fill rows was flat on Lighter (every row
 * carries realized_pnl "0" by construction); Kodiak keeps that path via
 * `calculatePortfolioPerformance` on real rows.
 */
export const RealizedPnlChart = ({ data }: RealizedPnlChartProps) => {
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
          <p className="text-textMuted">No realized-PnL data</p>
          <p className="text-xs text-textMuted mt-2">
            Closed trades will build the cumulative realized-PnL curve here (not
            account equity).
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
                      <p className="text-sm font-medium">{point.time}</p>
                      <p className="text-sm text-primary">
                        Cum. realized PnL: $
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
              name="Cumulative realized PnL"
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
