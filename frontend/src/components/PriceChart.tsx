/** @format */

import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useChartHistorical } from "../shared/hooks/useChartData";
import { Card } from "../shared/components/ui/Card";
import { SectionHeader } from "../shared/components/ui/SectionHeader";

interface PriceChartProps {
  symbol?: string;
  resolution?: string;
}

const PriceChart: React.FC<PriceChartProps> = React.memo(
  ({ symbol = "PERP_BTC_USDC", resolution = "1" }) => {
    const [selectedSymbol, setSelectedSymbol] = useState(symbol);
    const [selectedResolution, setSelectedResolution] = useState(resolution);

    // Cleanup on unmount to prevent memory leaks
    useEffect(() => {
      return () => {
        // Clear any potential references
        if (window.gc && typeof window.gc === "function") {
          window.gc();
        }
      };
    }, []);

    // Timeframes for selector
    const timeframes = [
      { label: "1m", value: "1" },
      { label: "5m", value: "5" },
      { label: "15m", value: "15" },
      { label: "1H", value: "60" },
      { label: "4H", value: "240" },
      { label: "1D", value: "D" },
    ];

    // Popular symbols
    const symbols = [
      "PERP_BTC_USDC",
      "PERP_ETH_USDC",
      "PERP_SOL_USDC",
      "PERP_AVAX_USDC",
      "PERP_NEAR_USDC",
    ];

    // Fetch historical chart data using optimized hook (1x/minute)
    const {
      data: historyData,
      isLoading,
      error,
    } = useChartHistorical({
      symbol: selectedSymbol,
      interval: selectedResolution,
    });

    // Transform TradingView data to Recharts format - memoized for performance
    const chartData = useMemo(() => {
      if (!historyData || historyData.length === 0) {
        return [];
      }

      // historyData is already transformed candle data from useChartHistorical
      const chartPoints: any[] = [];
      const prices: number[] = [];

      // Process the candle data directly
      historyData.forEach(candle => {
        const time = new Date(candle.time * 1000);
        const price = candle.close;

        chartPoints.push({
          time: time.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          timestamp: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume || 0,
          price: price, // For line chart
        });

        prices.push(price);
      });

      // Calculate MA(20) - only if we have enough data
      if (prices.length >= 20) {
        for (let i = 19; i < chartPoints.length; i++) {
          const sum = prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0);
          const avg = sum / 20;
          (chartPoints[i] as any).ma20 = avg;
        }
      }

      // Limit data points to prevent memory accumulation
      const maxDataPoints = 200; // Keep last 200 data points
      return chartPoints.slice(-maxDataPoints);
    }, [historyData]);

    // Get current price (latest close price)
    const currentPrice =
      chartData.length > 0 ? chartData[chartData.length - 1].price : null;
    const priceChange =
      chartData.length > 1
        ? chartData[chartData.length - 1].price -
          chartData[chartData.length - 2].price
        : 0;
    const priceChangePercent =
      chartData.length > 1
        ? (priceChange / chartData[chartData.length - 2].price) * 100
        : 0;

    // Custom tooltip for price data
    const CustomTooltip = ({ active, payload, label }: any) => {
      if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
          <div className="glass-card p-3 border border-white/10">
            <p className="text-sm font-medium">{`Time: ${label}`}</p>
            <p className="text-sm text-success">{`Open: $${data.open?.toFixed(
              2
            )}`}</p>
            <p className="text-sm text-primary">{`High: $${data.high?.toFixed(
              2
            )}`}</p>
            <p className="text-sm text-danger">{`Low: $${data.low?.toFixed(
              2
            )}`}</p>
            <p className="text-sm text-text">{`Close: $${data.close?.toFixed(
              2
            )}`}</p>
            {data.ma20 && (
              <p className="text-sm text-warning">{`MA(20): $${data.ma20?.toFixed(
                2
              )}`}</p>
            )}
            <p className="text-sm text-info">{`Volume: ${data.volume?.toLocaleString()}`}</p>
          </div>
        );
      }
      return null;
    };

    return (
      <Card className="mb-8">
        <SectionHeader
          title={
            <div className="flex items-center gap-4">
              <span>{`Price Chart - ${selectedSymbol
                .replace("PERP_", "")
                .replace("_USDC", "")}`}</span>
              {currentPrice && (
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-text-primary">
                    ${currentPrice.toFixed(2)}
                  </span>
                  {priceChange !== 0 && (
                    <span
                      className={`text-sm font-medium ${
                        priceChange >= 0 ? "text-success" : "text-danger"
                      }`}
                    >
                      {priceChange >= 0 ? "+" : ""}
                      {priceChange.toFixed(2)} (
                      {priceChangePercent >= 0 ? "+" : ""}
                      {priceChangePercent.toFixed(2)}%)
                    </span>
                  )}
                </div>
              )}
            </div>
          }
          subtitle="Real-time price chart with volume and MA(20)"
          actions={
            <div className="flex items-center gap-3">
              {/* Symbol selector */}
              <select
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value)}
                className="px-3 py-1 text-sm bg-surface border border-white/10 rounded-lg"
              >
                {symbols.map(sym => (
                  <option key={sym} value={sym}>
                    {sym.replace("PERP_", "").replace("_USDC", "")}
                  </option>
                ))}
              </select>

              {/* Timeframe selector */}
              <div className="flex gap-1">
                {timeframes.map(tf => (
                  <button
                    key={tf.value}
                    onClick={() => setSelectedResolution(tf.value)}
                    className={`px-2 py-1 text-xs rounded ${
                      selectedResolution === tf.value
                        ? "bg-primary text-white"
                        : "bg-surface text-textMuted hover:bg-white/5"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 rounded-lg">
              <div className="text-textMuted">Loading chart data...</div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 rounded-lg">
              <div className="text-danger">Failed to load chart data</div>
            </div>
          )}

          {!isLoading && !error && chartData.length > 0 && (
            <div className="h-[20vh]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-light)"
                  />
                  <XAxis
                    dataKey="time"
                    stroke="var(--text-secondary)"
                    fontSize={12}
                    tick={{ fill: "var(--text-secondary)" }}
                  />
                  <YAxis
                    stroke="var(--text-secondary)"
                    fontSize={12}
                    tick={{ fill: "var(--text-secondary)" }}
                    domain={["dataMin - 0.1", "dataMax + 0.1"]}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="var(--secondary)"
                    strokeWidth={2}
                    dot={false}
                    name="Price"
                  />
                  <Line
                    type="monotone"
                    dataKey="ma20"
                    stroke="var(--warning)"
                    strokeWidth={1}
                    strokeDasharray="5 5"
                    dot={false}
                    name="MA(20)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!isLoading && !error && chartData.length === 0 && (
            <div className="h-[20vh] flex items-center justify-center">
              <div className="text-textMuted">No chart data available</div>
            </div>
          )}
        </div>
      </Card>
    );
  }
);

PriceChart.displayName = "PriceChart";

export default PriceChart;
