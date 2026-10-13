/** @format */

/**
 * MarketDetailsSection contract (Phase 2 IA): the chart + portfolio figures
 * live in a collapsible disclosure BELOW the strategy list. The toggle reports
 * its state via aria-expanded/aria-controls, and collapsing hides the content
 * without unmounting the section. The heavy chart is mocked so the test stays
 * focused on disclosure behaviour.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";
import type { OpenOrderRow } from "../../../infrastructure/api/market";
import type { ChartSelection } from "../utils/chartSymbolPicker";
import { MarketDetailsSection } from "./MarketDetailsSection";

// The chart is lazy-loaded (lightweight-charts); stub it for a fast, stable test.
vi.mock("../../../shared/components/charts/CandlestickChart", () => ({
  default: (props: { orders?: unknown }) => (
    <div
      data-testid="candlestick-chart"
      data-orders={JSON.stringify(props.orders ?? null)}
    />
  ),
}));

const selection: ChartSelection = {
  symbol: "PERP_ETH_USDC",
  exchange: "lighter",
  environment: "mainnet",
};

/** One row as `GET /api/market/orders` returns it (backend `OpenOrderRow`). */
const orderRow: OpenOrderRow = {
  orderId: "o-1",
  clientOrderId: null,
  symbol: "PERP_ETH_USDC",
  side: "SELL",
  orderType: "LIMIT",
  price: 123.45,
  quantity: 0.5,
  filledQuantity: 0,
  status: "NEW",
  createdAtMs: 1_700_000_000_000,
  exchange: "lighter",
};

const summary = (overrides: Partial<PortfolioSummary> = {}) =>
  ({
    walletBalance: 100,
    exchangeBalance: 50,
    unrealizedPnl: 10,
    realizedPnl: -5,
    totalAcrossExchanges: 150,
    activeAccountCount: 2,
    totalIsPartial: false,
    failedAccounts: [],
    initialLoading: false,
    error: null,
    ...overrides,
  }) as unknown as PortfolioSummary;

const renderSection = (
  props: Partial<Parameters<typeof MarketDetailsSection>[0]> = {}
) =>
  render(
    <MarketDetailsSection
      chartOptionCount={2}
      chartGroups={[
        {
          label: "Lighter",
          exchange: "lighter",
          environment: "mainnet",
          symbols: ["PERP_ETH_USDC", "PERP_BTC_USDC"],
        },
      ]}
      chartSelection={selection}
      chartSymbol={selection.symbol}
      onChartSelectionChange={() => {}}
      portfolioSummary={summary()}
      isVerified
      {...props}
    />
  );

describe("MarketDetailsSection", () => {
  it("renders expanded by default with aria-expanded=true", () => {
    renderSection();
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Market & portfolio")).toBeDefined();
  });

  it("shows the chart symbol picker when expanded (multiple symbols)", () => {
    renderSection();
    expect(screen.getByLabelText("Chart symbol")).toBeDefined();
    expect(screen.getByTestId("candlestick-chart")).toBeDefined();
  });

  it("hides the picker + chart after collapsing the disclosure", () => {
    renderSection();
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Chart symbol")).toBeNull();
    expect(screen.queryByTestId("candlestick-chart")).toBeNull();
    // Section label stays visible so it can be reopened.
    expect(screen.getByText("Market & portfolio")).toBeDefined();
  });

  it("re-opens on a second click", () => {
    renderSection();
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("candlestick-chart")).toBeDefined();
  });

  it("omits the chart picker when only one symbol exists", () => {
    renderSection({ chartOptionCount: 1 });
    expect(screen.queryByLabelText("Chart symbol")).toBeNull();
    expect(screen.getByTestId("candlestick-chart")).toBeDefined();
  });

  it("does not render portfolio figures for non-verified users", () => {
    renderSection({ isVerified: false });
    expect(screen.queryByText("On-chain balance")).toBeNull();
    expect(screen.queryByText("Wallet")).toBeNull();
  });

  it("renders the five portfolio cards for verified users", () => {
    renderSection();
    expect(screen.getByText("Wallet")).toBeDefined();
    expect(screen.getByText("Exchange")).toBeDefined();
    expect(screen.getByText("Unrealized PnL")).toBeDefined();
    expect(screen.getByText("Realized PnL")).toBeDefined();
    expect(screen.getByText("Total")).toBeDefined();
  });

  it("forwards the open-order rows to the chart (Phase 3)", () => {
    renderSection({ orders: [orderRow] });
    const chart = screen.getByTestId("candlestick-chart");
    expect(chart.getAttribute("data-orders")).toContain('"o-1"');
    expect(chart.getAttribute("data-orders")).toContain("123.45");
  });

  it("forwards no book when the page passes none", () => {
    renderSection();
    expect(
      screen.getByTestId("candlestick-chart").getAttribute("data-orders")
    ).toBe("null");
  });
});
