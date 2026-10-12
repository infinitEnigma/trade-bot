/** @format */

/**
 * RecentTradesTable contract: honest states (loading / error / empty are
 * three different things), NULL pnl renders as unknown — never a fabricated
 * $0 — and the attribution columns exist only in the "full" variant.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentTradesTable } from "./RecentTrades";
import type { LedgerTradeRow } from "../../../infrastructure/api/trading";

const row = (overrides: Partial<LedgerTradeRow> = {}): LedgerTradeRow => ({
  id: "t1",
  strategyId: "s1",
  strategyName: "My Grid",
  botId: "b1",
  exchangeAccountId: "acc1",
  orderId: "o1",
  symbol: "PERP_ETH_USDC",
  side: "BUY",
  quantity: 0.01,
  price: 2000.5,
  fee: null,
  pnl: 1.25,
  status: "FILLED",
  executedAt: "2026-10-12T10:00:00.000Z",
  ...overrides,
});

describe("RecentTradesTable", () => {
  it("renders rows with attribution in the full variant", () => {
    render(
      <RecentTradesTable
        trades={[row()]}
        isLoading={false}
        error={null}
        accountLabels={{ acc1: "lighter (testnet) idx-a" }}
      />
    );

    expect(screen.getByText("ETH")).toBeDefined();
    expect(screen.getByText("BUY")).toBeDefined();
    expect(screen.getByText("My Grid")).toBeDefined();
    expect(screen.getByText("lighter (testnet) idx-a")).toBeDefined();
    // Positive pnl formatted with sign.
    expect(screen.getByText("+$1.25")).toBeDefined();
  });

  it("drops the Account/Strategy columns in the compact variant", () => {
    render(
      <RecentTradesTable
        trades={[row()]}
        isLoading={false}
        error={null}
        variant="compact"
      />
    );

    expect(screen.queryByText("Account")).toBeNull();
    expect(screen.queryByText("Strategy")).toBeNull();
    // Core columns still present.
    expect(screen.getByText("Symbol")).toBeDefined();
    expect(screen.getByText("PnL")).toBeDefined();
  });

  it("renders NULL pnl as an em dash, never $0.00", () => {
    render(
      <RecentTradesTable
        trades={[row({ pnl: null })]}
        isLoading={false}
        error={null}
        variant="compact"
      />
    );

    expect(screen.getByText("—")).toBeDefined();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("keeps loading, error and empty as three distinct states", () => {
    const { rerender } = render(
      <RecentTradesTable trades={[]} isLoading={true} error={null} />
    );
    expect(screen.getByText("Loading trades...")).toBeDefined();

    rerender(
      <RecentTradesTable trades={[]} isLoading={false} error={new Error()} />
    );
    expect(screen.getByText("Unable to load trades")).toBeDefined();
    // The error state must NOT also show the empty state.
    expect(screen.queryByText("No recent trades")).toBeNull();

    rerender(<RecentTradesTable trades={[]} isLoading={false} error={null} />);
    expect(screen.getByText("No recent trades")).toBeDefined();
  });

  it("renders the headerActions slot (account filter host)", () => {
    render(
      <RecentTradesTable
        trades={[]}
        isLoading={false}
        error={null}
        headerActions={<div data-testid="filter-slot">filter</div>}
      />
    );
    expect(screen.getByTestId("filter-slot")).toBeDefined();
  });
});
