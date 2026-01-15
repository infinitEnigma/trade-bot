/** @format */

import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { api } from "../lib/api";
import { Card } from "./ui/Card";
import { SectionHeader } from "./ui/SectionHeader";
import { useVisibility } from "../hooks/useVisibility";
import { useMemoryMonitor } from "../hooks/useMemoryMonitor";

interface PriceChartProps {
  symbol?: string;
  resolution?: string;
}

const PriceChart: React.FC<PriceChartProps> = React.memo(
  ({ symbol = "PERP_BTC_USDC", resolution = "1" }) => {
    const [selectedSymbol, setSelectedSymbol] = useState(symbol);
    const [selectedResolution, setSelectedResolution] = useState(resolution);
    const isVisible = useVisibility();
    useMemoryMonitor(true); // Enable memory monitoring

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

    // Fetch chart data with real-time updates
    const {
      data: historyData,
      isLoading,
      error,
    } = useQuery({
      queryKey: ["tv-history", selectedSymbol, selectedResolution],
      queryFn: () => api.getTvHistory({
        symbol: selectedSymbol,
        resolution: selectedResolution,
        from: Math.floor(Date.now() / 1000) - 86400, // 24 hours ago
        to: Math.floor(Date.now() / 1000),
      }),
      refetchInterval: isVisible ? 30000 : false, // Refresh every 30 seconds when visible
      enabled: isVisible, // Don't fetch when hidden
      staleTime: 60000, // Consider data fresh for 60 seconds
      gcTime: 600000, // Keep in cache for 10 minutes
    });

    // Transform TradingView data to Recharts format
    const transformData = (data: any) => {
      if (!data?.success || !data.data) {
        return [];
      }

      const {
        t: timestamps,
        o: opens,
        h: highs,
        l: lows,
        c: closes,
        v: volumes,
      } = data.data;

      // Validate required arrays exist and are not empty
      if (!timestamps || !opens || !highs || !lows || !closes ||
          !Array.isArray(timestamps) || timestamps.length === 0) {
        return [];
      }

      const chartData = [];
      const prices: number[] = [];

      // Process data points
      for (let i = 0; i < timestamps.length; i++) {
        const time = new Date(timestamps[i] * 1000);
        const open = opens[i];
        const high = highs[i];
        const low = lows[i];
        const close = closes[i];
        const volume = volumes?.[i] || 0;

        // Validate data types
        if (typeof open !== 'number' || typeof high !== 'number' ||
            typeof low !== 'number' || typeof close !== 'number') {
          continue;
        }

        chartData.push({
          time: time.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          timestamp: timestamps[i],
          open,
          high,
          low,
          close,
          volume,
          price: close, // For line chart
        });

        prices.push(close);
      }

      // Calculate MA(20) - only if we have enough data
      if (prices.length >= 20) {
        for (let i = 19; i < chartData.length; i++) {
          const sum = prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0);
          const avg = sum / 20;
          (chartData[i] as any).ma20 = avg;
        }
      }

      return chartData;
    };

    const rawChartData = historyData ? transformData(historyData) : [];
    // Limit data points to prevent memory accumulation
    const maxDataPoints = 200; // Keep last 200 data points
    const chartData = rawChartData.slice(-maxDataPoints);

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
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="px-3 py-1 text-sm bg-surface border border-white/10 rounded-lg"
              >
                {symbols.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym.replace("PERP_", "").replace("_USDC", "")}
                  </option>
                ))}
              </select>

              {/* Timeframe selector */}
              <div className="flex gap-1">
                {timeframes.map((tf) => (
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
            <div className="space-y-4">
              {/* Price Chart */}
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.1)"
                    />
                    <XAxis
                      dataKey="time"
                      stroke="#94a3b8"
                      fontSize={12}
                      tick={{ fill: "#94a3b8" }}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      fontSize={12}
                      tick={{ fill: "#94a3b8" }}
                      domain={["dataMin - 0.1", "dataMax + 0.1"]}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      name="Price"
                    />
                    <Line
                      type="monotone"
                      dataKey="ma20"
                      stroke="#f59e0b"
                      strokeWidth={1}
                      strokeDasharray="5 5"
                      dot={false}
                      name="MA(20)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Volume Chart */}
              <div className="h-[100px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.1)"
                    />
                    <XAxis
                      dataKey="time"
                      stroke="#94a3b8"
                      fontSize={12}
                      tick={{ fill: "#94a3b8" }}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      fontSize={12}
                      tick={{ fill: "#94a3b8" }}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="glass-card p-2 border border-white/10">
                              <p className="text-sm">{`Time: ${label}`}</p>
                              <p className="text-sm text-info">{`Volume: ${data.volume?.toLocaleString()}`}</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar
                      dataKey="volume"
                      fill="#3b82f6"
                      opacity={0.6}
                      name="Volume"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {!isLoading && !error && chartData.length === 0 && (
            <div className="h-[400px] flex items-center justify-center">
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
