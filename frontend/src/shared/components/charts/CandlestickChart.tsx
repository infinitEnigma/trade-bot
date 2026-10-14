/** @format */

import React, { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  ISeriesMarkersPluginApi,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  SeriesMarker,
  Time,
} from "lightweight-charts";
import { useChartData, ChartVenue } from "../../hooks/useChartData";
import { useVisibility } from "../../hooks/useVisibility";
import type { OpenOrderRow } from "../../../infrastructure/api/market";
import { derivePriceFormat } from "./derivePriceFormat";

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Phase 3: shared colour for an order's price level + placement marker. */
const ORDER_SIDE_COLOR = {
  BUY: "#10b981",
  SELL: "#ef4444",
} as const;

/**
 * Compare an order row's symbol against the charted `symbol`. Backend order
 * rows always carry the `PERP_*_USDC` display form (both venues normalise —
 * see backend `open-orders.ts`), while the chart dropdown can select the
 * Lighter bare form (`BTC`), so normalise before comparing.
 */
const toDisplaySymbol = (raw: string): string => {
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return "";
  return symbol.includes("_") ? symbol : `PERP_${symbol}_USDC`;
};

interface CandlestickChartProps {
  symbol: string;
  interval: string;
  height?: number;
  /** X3: venue whose candles to chart (absent → Kodiak/Orderly default). */
  venue?: ChartVenue;
  /**
   * Phase 3: the open-orders book for the charted market — each priced order
   * draws a dashed side-coloured limit level (labelled side + size on the
   * price axis) and each order with a creation timestamp draws a placement
   * marker at that time. Rows for other symbols are ignored defensively
   * (`toDisplaySymbol`), so callers may pass an unfiltered account book.
   */
  orders?: OpenOrderRow[];
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  interval,
  height = 400,
  venue,
  orders,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // Phase 3: the v5 markers plugin holding the order-placement arrows (the
  // price lines live only inside the orders effect below — its cleanup owns
  // their removal via the effect closure).
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const isChartReady = useRef(false);

  // Visibility detection - pause WebSocket when page loses focus
  const isVisible = useVisibility();

  // Get chart data with live updates - only active when page is visible
  const {
    data: chartData,
    loading,
    error: chartError,
    markPriceData,
    connectionStatus,
  } = useChartData({
    symbol,
    interval,
    venue,
  });

  // Phase 3.1 (review P1-2): the series' price format follows what is
  // actually on screen — the finest decimal digit across candles AND order
  // levels, bounded [2, 8] (see derivePriceFormat). The ref feeds the
  // creation effect without widening its deps; later changes re-apply via
  // the dedicated effect below.
  const priceFormat = useMemo(
    () =>
      derivePriceFormat([
        ...(chartData?.map(candle => candle.close) ?? []),
        ...(orders?.map(order => order.price) ?? []),
      ]),
    [chartData, orders]
  );
  const priceFormatRef = useRef(priceFormat);
  // Effect (not render) so the react-hooks/refs rule holds; declared BEFORE
  // the creation effect so mount order still feeds the first creation the
  // current format. Later changes never recreate the chart (see below).
  useEffect(() => {
    priceFormatRef.current = priceFormat;
  }, [priceFormat]);

  // Debug logging for chart data
  useEffect(() => {
    console.log(`📈 CandlestickChart [${symbol}] data update:`, {
      dataLength: chartData?.length || 0,
      loading,
      chartError,
      connectionStatus,
      isVisible,
      hasMarkPrice: !!markPriceData,
    });
  }, [
    chartData,
    loading,
    chartError,
    connectionStatus,
    isVisible,
    markPriceData,
    symbol,
  ]);

