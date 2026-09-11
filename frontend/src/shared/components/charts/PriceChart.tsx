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
  time: string;       // HH:MM label for tooltip / display
  timestamp: number;  // Unix seconds — used as the X-axis dataKey so the line moves smoothly
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  price: number;
  ma20?: number;
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
  label?: string | number;
}

// Custom tooltip component — lives outside PriceChart to avoid recreation on every render
const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="glass-card p-3 border border-white/10">
        <p className="text-sm font-medium">{`Time: ${data.time}`}</p>
        <p className="text-sm text-success">{`Open: $${data.open?.toFixed(2)}`}</p>
        <p className="text-sm text-primary">{`High: $${data.high?.toFixed(2)}`}</p>
        <p className="text-sm text-danger">{`Low: $${data.low?.toFixed(2)}`}</p>
        <p className="text-sm text-text">{`Close: $${data.close?.toFixed(2)}`}</p>
        {data.ma20 !== undefined && (
          <p className="text-sm text-warning">{`MA(20): $${data.ma20?.toFixed(2)}`}</p>
        )}
        <p className="text-sm text-info">{`Volume: ${data.volume?.toLocaleString()}`}</p>
      </div>
    );
  }
  return null;
};

// ------------------------------------------------------------------
// Timeframe definitions
// value = the resolution string passed to the API (TradingView format)
// ------------------------------------------------------------------
const TIMEFRAMES = [
  { label: "1m",  value: "1"   },
  { label: "5m",  value: "5"   },
  { label: "15m", value: "15"  },
  { label: "1H",  value: "60"  },
  { label: "4H",  value: "240" },
  { label: "1D",  value: "D"   },
] as const;

// Supported symbols
const SYMBOLS = [
  "PERP_BTC_USDC",
  "PERP_ETH_USDC",
  "PERP_SOL_USDC",
  "PERP_AVAX_USDC",
  "PERP_NEAR_USDC",
];

/** Format a Unix-seconds timestamp into HH:MM for axis ticks */
const fmtTime = (ts: number): string =>
  new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Format a price value to always show exactly 2 decimal places */
const fmtPrice = (value: number | string): string =>
  `$${Number(value).toFixed(2)}`;

