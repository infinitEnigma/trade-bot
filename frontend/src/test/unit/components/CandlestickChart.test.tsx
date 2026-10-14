/** @format */

/**
 * Phase 3 (slice 3): the chart renders the open-orders book for its own
 * market — dashed side-coloured limit levels for priced orders, placement
 * markers at order creation time (clamped into the loaded candle range), a
 * per-symbol guard (backend rows are `PERP_*_USDC`; Lighter picks may be
 * bare `BTC`), and cleanup that removes the lines/markers it created. The
 * chart engine and the data/visibility hooks are mocked; only the drawing
 * contract is under test.
 *
 * F4: the chart lifecycle is under test too. `setMarkers()` schedules a
 * requestAnimationFrame inside lightweight-charts, so calling it on a chart
 * that has already been `remove()`d throws asynchronously on the disposed
 * canvases — outside any try/catch. The fakes therefore record every
 * post-dispose touch (`fakes.postDisposeCalls`), and the historical-data
 * error is controllable (`fakes.chartError`) so the refetch-storm flap that
 * used to destroy and recreate the chart can be simulated exactly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OpenOrderRow } from "../../../infrastructure/api/market";
import type { GridPreviewInput } from "../../../shared/components/charts/gridPreview";

const fakes = vi.hoisted(() => {
  const candles = [
    { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { time: 2000, open: 1.5, high: 3, low: 1, close: 2.5, volume: 12 },
  ];
  const candleSeries = {
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn((options: { price: number }) => ({
      __priceLine: true,
      price: options.price,
    })),
    removePriceLine: vi.fn(),
  };
  const volumeSeries = {
    setData: vi.fn(),
    update: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
  };
  // F4: a removed chart's plugin is dead. Any call recorded here is the
  // disposed-chart crash class (the throw lands in a rAF, so it cannot be
  // caught by the component — it has to be prevented instead).
  const postDisposeCalls: string[] = [];
  let disposed = false;
  const markersPlugin = {
    setMarkers: vi.fn(() => {
      if (disposed) postDisposeCalls.push("markersPlugin.setMarkers");
    }),
    detach: vi.fn(),
  };
  const chart = {
    addSeries: vi.fn((seriesType: unknown) =>
      seriesType === "HistogramSeries" ? volumeSeries : candleSeries
    ),
    applyOptions: vi.fn(),
    remove: vi.fn(() => {
      disposed = true;
    }),
    timeScale: () => ({ fitContent: vi.fn() }),
  };
  return {
    candles,
    candleSeries,
    volumeSeries,
    markersPlugin,
    chart,
    postDisposeCalls,
    /** The historical poll's error message, exactly as `useChartData` surfaces it. */
    chartError: null as string | null,
    /**
     * The fakes reuse ONE chart/series/plugin object, so liveness is tracked
     * by a flag rather than by identity. A real `createChart()` always
     * returns a live instance — re-arm that here.
     */
    markChartCreated: () => {
      disposed = false;
    },
    /** Between tests: pretend the chart was never disposed again. */
    resetDisposal: () => {
      disposed = false;
      postDisposeCalls.length = 0;
    },
  };
});

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => {
    fakes.markChartCreated();
    return fakes.chart;
  }),
  createSeriesMarkers: vi.fn(() => fakes.markersPlugin),
  LineStyle: { Dotted: 0, Dashed: 1, Solid: 2 },
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0, Magnet: 1 },
  CandlestickSeries: "CandlestickSeries",
  HistogramSeries: "HistogramSeries",
}));

vi.mock("../../../shared/hooks/useChartData", () => ({
  useChartData: () => ({
    data: fakes.candles,
    loading: false,
    error: fakes.chartError,
    markPriceData: null,
    connectionStatus: "connected",
  }),
}));

vi.mock("../../../shared/hooks/useVisibility", () => ({
  useVisibility: () => true,
}));

import { createSeriesMarkers } from "lightweight-charts";
import { CandlestickChart } from "../../../shared/components/charts/CandlestickChart";

