/** @format */

/**
 * StrategyChartPanel (F5) — the Strategies page's persistent chart panel.
 *
 * It owns the venue picker and forwards three things to the chart: the
 * selected market, the account's open-orders book, and the grid the form is
 * currently configuring. The chart filters the book to the market it shows,
 * so an unfiltered book is safe; the panel's own job is the preview MARKET
 * rule — a draft naming another market must not be drawn there.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { OpenOrderRow } from "../../../infrastructure/api/market";
import type { GridPreviewInput } from "../../../shared/components/charts/gridPreview";
import {
  type ChartSelection,
  type ChartSymbolGroup,
} from "../utils/chartSymbolPicker";
import { StrategyChartPanel } from "./StrategyChartPanel";

// The panel lazy-loads the real chart (lightweight-charts); stub it the same
// way the workspace test did, so symbol + book + preview forwarding is all
// that is under test.
vi.mock("../../../shared/components/charts/CandlestickChart", () => ({
  default: (props: {
    symbol?: string;
    interval?: string;
    orders?: unknown;
    previewGrid?: unknown;
  }) => (
    <div
      data-testid="candlestick-chart"
      data-symbol={props.symbol ?? ""}
      data-interval={props.interval ?? ""}
      data-orders={JSON.stringify(props.orders ?? null)}
      data-preview={JSON.stringify(props.previewGrid ?? null)}
    />
  ),
}));

const ORDER: OpenOrderRow = {
  orderId: "ord-1",
  clientOrderId: null,
  symbol: "PERP_ETH_USDC",
  side: "SELL",
  orderType: "LIMIT",
  price: 2500,
  quantity: 0.5,
  filledQuantity: 0,
  status: "NEW",
  createdAtMs: Date.UTC(2026, 9, 12, 9, 0, 0),
  exchange: "kodiak",
};

const ETH: ChartSelection = {
  symbol: "PERP_ETH_USDC",
  exchange: "kodiak",
  environment: "mainnet",
};

const GROUPS: ChartSymbolGroup[] = [
  {
    label: "Kodiak mainnet",
    exchange: "kodiak",
    environment: "mainnet",
    symbols: ["PERP_ETH_USDC", "PERP_BTC_USDC"],
  },
];

const PREVIEW: GridPreviewInput = {
  symbol: "PERP_ETH_USDC",
  exchange: "kodiak",
  environment: "mainnet",
  gridSize: 10,
  gridRange: 5,
};

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof StrategyChartPanel>> = {}
) =>
  render(
    <StrategyChartPanel
      selection={ETH}
      groups={GROUPS}
      optionCount={2}
      onSelectionChange={vi.fn()}
      {...overrides}
    />
  );

describe("StrategyChartPanel", () => {
  it("charts the selected market and forwards the account's book", async () => {
    renderPanel({ orders: [ORDER] });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-symbol")).toBe("PERP_ETH_USDC");
    // Forwarded whole — the chart keeps only this market's rows.
    expect(chart.getAttribute("data-orders")).toContain("ord-1");
    expect(chart.getAttribute("data-orders")).toContain("2500");
  });

  it("shows the picker when several symbols are offered and reports a change", async () => {
    const onSelectionChange = vi.fn();
    renderPanel({ onSelectionChange });

    await screen.findByTestId("candlestick-chart");
    const picker = screen.getByLabelText("Chart symbol") as HTMLSelectElement;
    // React drives a controlled select through the value PROPERTY.
    expect(picker.value).toBe("kodiak|mainnet|PERP_ETH_USDC");

    fireEvent.change(picker, {
      target: { value: "kodiak|mainnet|PERP_BTC_USDC" },
    });
    expect(onSelectionChange).toHaveBeenCalledWith({
      symbol: "PERP_BTC_USDC",
      exchange: "kodiak",
      environment: "mainnet",
    });
  });

  it("offers no picker when there is only one symbol to show", async () => {
    renderPanel({ optionCount: 1 });

    await screen.findByTestId("candlestick-chart");
    expect(screen.queryByLabelText("Chart symbol")).toBeNull();
  });

  it("draws the preview band when the form's draft names the charted market", async () => {
    renderPanel({ previewGrid: PREVIEW });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toContain("PERP_ETH_USDC");
  });

  it("withholds the band and says why when the draft names another market", async () => {
    renderPanel({
      previewGrid: {
        symbol: "PERP_BTC_USDC",
        exchange: "kodiak",
        environment: "mainnet",
        gridSize: 10,
        gridRange: 5,
      },
    });

    const chart = await screen.findByTestId("candlestick-chart");
    // Nothing is drawn on a market the draft does not describe.
    expect(chart.getAttribute("data-preview")).toBe("null");
    expect(screen.getByText(/switch the chart to that market/i)).toBeDefined();
  });

  it("treats bare and perp spellings of ANOTHER venue as not drawable (review P1)", async () => {
    // `ETH` (Lighter) and `PERP_ETH_USDC` (Kodiak) are the same MARKET but
    // different venues. The band is centred on the live price of whichever
    // market is on screen, so previewing the other venue's grid would place
    // its levels around the wrong book.
    renderPanel({
      previewGrid: {
        symbol: "ETH",
        exchange: "lighter",
        environment: "testnet",
        gridSize: 10,
        gridRange: 5,
      },
    });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toBe("null");
    expect(screen.getByText(/switch the chart to that market/i)).toBeDefined();
  });

  it("draws no preview when no form is open", async () => {
    renderPanel();

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toBe("null");
  });

  it("withholds the band when the draft names another VENUE (review P1)", async () => {
    // `BTC` is Lighter naming while the chart shows Kodiak. The band would be
    // centred on the wrong book, so nothing is drawn and the panel says why.
    renderPanel({
      previewGrid: {
        symbol: "BTC",
        exchange: "lighter",
        environment: "testnet",
        gridSize: 10,
        gridRange: 5,
      },
    });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toBe("null");
    expect(screen.getByText(/switch the chart to that market/i)).toBeDefined();
  });

  it("draws the band when the draft's spelling matches the charted venue", async () => {
    // `PERP_ETH_USDC` on the Kodiak ETH chart: same market AND same venue.
    renderPanel({
      previewGrid: {
        symbol: "PERP_ETH_USDC",
        exchange: "kodiak",
        environment: "mainnet",
        gridSize: 10,
        gridRange: 5,
      },
    });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toContain("PERP_ETH_USDC");
    expect(screen.queryByText(/switch the chart to that market/i)).toBeNull();
  });

  it("withholds the band when the preview venue is unknown, even for the same spelling (026)", async () => {
    // Legacy preview without a venue binding: symbol equivalence alone
    // (PERP_ETH_USDC === chart) must not draw — the binding is unknown.
    renderPanel({
      previewGrid: { symbol: "PERP_ETH_USDC", gridSize: 10, gridRange: 5 },
    });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toBe("null");
    expect(screen.getByText(/unknown venue/i)).toBeDefined();
  });

  it("states whose orders the levels come from (review P1)", async () => {
    // The backend's book response carries rows but not the account that
    // answered, so the caller supplies the attribution.
    renderPanel({ ordersNote: "Levels: Kodiak mainnet · account 42" });

    await screen.findByTestId("candlestick-chart");
    expect(
      screen.getByText(/Levels: Kodiak mainnet · account 42/)
    ).toBeDefined();
  });

  // --- Interval switcher (Phase 2) ---------------------------------------

  it("charts the default 1h interval when none is given", async () => {
    renderPanel();

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-interval")).toBe("1h");
    // 1H is highlighted in the switcher.
    expect(
      screen.getByRole("button", { name: "1H", pressed: true })
    ).toBeInTheDocument();
  });

  it("switches the chart interval and calls onIntervalChange", async () => {
    const onIntervalChange = vi.fn();
    renderPanel({ onIntervalChange });

    fireEvent.click(screen.getByRole("button", { name: "5m" }));

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-interval")).toBe("5m");
    expect(onIntervalChange).toHaveBeenCalledWith("5m");
    expect(
      screen.getByRole("button", { name: "5m", pressed: true })
    ).toBeInTheDocument();
    // The previously-active 1H is no longer pressed.
    expect(
      screen.queryByRole("button", { name: "1H", pressed: true })
    ).toBeNull();
  });

  it("restores the persisted interval per user (localStorage)", async () => {
    // Pre-seed storage as another user's session would have left it.
    localStorage.setItem("chart-interval:user-1", "4h");
    renderPanel({ userId: "user-1" });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-interval")).toBe("4h");
    expect(
      screen.getByRole("button", { name: "4H", pressed: true })
    ).toBeInTheDocument();

    // Switching writes back under the same user key.
    fireEvent.click(screen.getByRole("button", { name: "1m" }));
    expect(localStorage.getItem("chart-interval:user-1")).toBe("1m");
    expect(
      screen.getByRole("button", { name: "1m", pressed: true })
    ).toBeInTheDocument();

    localStorage.removeItem("chart-interval:user-1");
  });

  it("falls back to 1h for a garbage stored value", async () => {
    localStorage.setItem("chart-interval:user-1", "not-a-timeframe");
    renderPanel({ userId: "user-1" });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-interval")).toBe("1h");

    localStorage.removeItem("chart-interval:user-1");
  });
});