const PriceChart: React.FC<PriceChartProps> = React.memo(
  ({ symbol = "PERP_BTC_USDC", resolution = "1" }) => {
    const [selectedSymbol, setSelectedSymbol] = useState(symbol);
    const [selectedResolution, setSelectedResolution] = useState(resolution);

    // Cleanup on unmount to prevent memory leaks
    useEffect(() => {
      return () => {
        if (window.gc && typeof window.gc === "function") {
          window.gc();
        }
      };
    }, []);

    // ── Historical data ──────────────────────────────────────────────────────
    const {
      data: historyResult,
      isLoading,
      error,
    } = useChartHistorical({
      symbol: selectedSymbol,
      // Pass the raw TradingView resolution directly — useChartHistorical already
      // uses getResolution() internally for values like "1m", but here we supply the
      // native format ("1", "5", "60", "D") that the hook's switch falls through to,
      // which defaults to "60".  We pass the value straight through so the hook picks
      // the right resolution without an extra remapping layer.
      interval: selectedResolution,
    });

    // ── Current price (polled) ───────────────────────────────────────────────
    const {
      data: currentPriceData,
      error: priceError,
    } = useCurrentPrice(selectedSymbol);

    // ── WebSocket real-time mark price ───────────────────────────────────────
    const { markPriceData } = useWebSocketPriceUpdates({
      symbol: selectedSymbol,
      interval: selectedResolution,
    });

    // Extract candle array from the response
    const historyData = useMemo(
      () => historyResult?.candles || [],
      [historyResult],
    );

    // Transform historical candles to ChartPoint format with MA(20)
    const chartData = useMemo<ChartPoint[]>(() => {
      if (!historyData || historyData.length === 0) return [];

      const prices: number[] = [];
      const points: ChartPoint[] = historyData.map(candle => {
        const price = candle.close;
        prices.push(price);
        return {
          time:      fmtTime(candle.time),
          timestamp: candle.time,
          open:   candle.open,
          high:   candle.high,
          low:    candle.low,
          close:  candle.close,
          volume: candle.volume || 0,
          price,
        };
      });

      // Rolling MA(20)
      for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - 19);
        const slice = prices.slice(start, i + 1);
        points[i].ma20 = slice.reduce((a, b) => a + b, 0) / slice.length;
      }

      return points.slice(-200);
    }, [historyData]);

    // ── Live chart data: seeded from history, then extended by price ticks ───
    const [liveChartData, setLiveChartData] = useState<ChartPoint[]>([]);
    const lastLiveTimestampRef = useRef<number>(0);
    const lastWsTimestampRef   = useRef<number>(0);

    // Re-seed whenever symbol / resolution / historical data changes
    useEffect(() => {
      if (chartData.length > 0) {
        setLiveChartData(chartData);
        lastLiveTimestampRef.current = chartData[chartData.length - 1].timestamp;
        lastWsTimestampRef.current   = chartData[chartData.length - 1].timestamp;
      }
    }, [chartData]);

    // HTTP-polled price update ─ updates the current minute's bucket
    useEffect(() => {
      if (!currentPriceData?.price) return;

      const nowSec   = Math.floor(Date.now() / 1000);
      const price    = currentPriceData.price;
      const timeLabel = fmtTime(nowSec);

      setLiveChartData(prev => {
        if (prev.length === 0) return prev;

        const last = prev[prev.length - 1];

        // Same minute-bucket: update last point in place
        if (last.time === timeLabel) {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              high:  Math.max(last.high, price),
              low:   Math.min(last.low,  price),
              close: price,
              price,
            },
          ];
        }

        // New minute — guard against duplicates
        if (nowSec <= lastLiveTimestampRef.current) return prev;
        lastLiveTimestampRef.current = nowSec;

        const window = prev.slice(-19).map(p => p.price);
        window.push(price);

        const newPoint: ChartPoint = {
          time:      timeLabel,
          timestamp: nowSec,
          open:   price,
          high:   price,
          low:    price,
          close:  price,
          volume: 0,
          price,
          ma20: window.reduce((a, b) => a + b, 0) / window.length,
        };

        return [...prev, newPoint].slice(-200);
      });
    }, [currentPriceData]);

    // WebSocket mark-price update ─ uses a 5-second sub-bucket so the line
    // visibly extends to the right every 5 s while tracking price in real time.
    const WS_BUCKET_SECONDS = 5;
    useEffect(() => {
      if (!markPriceData?.price || markPriceData.symbol !== selectedSymbol) return;

      const price  = markPriceData.price;
      const nowSec = Math.floor(Date.now() / 1000);

      setLiveChartData(prev => {
        if (prev.length === 0) return prev;

        const last              = prev[prev.length - 1];
        const secondsSinceLast  = nowSec - lastWsTimestampRef.current;

        if (secondsSinceLast < WS_BUCKET_SECONDS) {
          // Within bucket: update last point in-place — line moves on Y axis
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              high:  Math.max(last.high, price),
              low:   Math.min(last.low,  price),
              close: price,
              price,
              // Keep the same timestamp so the X position is stable within bucket
              timestamp: last.timestamp,
            },
          ];
        }

        // New 5-second bucket: append a point so the line extends on X axis
        lastWsTimestampRef.current  = nowSec;
        lastLiveTimestampRef.current = nowSec;

        const priceWindow = prev.slice(-19).map(p => p.price);
        priceWindow.push(price);

        return [
          ...prev,
          {
            time:      fmtTime(nowSec),
            timestamp: nowSec,
            open:   last.close || price,
            high:   price,
            low:    price,
            close:  price,
            volume: 0,
            price,
            ma20: priceWindow.reduce((a, b) => a + b, 0) / priceWindow.length,
          },
        ].slice(-200);
      });
    }, [markPriceData, selectedSymbol]);
    // ─────────────────────────────────────────────────────────────────────────

    // Current price for the header display
    const currentPrice =
      currentPriceData?.price ??
      (liveChartData.length > 0 ? liveChartData[liveChartData.length - 1].price : null);

    const priceChange =
      currentPriceData?.change24h != null
        ? parseFloat(String(currentPriceData.change24h))
        : chartData.length > 1
        ? chartData[chartData.length - 1].price - chartData[chartData.length - 2].price
        : 0;

    const priceChangePercent =
      currentPriceData?.change24h != null && currentPrice !== null
        ? (priceChange / (currentPrice - priceChange)) * 100
        : chartData.length > 1 && currentPrice !== null
        ? (priceChange / chartData[chartData.length - 2].price) * 100
        : 0;

    // ── X-axis tick formatter: show HH:MM from raw timestamp ────────────────
    const xTickFormatter = (ts: number): string => fmtTime(ts);

    // Reduce X-axis tick density based on how many points we have
    const xTickCount = Math.min(8, Math.max(2, Math.floor(liveChartData.length / 10)));

    return (
      <Card className="mb-8">
        <SectionHeader
          title={
            <div className="flex items-center gap-4">
              <span>{`Price Chart — ${selectedSymbol
                .replace("PERP_", "")
                .replace("_USDC", "")}`}</span>
              {currentPrice != null ? (
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
                      {priceChange.toFixed(2)} ({priceChangePercent >= 0 ? "+" : ""}
                      {priceChangePercent.toFixed(2)}%)
                    </span>
                  )}
                  {currentPriceData?.source && (
                    <span className="text-xs px-2 py-1 rounded bg-surface text-textMuted">
                      {currentPriceData.source === "public"
                        ? "Public"
                        : currentPriceData.source === "authenticated"
                        ? "Live"
                        : currentPriceData.source === "public_fallback"
                        ? "Fallback"
                        : "Cached"}
                    </span>
                  )}
                </div>
              ) : priceError ? (
                <div className="text-sm text-danger">Price data unavailable</div>
              ) : (
                <div className="text-sm text-textMuted">Loading price…</div>
              )}
            </div>
          }
          subtitle="Real-time price chart with MA(20)"
          actions={
            <div className="flex items-center gap-3">
              {/* Symbol selector */}
              <select
                value={selectedSymbol}
                onChange={e => {
                  setSelectedSymbol(e.target.value);
                  // Reset live data so the seeding effect fires cleanly
                  setLiveChartData([]);
                  lastLiveTimestampRef.current = 0;
                  lastWsTimestampRef.current   = 0;
                }}
                className="px-3 py-1 text-sm bg-surface border border-white/10 rounded-lg"
              >
                {SYMBOLS.map(sym => (
                  <option key={sym} value={sym}>
                    {sym.replace("PERP_", "").replace("_USDC", "")}
                  </option>
                ))}
              </select>

              {/* Timeframe selector */}
              <div className="flex gap-1">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf.value}
                    onClick={() => {
                      setSelectedResolution(tf.value);
                      setLiveChartData([]);
                      lastLiveTimestampRef.current = 0;
                      lastWsTimestampRef.current   = 0;
                    }}
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
              <div className="text-textMuted">Loading chart data…</div>
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

                  {/*
                   * X-axis: keyed on numeric `timestamp` (Unix seconds).
                   * This lets Recharts plot each 5-second WS bucket at its own
                   * X position so the line visibly moves rightward with every
                   * price update, rather than waiting for the minute to change.
                   */}
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickCount={xTickCount}
                    tickFormatter={xTickFormatter}
                    stroke="var(--text-secondary)"
                    fontSize={12}
                    tick={{ fill: "var(--text-secondary)" }}
                  />

                  {/*
                   * Y-axis: always shows exactly 2 decimal places with a $ prefix.
                   * A small 10-unit pad is added to domain so the line has breathing
                   * room above/below the visible extremes.
                   */}
                  <YAxis
                    stroke="var(--text-secondary)"
                    fontSize={12}
                    tick={{ fill: "var(--text-secondary)" }}
                    domain={[
                      (dataMin: number) => Math.floor((dataMin - 10) * 100) / 100,
                      (dataMax: number) => Math.ceil((dataMax + 10) * 100) / 100,
                    ]}
                    tickFormatter={fmtPrice}
                    width={80}
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
                    isAnimationActive={false}
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
                    isAnimationActive={false}
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