/** Stable default candles; individual tests may swap `fakes.candles`. */
const DEFAULT_CANDLES = fakes.candles;

/** One row as `GET /api/market/orders` returns it (backend `OpenOrderRow`). */
const order = (overrides: Partial<OpenOrderRow> = {}): OpenOrderRow => ({
  orderId: "o-1",
  clientOrderId: null,
  symbol: "PERP_BTC_USDC",
  side: "BUY",
  orderType: "LIMIT",
  price: 123.45,
  quantity: 0.5,
  filledQuantity: 0,
  status: "NEW",
  createdAtMs: 500_000, // 500 s — older than the first candle → clamped
  exchange: "kodiak",
  ...overrides,
});

const renderChart = (props: {
  symbol?: string;
  orders?: OpenOrderRow[];
  height?: number;
  previewGrid?: GridPreviewInput | null;
}) =>
  render(
    <CandlestickChart
      symbol={props.symbol ?? "PERP_BTC_USDC"}
      interval="1h"
      height={props.height ?? 400}
      {...(props.orders !== undefined ? { orders: props.orders } : {})}
      {...(props.previewGrid !== undefined
        ? { previewGrid: props.previewGrid }
        : {})}
    />
  );

describe("CandlestickChart order levels + markers (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.candles = DEFAULT_CANDLES;
    fakes.chartError = null;
    fakes.resetDisposal();
    // The component logs a data-update debug line; keep test output clean.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws a dashed side-coloured price level per priced order", () => {
    renderChart({
      orders: [
        order(),
        order({ orderId: "o-2", side: "SELL", price: 200, quantity: 1 }),
      ],
    });

    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(2);
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 123.45,
        color: "#10b981",
        lineStyle: 1, // LineStyle.Dashed in the mock
        axisLabelVisible: true,
        title: "BUY 0.5",
      })
    );
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 200, color: "#ef4444", title: "SELL 1" })
    );
  });

  it("skips the level for a price-less order but still marks its placement", () => {
    renderChart({ orders: [order({ price: null, orderType: "MARKET" })] });

    expect(fakes.candleSeries.createPriceLine).not.toHaveBeenCalled();
    expect(fakes.markersPlugin.setMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({
        shape: "arrowUp",
        position: "belowBar",
        color: "#10b981",
        text: "MARKET",
      }),
    ]);
  });

  it("clamps marker times into the loaded candle range and drops rows without one", () => {
    renderChart({
      orders: [
        order(), // 500 s < first candle (1000) → clamped to 1000
        order({ orderId: "o-2", createdAtMs: 9_000_000 }), // 9000 > last (2000)
        order({ orderId: "o-3", createdAtMs: null }), // no marker
      ],
    });

    expect(fakes.markersPlugin.setMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ time: 1000, shape: "arrowUp" }),
      expect.objectContaining({ time: 2000, shape: "arrowUp" }),
    ]);
  });

  it("only draws the charted market — bare Lighter picks match `PERP_*_USDC` rows", () => {
    renderChart({
      symbol: "BTC",
      orders: [
        order(),
        order({ orderId: "o-2", symbol: "PERP_ETH_USDC", price: 999 }),
      ],
    });

    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(1);
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 123.45 })
    );
    expect(fakes.markersPlugin.setMarkers).toHaveBeenLastCalledWith([
      expect.objectContaining({ shape: "arrowUp" }),
    ]);
  });

  it("removes the levels and clears the markers when the book empties", () => {
    const { rerender } = renderChart({ orders: [order()] });
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(1);
    const line = fakes.candleSeries.createPriceLine.mock.results[0].value;

    rerender(
      <CandlestickChart symbol="PERP_BTC_USDC" interval="1h" orders={[]} />
    );

    expect(fakes.candleSeries.removePriceLine).toHaveBeenCalledWith(line);
    expect(fakes.markersPlugin.setMarkers).toHaveBeenLastCalledWith([]);
  });

  it("disposes the chart with its levels and markers on unmount (F4)", () => {
    const { unmount } = renderChart({ orders: [order()] });
    // Drawn while the chart was live.
    expect(fakes.markersPlugin.setMarkers).toHaveBeenCalledTimes(1);

    unmount();

    // `chart.remove()` takes the price lines and the markers plugin with it,
    // so the orders cleanup has nothing left to remove — and must not poke
    // the dead plugin either: that is what scheduled the requestAnimationFrame
    // which then threw on the disposed canvases, asynchronously, where no
    // try/catch could reach it.
    expect(fakes.chart.remove).toHaveBeenCalledTimes(1);
    expect(fakes.postDisposeCalls).toEqual([]);
  });

  // ---- F4: the chart's lifetime must not depend on the data poll ----

  it("keeps ONE chart alive across a chartError flap (F4)", () => {
    // The historical poll flaps null → message → null on every retry during
    // a refetch storm. Each flap used to run this effect's cleanup
    // (`chart.remove()`) and then bail out of the body — the dispose/recreate
    // churn that blanked the pane and armed the disposed-chart crash.
    // Fresh element each time: re-rendering with the SAME element object
    // makes React bail out, which would never deliver the new error.
    const chart = () => (
      <CandlestickChart
        symbol="PERP_BTC_USDC"
        interval="1h"
        height={400}
        orders={[order()]}
      />
    );

    // 1. Mounted while ALREADY in error (a cached 400, retries pending): the
    //    chart is still created — the error is an overlay, not a gate.
    fakes.chartError = "Failed to load historical data";
    const { rerender } = render(chart());
    expect(fakes.chart.addSeries).toHaveBeenCalledTimes(2); // candles + volume
    expect(fakes.chart.remove).not.toHaveBeenCalled();
    expect(screen.getByText(/Error loading chart/)).toBeDefined();

    // 2. The error clears and data arrives.
    fakes.chartError = null;
    rerender(chart());
    expect(fakes.chart.remove).not.toHaveBeenCalled();

    // 3. It comes back — still the same chart, overlay only.
    fakes.chartError = "Failed to load historical data";
    rerender(chart());
    expect(fakes.chart.addSeries).toHaveBeenCalledTimes(2);
    expect(fakes.chart.remove).not.toHaveBeenCalled();
    expect(fakes.postDisposeCalls).toEqual([]);
  });

  it("recreating for a height change leaves the disposed chart untouched (F4)", () => {
    // `orders` is a fresh array on every render (callers build it inline), so
    // the orders effect re-runs here too: its cleanup must skip the chart the
    // chart-init cleanup just removed, and its body must redraw onto the NEW
    // live chart.
    const { rerender } = renderChart({ orders: [order()], height: 400 });

    rerender(
      <CandlestickChart
        symbol="PERP_BTC_USDC"
        interval="1h"
        height={600}
        orders={[order()]}
      />
    );

    expect(fakes.chart.remove).toHaveBeenCalledTimes(1);
    expect(fakes.chart.addSeries).toHaveBeenCalledTimes(4); // two charts
    // Initial draw + the redraw onto the replacement chart — no third call
    // from a cleanup poking the removed chart.
    expect(fakes.markersPlugin.setMarkers).toHaveBeenCalledTimes(2);
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(2);
    expect(fakes.postDisposeCalls).toEqual([]);
  });

  it("creates the markers plugin once per chart", () => {
    renderChart({ orders: [order()] });
    expect(createSeriesMarkers).toHaveBeenCalledTimes(1);
  });

  it("re-applies a bounded fine-tick price format (review P1-2)", () => {
    // The live PERP_1000PEPE_USDC case: closes at 1e-7-scale prices must NOT
    // render through the historic 2-decimal format.
    fakes.candles = [
      {
        time: 1000,
        open: 0.0000011,
        high: 0.0000015,
        low: 0.0000009,
        close: 0.0000012,
        volume: 5,
      },
    ];
    renderChart({ orders: [order({ price: 0.0000008 })] });

    expect(fakes.candleSeries.applyOptions).toHaveBeenCalledWith({
      priceFormat: { type: "price", precision: 7, minMove: 1e-7 },
    });
  });

  // ---- F5: the live grid preview ----

  /** Centre on an exact price so the level arithmetic stays bit-exact. */
  const setCenterCandles = (close: number) => {
    fakes.candles = [
      {
        time: 1000,
        open: close - 1,
        high: close + 1,
        low: close - 2,
        close,
        volume: 10,
      },
    ];
  };

  it("draws dashed violet preview levels centred on the last close", () => {
    setCenterCandles(100);
    renderChart({
      previewGrid: { symbol: "PERP_BTC_USDC", gridSize: 4, gridRange: 2 },
    });

    // 100 ± 1% → [99, 101], 5 levels, step 0.5
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(5);
    for (const [index, price] of [99, 99.5, 100, 100.5, 101].entries()) {
      expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledWith({
        price,
        color: "#a78bfa",
        lineStyle: 1, // LineStyle.Dashed in the mock
        axisLabelVisible: true,
        title: `G${index}`,
      });
    }
    // A preview is a plan, never a placed order: no arrows for it.
    expect(fakes.markersPlugin.setMarkers).toHaveBeenLastCalledWith([]);
  });

  it("keeps the preview visually distinct from the resting order levels", () => {
    setCenterCandles(100);
    renderChart({
      orders: [order()],
      previewGrid: { symbol: "PERP_BTC_USDC", gridSize: 2, gridRange: 2 },
    });

    const colors = fakes.candleSeries.createPriceLine.mock.calls.map(
      call => (call[0] as unknown as { color: string }).color
    );
    // The order's side colour and the preview's violet must never collide.
    expect(colors).toContain("#10b981");
    expect(colors).toContain("#a78bfa");
  });

  it("replaces the preview levels when the form's config changes", () => {
    setCenterCandles(100);
    const { rerender } = renderChart({
      previewGrid: { symbol: "PERP_BTC_USDC", gridSize: 2, gridRange: 2 },
    });
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(3);

    rerender(
      <CandlestickChart
        symbol="PERP_BTC_USDC"
        interval="1h"
        height={400}
        previewGrid={{ symbol: "PERP_BTC_USDC", gridSize: 2, gridRange: 4 }}
      />
    );

    // The old band's lines are removed and the new band's are drawn.
    expect(fakes.candleSeries.removePriceLine).toHaveBeenCalledTimes(3);
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(6);
    expect(fakes.candleSeries.createPriceLine).toHaveBeenLastCalledWith(
      expect.objectContaining({ price: 102, title: "G2" })
    );
  });

  it("draws nothing for a config the engine would refuse", () => {
    setCenterCandles(100);
    renderChart({
      previewGrid: { symbol: "PERP_BTC_USDC", gridSize: 1, gridRange: 2 },
    });

    expect(fakes.candleSeries.createPriceLine).not.toHaveBeenCalled();
  });

  it("draws nothing when the form's symbol is missing", () => {
    setCenterCandles(100);
    renderChart({
      previewGrid: { symbol: "", gridSize: 4, gridRange: 2 },
    });

    expect(fakes.candleSeries.createPriceLine).not.toHaveBeenCalled();
  });

  it("draws no preview until a centre price is known", () => {
    fakes.candles = []; // no mark price in the mock, no close to fall back to
    renderChart({
      previewGrid: { symbol: "PERP_BTC_USDC", gridSize: 4, gridRange: 2 },
    });

    expect(fakes.candleSeries.createPriceLine).not.toHaveBeenCalled();
  });

  it("drops the preview lines on unmount without touching the disposed chart (F4)", () => {
    setCenterCandles(100);
    const { unmount } = renderChart({
      previewGrid: { symbol: "PERP_BTC_USDC", gridSize: 4, gridRange: 2 },
    });
    expect(fakes.candleSeries.createPriceLine).toHaveBeenCalledTimes(5);

    unmount();

    expect(fakes.chart.remove).toHaveBeenCalledTimes(1);
    expect(fakes.postDisposeCalls).toEqual([]);
  });
});
