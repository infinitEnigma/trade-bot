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
    orders?: unknown;
    previewGrid?: unknown;
  }) => (
    <div
      data-testid="candlestick-chart"
      data-symbol={props.symbol ?? ""}
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
      previewGrid: { symbol: "PERP_BTC_USDC", gridSize: 10, gridRange: 5 },
    });

    const chart = await screen.findByTestId("candlestick-chart");
    // Nothing is drawn on a market the draft does not describe.
    expect(chart.getAttribute("data-preview")).toBe("null");
    expect(screen.getByText(/switch the chart to that market/i)).toBeDefined();
  });

  it("treats bare and perp spellings as the same market", async () => {
    renderPanel({ previewGrid: { symbol: "ETH", gridSize: 10, gridRange: 5 } });

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toContain("ETH");
    expect(screen.queryByText(/switch the chart to that market/i)).toBeNull();
  });

  it("draws no preview when no form is open", async () => {
    renderPanel();

    const chart = await screen.findByTestId("candlestick-chart");
    expect(chart.getAttribute("data-preview")).toBe("null");
  });
});
