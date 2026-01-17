/** @format */

import React from "react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

interface PortfolioChartProps {
  data: Array<{ time: string; value: number }>;
  selectedSymbol: string;
  onSymbolChange: (symbol: string) => void;
}

const PortfolioChart: React.FC<PortfolioChartProps> = React.memo(
  ({ data, selectedSymbol, onSymbolChange }) => {
    return (
      <div className="h-80">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text">
            Portfolio Performance
          </h2>
          <div className="flex items-center gap-2">
            {["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"].map(symbol => (
              <button
                key={symbol}
                onClick={() => onSymbolChange(symbol)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectedSymbol === symbol
                    ? "bg-primary text-white"
                    : "text-textMuted hover:text-text hover:bg-white/5"
                }`}
              >
                {symbol.replace("PERP_", "").replace("_USDC", "")}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
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
              tickFormatter={(value: number) => `$${value.toLocaleString()}`}
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
    );
  }
);

PortfolioChart.displayName = "PortfolioChart";

export default PortfolioChart;