  // Initialize chart.
  //
  // F4: the deps are `[height]` ONLY — deliberately NOT `chartError`. The
  // historical poll flaps `null → message → null` on every retry/failure
  // (`useChartData` surfaces `historicalQuery.error?.message`, retry 2 +
  // a dynamic refetchInterval), and every flap used to run this effect's
  // cleanup (`chart.remove()`) and then bail out of the body — a
  // dispose/recreate churn that (a) blanked the pane mid-refetch-storm and
  // (b) was the disposal trigger for the crash below: the orders effect's
  // cleanup still held the PREVIOUS chart's markers plugin and called
  // `setMarkers([])` on it after `remove()`, which schedules a
  // requestAnimationFrame inside lightweight-charts that throws on the
  // already-disposed canvases — asynchronously, outside any try/catch.
  // Error, loading and empty are already rendered as overlays over the
  // canvas (see the JSX below), so a data error never needs the chart
  // recreated; it is created once per mount and only rebuilt when `height`
  // actually changes.
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      // Create chart instance with dark theme to match page style
      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#0f0f23" }, // Dark background
          textColor: "#e2e8f0", // Light text
          fontFamily: "system-ui, -apple-system, sans-serif",
        },
        width: containerRef.current.clientWidth,
        height,
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
          ...priceFormatRef.current,
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
      // Phase 3: markers are a lightweight-charts v5 series plugin — created
      // once per chart so the order effect below only swaps the marker list.
      markersPluginRef.current = createSeriesMarkers(candlestickSeries, []);
      isChartReady.current = true;

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
        // Drop the plugin ref BEFORE the chart dies so a later orders-effect
        // run never calls into a destroyed plugin.
        markersPluginRef.current = null;
        if (chart) {
          chart.remove();
        }
        // F4: every handle the other effects read must die WITH the chart.
        // Leaving `chartRef`/`candlestickSeriesRef`/`volumeSeriesRef`
        // pointing at a removed chart is how a stale price line or a
        // `setMarkers` got issued against disposed canvases.
        chartRef.current = null;
        candlestickSeriesRef.current = null;
        volumeSeriesRef.current = null;
        isChartReady.current = false;
      };
    } catch (chartError) {
      console.error("Failed to create chart:", chartError);
    }
  }, [height]);

  // Phase 3.1 (review P1-2): re-apply the derived format when the visible
  // precision changes (candles / order book arriving) WITHOUT recreating the
  // chart — a recreation would blank the series until data re-arrives and
  // would reset the operator's zoom.
  useEffect(() => {
    candlestickSeriesRef.current?.applyOptions({
      priceFormat: {
        type: "price",
        precision: priceFormat.precision,
        minMove: priceFormat.minMove,
      },
    });
  }, [priceFormat]);

  // Update chart data when historical/kline data changes (full redraw)
  useEffect(() => {
    if (
      !isChartReady.current ||
      !candlestickSeriesRef.current ||
      !volumeSeriesRef.current ||
      !chartData ||
      chartData.length === 0
    ) {
      return;
    }

    try {
      // Transform data for the chart
      const chartDataForDisplay = chartData.map(item => ({
        time: item.time as Time,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      }));

      // Full redraw — only triggered on historical data changes (not every price tick)
      candlestickSeriesRef.current.setData(chartDataForDisplay);

      // Set volume data if available
      const volumeData = chartData
        .filter(item => item.volume !== undefined)
        .map(item => ({
          time: item.time as Time,
          value: item.volume || 0,
          color: item.close >= item.open ? "#10b981" : "#ef4444",
        }));

      if (volumeData.length > 0) {
        volumeSeriesRef.current.setData(volumeData);
      }

      // Auto-fit the chart to show all data
      if (chartRef.current && chartDataForDisplay.length > 0) {
        chartRef.current.timeScale().fitContent();
      }
    } catch (dataError) {
      console.error("Failed to update chart data:", dataError);
    }
  }, [chartData, isChartReady, isVisible]);

  // Live candle update from WebSocket mark price — uses series.update() (single candle,
  // no full redraw) so the current candle's close/high/low tracks price in real-time.
  useEffect(() => {
    if (
      !isChartReady.current ||
      !candlestickSeriesRef.current ||
      !markPriceData ||
      !chartData ||
      chartData.length === 0
    ) {
      return;
    }

    const price = markPriceData.price;
    const lastCandle = chartData[chartData.length - 1];

    try {
      candlestickSeriesRef.current.update({
        time: lastCandle.time as Time,
        open: lastCandle.open,
        high: Math.max(lastCandle.high, price),
        low: Math.min(lastCandle.low, price),
        close: price,
      });
    } catch {
      // Silently ignore update errors (e.g. chart not yet fully ready)
    }
    // `chartData` is read above (last candle), so it is a genuine dependency:
    // a redraw must re-apply the current mark price to the newest candle.
  }, [chartData, markPriceData]);

  // Phase 3: draw the open-orders book for this market. Redraws whenever the
  // order set, the loaded candles (they gate marker placement) or the symbol
  // change; cleanup removes the lines it created and empties the markers so a
  // scope/symbol switch never leaves stale levels on the pane — but only
  // while the chart this run drew with is still the mounted one (see the
  // F4 note in that cleanup).
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    const markersPlugin = markersPluginRef.current;
    if (!isChartReady.current || !series || !markersPlugin) return;

    // Lines created by THIS run — the cleanup below owns their removal via
    // this closure (the unmount teardown order makes a shared ref unsafe: the
    // chart-init effect's cleanup runs first and would null it).
    const lines: IPriceLine[] = [];
    try {
      const drawnSymbol = toDisplaySymbol(symbol);
      const visibleOrders = (orders ?? []).filter(
        order => toDisplaySymbol(order.symbol) === drawnSymbol
      );

      // Limit levels — one dashed line per priced order, side-coloured,
      // labelled with side + size on the price axis.
      for (const order of visibleOrders) {
        if (order.price == null || !Number.isFinite(order.price)) continue;
        lines.push(
          series.createPriceLine({
            price: order.price,
            color: ORDER_SIDE_COLOR[order.side],
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${order.side} ${order.quantity ?? ""}`.trim(),
          })
        );
      }

      // Placement markers at the orders' creation time. The plugin only
      // renders markers inside the loaded candle range, so older (or
      // venue-clock-skewed future) timestamps clamp to the first/last candle
      // instead of silently disappearing; rows without a timestamp (MARKET
      // fills) get a level only.
      if (chartData && chartData.length > 0) {
        const firstTime = chartData[0].time;
        const lastTime = chartData[chartData.length - 1].time;
        const markers: SeriesMarker<Time>[] = [];
        for (const order of visibleOrders) {
          if (order.createdAtMs == null) continue;
          const createdAt = Math.floor(order.createdAtMs / 1000);
          markers.push({
            time: Math.min(Math.max(createdAt, firstTime), lastTime) as Time,
            position: order.side === "BUY" ? "belowBar" : "aboveBar",
            shape: order.side === "BUY" ? "arrowUp" : "arrowDown",
            color: ORDER_SIDE_COLOR[order.side],
            text: order.orderType || undefined,
          });
        }
        markersPlugin.setMarkers(markers);
      } else {
        markersPlugin.setMarkers([]);
      }
    } catch (ordersError) {
      console.error("Failed to draw open orders:", ordersError);
    }

    return () => {
      // F4: React tears effects down in declaration order, so by the time
      // this cleanup runs the chart-init effect's cleanup above may ALREADY
      // have removed the chart (unmount, or a `height` change). The `try`
      // blocks that used to sit here could not help: a `setMarkers()` on a
      // removed chart schedules a requestAnimationFrame inside
      // lightweight-charts that throws on the disposed canvases
      // ASYNCHRONOUSLY, where no synchronous try/catch can reach it. Prove
      // the instances this run drew with are still the mounted chart's
      // before touching them — a stale one is skipped entirely, which is
      // also correct: the chart (and with it the lines and the markers
      // plugin) is gone, so there is nothing left to remove.
      if (series !== candlestickSeriesRef.current) return;
      const livePlugin = markersPluginRef.current;
      if (!livePlugin || livePlugin !== markersPlugin) return;

      for (const line of lines) {
        try {
          series.removePriceLine(line);
        } catch {
          // Series already gone — nothing left to remove.
        }
      }
      try {
        livePlugin.setMarkers([]);
      } catch {
        // Plugin already detached with its series.
      }
    };
  }, [orders, chartData, symbol]);

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
        {chartError && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-danger rounded-full"></div>
            <span className="text-sm text-danger">{chartError}</span>
          </div>
        )}
        {loading && !chartError && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
            <span className="text-sm text-textMuted">Loading...</span>
          </div>
        )}
        {!loading && !chartError && chartData && chartData.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-success rounded-full"></div>
            <span className="text-sm text-success">
              Live • {chartData.length} candles
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

        {chartError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-2">⚠️</div>
              <p className="text-sm font-medium text-danger">
                Error loading chart
              </p>
              <p className="text-xs text-textMuted mt-2">{chartError}</p>
            </div>
          </div>
        )}

        {!loading && !chartError && (!chartData || chartData.length === 0) && (
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
