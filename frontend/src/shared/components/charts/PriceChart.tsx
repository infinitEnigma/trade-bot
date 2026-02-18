/** @format */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useChartHistorical, useCurrentPrice, useWebSocketPriceUpdates } from "../../hooks/useChartData";
import { Card } from "../ui/Card";
import { SectionHeader } from "../ui/SectionHeader";

interface PriceChartProps {
  symbol?: string;
  resolution?: string;
}

/**
 * Chart point data structure for Recharts
 */
interface ChartPoint {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  price: number;
  ma20?: number; // Optional moving average
}

/**
 * Custom tooltip props from Recharts
 */
interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: ChartPoint;
    value: number;
    dataKey: string;
    name: string;
    stroke: string;
  }>;
  label?: string;
}

// Custom tooltip component for price charts - moved outside to avoid recreation
const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
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

    // Fetch historical chart data using optimized hook with smart polling
    const {
      data: historyResult,
      isLoading,
      error,
    } = useChartHistorical({
      symbol: selectedSymbol,
      interval: selectedResolution,
    });

    // Fetch real-time current price with user-level awareness
    const {
      data: currentPriceData,
      error: priceError,
    } = useCurrentPrice(selectedSymbol);

    // WebSocket real-time mark price updates (faster than polling)
    const { markPriceData } = useWebSocketPriceUpdates({
      symbol: selectedSymbol,
      interval: selectedResolution,
    });

    // Extract candles from the response object - memoized to prevent unnecessary recalculations
    const historyData = useMemo(() => {
      return historyResult?.candles || [];
    }, [historyResult]);

    // Transform TradingView data to Recharts format - memoized for performance
    const chartData = useMemo(() => {
      if (!historyData || historyData.length === 0) {
        return [];
      }

      // historyData is already transformed candle data from useChartHistorical
      const chartPoints: ChartPoint[] = [];
      const prices: number[] = [];

      // Process the candle data directly
      historyData.forEach(candle => {
        const time = new Date(candle.time * 1000);
        const price = candle.close;

        const point: ChartPoint = {
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
          price, // For line chart
        };

        chartPoints.push(point);
        prices.push(price);
      });

      // Calculate MA(20) - ensure we have enough data and calculate for ALL points
      if (prices.length >= 20) {
        for (let i = 0; i < chartPoints.length; i++) {
          if (i >= 19) {
            // Calculate MA(20) for points that have enough historical data
            const sum = prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0);
            const avg = sum / 20;
            chartPoints[i].ma20 = avg;
          } else {
            // For early points, show MA if we have at least some data
            const availableData = Math.min(i + 1, 20);
            const startIndex = Math.max(0, i - 19);
            const sum = prices.slice(startIndex, i + 1).reduce((a, b) => a + b, 0);
            const avg = sum / availableData;
            chartPoints[i].ma20 = avg;
          }
        }
      } else if (prices.length >= 5) {
        // Calculate MA with available data if we have at least 5 points
        for (let i = 0; i < chartPoints.length; i++) {
          const availableData = Math.min(i + 1, prices.length);
          const startIndex = Math.max(0, i - 4); // Simple MA(5) for fewer data points
          const sum = prices.slice(startIndex, i + 1).reduce((a, b) => a + b, 0);
          const avg = sum / availableData;
          chartPoints[i].ma20 = avg;
        }
      }

      // Limit data points to prevent memory accumulation
      const maxDataPoints = 200; // Keep last 200 data points
      return chartPoints.slice(-maxDataPoints);
    }, [historyData]);

    // ─── Live chart data: seeds from historical, then grows with each price tick ───
    const [liveChartData, setLiveChartData] = useState<ChartPoint[]>([]);
    // Track the last timestamp we added so we don't double-insert the same second
    const lastLiveTimestampRef = useRef<number>(0);
    // Separate ref for WebSocket bucket tracking (independent from HTTP polling ref)
    const lastWsTimestampRef = useRef<number>(0);

    // Seed (or re-seed on symbol/resolution change) from historical data
    useEffect(() => {
      if (chartData.length > 0) {
        setLiveChartData(chartData);
        lastLiveTimestampRef.current = chartData[chartData.length - 1].timestamp;
      }
    }, [chartData]);

    // Append a new point every time the polled price updates
    useEffect(() => {
      if (!currentPriceData?.price) return;

      const nowSec = Math.floor(Date.now() / 1000);
      const price = currentPriceData.price;
      const timeLabel = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      setLiveChartData(prev => {
        if (prev.length === 0) return prev; // Wait for historical seed

        const last = prev[prev.length - 1];

        // Same minute-bucket: update the existing point in place (OHLC update)
        if (last.time === timeLabel) {
          const updated: ChartPoint = {
            ...last,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
            close: price,
            price,
          };
          return [...prev.slice(0, -1), updated];
        }

        // New minute: only add if timestamp is strictly newer to avoid duplicates
        if (nowSec <= lastLiveTimestampRef.current) return prev;
        lastLiveTimestampRef.current = nowSec;

        const newPoint: ChartPoint = {
          time: timeLabel,
          timestamp: nowSec,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          price,
        };

        // Keep the MA(20) rolling: compute from last 20 close prices
        const window = prev.slice(-19).map(p => p.price);
        window.push(price);
        newPoint.ma20 = window.reduce((a, b) => a + b, 0) / window.length;

        // Cap at 200 points to match historical limit
        return [...prev, newPoint].slice(-200);
      });
    }, [currentPriceData]);

    // Update chart line from WebSocket mark price in real-time.
    // Uses a 5-second bucket: within the bucket the last point updates in-place (OHLC);
    // every 5 seconds a new point is appended so the line visibly extends to the right.
    const WS_BUCKET_SECONDS = 5;
    useEffect(() => {
      if (!markPriceData?.price || markPriceData.symbol !== selectedSymbol) return;

      const price = markPriceData.price;
      const nowSec = Math.floor(Date.now() / 1000);
      const timeLabel = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      setLiveChartData(prev => {
        if (prev.length === 0) return prev; // Wait for historical seed

        const last = prev[prev.length - 1];
        const secondsSinceLast = nowSec - lastWsTimestampRef.current;

        if (secondsSinceLast < WS_BUCKET_SECONDS) {
          // Within the 5-second bucket: update last point's OHLC in-place
          return [...prev.slice(0, -1), {
            ...last,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
            close: price,
            price,
          }];
        }

        // New 5-second bucket: append a new data point so the line extends
        lastWsTimestampRef.current = nowSec;
        // Keep HTTP polling ref in sync to avoid duplicate points
        lastLiveTimestampRef.current = nowSec;

        const priceWindow = prev.slice(-19).map(p => p.price);
        priceWindow.push(price);

        return [...prev, {
          time: timeLabel,
          timestamp: nowSec,
          open: last.close || price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          price,
          ma20: priceWindow.reduce((a, b) => a + b, 0) / priceWindow.length,
        }].slice(-200);
      });
    }, [markPriceData, selectedSymbol]);
    // ─────────────────────────────────────────────────────────────────────────────

    // Use real-time price data for display, fallback to chart data
    const currentPrice = currentPriceData?.price ||
      (liveChartData.length > 0 ? liveChartData[liveChartData.length - 1].price : null);

    // Calculate price change based on real-time data or chart data
    const priceChange = currentPriceData?.change24h ?
      parseFloat(currentPriceData.change24h.toString()) :
      (chartData.length > 1
        ? chartData[chartData.length - 1].price - chartData[chartData.length - 2].price
        : 0);

    const priceChangePercent = currentPriceData?.change24h && currentPrice !== null ?
      ((priceChange / (currentPrice - priceChange)) * 100) :
      (chartData.length > 1 && currentPrice !== null
        ? (priceChange / chartData[chartData.length - 2].price) * 100
        : 0);

    return (
      <Card className="mb-8">
        <SectionHeader
          title={
            <div className="flex items-center gap-4">
              <span>{`Price Chart - ${selectedSymbol
                .replace("PERP_", "")
                .replace("_USDC", "")}`}</span>
              {currentPrice ? (
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
                  {/* Data source indicator */}
                  {currentPriceData?.source && (
                    <span className="text-xs px-2 py-1 rounded bg-surface text-textMuted">
                      {currentPriceData.source === 'public' ? 'Public' :
                       currentPriceData.source === 'authenticated' ? 'Live' :
                       currentPriceData.source === 'public_fallback' ? 'Fallback' : 'Cached'}
                    </span>
                  )}
                </div>
              ) : priceError ? (
                <div className="text-sm text-danger">
                  Price data unavailable
                </div>
              ) : (
                <div className="text-sm text-textMuted">
                  Loading price...
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

          {!isLoading && !error && liveChartData.length > 0 && (
            <div className="h-[20vh]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveChartData}>
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
                    stroke="var(--primary)"
                    strokeWidth={2.5}
                    dot={false}
                    name="Price"
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ma20"
                    stroke="var(--warning)"
                    strokeWidth={2}
                    strokeDasharray="8 4"
                    dot={false}
                    name="MA(20)"
                    connectNulls={false}
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
