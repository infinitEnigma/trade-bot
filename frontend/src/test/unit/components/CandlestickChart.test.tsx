/** @format */

/**
 * Phase 3 (slice 3): the chart renders the open-orders book for its own
 * market — dashed side-coloured limit levels for priced orders, placement
 * markers at order creation time (clamped into the loaded candle range), a
 * per-symbol guard (backend rows are `PERP_*_USDC`; Lighter picks may be
 * bare `BTC`), and cleanup that removes the lines/markers it created. The
 * chart engine and the data/visibility hooks are mocked; only the drawing
 * contract is under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { OpenOrderRow } from "../../../infrastructure/api/market";

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
  const markersPlugin = { setMarkers: vi.fn(), detach: vi.fn() };
  const chart = {
    addSeries: vi.fn((seriesType: unknown) =>
      seriesType === "HistogramSeries" ? volumeSeries : candleSeries
    ),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
  };
  return { candles, candleSeries, volumeSeries, markersPlugin, chart };
});

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => fakes.chart),
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
    error: null,
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

const renderChart = (props: { symbol?: string; orders?: OpenOrderRow[] }) =>
  render(
    <CandlestickChart
      symbol={props.symbol ?? "PERP_BTC_USDC"}
      interval="1h"
      {...(props.orders !== undefined ? { orders: props.orders } : {})}
    />
  );

describe("CandlestickChart order levels + markers (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.candles = DEFAULT_CANDLES;
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

  it("cleans up its levels and markers on unmount", () => {
    const { unmount } = renderChart({ orders: [order()] });
    const line = fakes.candleSeries.createPriceLine.mock.results[0].value;

    unmount();

    expect(fakes.candleSeries.removePriceLine).toHaveBeenCalledWith(line);
    expect(fakes.markersPlugin.setMarkers).toHaveBeenLastCalledWith([]);
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
});
