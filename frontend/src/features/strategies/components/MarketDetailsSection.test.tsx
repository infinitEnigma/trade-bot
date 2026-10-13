/** @format */

/**
 * MarketDetailsSection contract (Phase 2 IA, Phase 3.1 re-scoped): the
 * PORTFOLIO figures live in a collapsible disclosure below the strategy
 * workspace — the chart moved into StrategyWorkspace (review P1-1). The
 * toggle reports its state via aria-expanded/aria-controls; collapsing hides
 * the content without unmounting the section.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";
import { MarketDetailsSection } from "./MarketDetailsSection";

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
    <MarketDetailsSection portfolioSummary={summary()} isVerified {...props} />
  );

describe("MarketDetailsSection", () => {
  it("renders expanded by default with aria-expanded=true", () => {
    renderSection();
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Portfolio")).toBeDefined();
  });

  it("hides the figures after collapsing the disclosure", () => {
    renderSection();
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("On-chain balance")).toBeNull();
    // Section label stays visible so it can be reopened.
    expect(screen.getByText("Portfolio")).toBeDefined();
  });

  it("re-opens on a second click", () => {
    renderSection();
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Wallet")).toBeDefined();
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

  it("renders NO chart (Phase 3.1: the chart lives in the workspace)", () => {
    renderSection();
    expect(screen.queryByLabelText("Chart symbol")).toBeNull();
  });
});
