/** @format */

import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";
import { useChartData } from "../hooks/useChartData";
import { useVisibility } from "../../../shared/hooks/useVisibility";

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CandlestickChartProps {
  symbol: string;
  interval: string;
  height?: number;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  interval,
  height = 400,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);
  const [candleData, setCandleData] = useState<CandleData[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Visibility detection - pause WebSocket when page loses focus
  const isVisible = useVisibility();

  // Get chart data with live updates - only active when page is visible
  const {
    data: chartData,
    loading,
    error: chartError,
  } = useChartData({
    symbol: symbol, // Use full symbol name for WebSocket subscriptions
    interval,
  });

  // Update candle data when chart data changes
  useEffect(() => {
    if (chartData && chartData.length > 0) {
      setCandleData(chartData);
      setError(null);
    } else if (chartError) {
      setError(chartError);
    }
  }, [chartData, chartError]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current || error) return;

    try {
      // Create chart instance with dark theme to match page style
      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#0f0f23" }, // Dark background
          textColor: "#e2e8f0", // Light text
          fontFamily: "system-ui, -apple-system, sans-serif",
        },
        width: containerRef.current.clientWidth,
        height: height,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          borderColor: "#334155", // Dark border
          fixLeftEdge: false,
          fixRightEdge: false,
        },
        rightPriceScale: {
          borderColor: "#334155", // Dark border
          scaleMargins: {
            top: 0.1,
            bottom: 0.25, // Leave space for volume
          },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        grid: {
          vertLines: {
            color: "#1e293b", // Dark grid lines
            style: 1,
          },
          horzLines: {
            color: "#1e293b", // Dark grid lines
            style: 1,
          },
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });

      // Create candlestick series
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#10b981", // Green for bullish
        downColor: "#ef4444", // Red for bearish
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
        priceFormat: {
          type: "price",
          precision: 2,
          minMove: 0.01,
        },
      });

      // Create volume series
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: "#6b7280",
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "volume",
      });

      // Set volume series options
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
      volumeSeriesRef.current = volumeSeries;
      setIsChartReady(true);

      // Handle window resize
      const handleResize = () => {
        if (containerRef.current && chart) {
          chart.applyOptions({
            width: containerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        if (chart) {
          chart.remove();
        }
        setIsChartReady(false);
      };
    } catch (chartError) {
      console.error("Failed to create chart:", chartError);
    }
  }, [height, error]);

  // Update chart data when candleData changes
  useEffect(() => {
    if (
      !isChartReady ||
      !candlestickSeriesRef.current ||
      !volumeSeriesRef.current ||
      candleData.length === 0
    ) {
      return;
    }

    try {
      // Transform data for the chart
      const chartData = candleData.map(item => ({
        time: item.time as any, // Lightweight-charts expects number | string
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      }));

      // Set candlestick data
      candlestickSeriesRef.current.setData(chartData);

      // Set volume data if available
      const volumeData = candleData
        .filter(item => item.volume !== undefined)
        .map(item => ({
          time: item.time as any,
          value: item.volume || 0,
          color: item.close >= item.open ? "#10b981" : "#ef4444", // Green for up, red for down
        }));

      if (volumeData.length > 0) {
        volumeSeriesRef.current.setData(volumeData);
      }

      // Auto-fit the chart to show all data
      if (chartRef.current && chartData.length > 0) {
        chartRef.current.timeScale().fitContent();
      }
    } catch (dataError) {
      console.error("Failed to update chart data:", dataError);
    }
  }, [candleData, isChartReady, isVisible]);

  return (
    <div className="w-full bg-surface rounded-lg shadow-sm border border-white/10">
      <div className="p-4 border-b border-white/10 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-text">
            {symbol.replace("PERP_", "").replace("_USDC", "")}
          </h3>
          <span className="px-2 py-1 text-xs bg-primary/20 text-primary rounded-full">
            {interval}
          </span>
        </div>
        {error && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-danger rounded-full"></div>
            <span className="text-sm text-danger">{error}</span>
          </div>
        )}
        {loading && !error && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
            <span className="text-sm text-textMuted">Loading...</span>
          </div>
        )}
        {!loading && !error && candleData.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-success rounded-full"></div>
            <span className="text-sm text-success">
              Live • {candleData.length} candles
            </span>
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        className="w-full relative"
        style={{ height: `${height}px` }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="w-8 h-8 mx-auto mb-2 animate-spin border-2 border-primary/30 border-t-primary rounded-full"></div>
              <p className="text-sm font-medium text-text">
                Loading chart data...
              </p>
              <p className="text-xs text-textMuted mt-1">
                Fetching historical data
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-2">⚠️</div>
              <p className="text-sm font-medium text-danger">
                Error loading chart
              </p>
              <p className="text-xs text-textMuted mt-2">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && candleData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-2">📡</div>
              <p className="text-sm font-medium text-text">
                Waiting for live data...
              </p>
              <p className="text-xs text-textMuted mt-1">
                WebSocket connected, awaiting ticks
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CandlestickChart;
