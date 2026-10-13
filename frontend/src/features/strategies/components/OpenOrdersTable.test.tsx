/** @format */

/**
 * OpenOrdersTable (Phase 3 slice 4): rows carry the venue truth (side, price,
 * size, fill progress, status, venue) and null price/size render as an em
 * dash — never a fabricated 0. Loading, error and empty stay three distinct
 * states: a failed venue read must not look like an empty book.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenOrdersTable } from "./OpenOrdersTable";
import type { OpenOrderRow } from "../../../infrastructure/api/market";

const row = (overrides: Partial<OpenOrderRow> = {}): OpenOrderRow => ({
  orderId: "o1",
  clientOrderId: null,
  symbol: "PERP_BTC_USDC",
  side: "BUY",
  orderType: "LIMIT",
  price: 65000.5,
  quantity: 0.1,
  filledQuantity: 0.025,
  status: "NEW",
  createdAtMs: Date.UTC(2026, 9, 12, 10, 0, 0),
  exchange: "kodiak",
  ...overrides,
});

describe("OpenOrdersTable", () => {
  it("renders a resting order's venue fields", () => {
    render(
      <OpenOrdersTable orders={[row()]} isLoading={false} error={false} />
    );

    expect(screen.getByText("PERP_BTC_USDC")).toBeDefined();
    expect(screen.getByText("BUY")).toBeDefined();
    expect(screen.getByText("LIMIT")).toBeDefined();
    expect(screen.getByText("65000.5")).toBeDefined();
    expect(screen.getByText("0.1")).toBeDefined();
    expect(screen.getByText("0.025 / 0.1")).toBeDefined();
    expect(screen.getByText("NEW")).toBeDefined();
    expect(screen.getByText("KODIAK")).toBeDefined();
  });

  it("renders a SELL row in the danger color and a partial fill honestly", () => {
    render(
      <OpenOrdersTable
        orders={[row({ side: "SELL", status: "PARTIALLY_FILLED" })]}
        isLoading={false}
        error={false}
      />
    );
    expect(screen.getByText("SELL").className).toContain("text-danger");
    expect(screen.getByText("PARTIALLY_FILLED")).toBeDefined();
  });

  it("shows null price/size as an em dash, never a fabricated 0", () => {
    render(
      <OpenOrdersTable
        orders={[row({ price: null, quantity: null, filledQuantity: 0 })]}
        isLoading={false}
        error={false}
      />
    );
    expect(screen.queryByText("65000.5")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps loading, error and empty as three distinct states", () => {
    const { rerender } = render(
      <OpenOrdersTable orders={[]} isLoading={true} error={false} />
    );
    expect(screen.getByText(/Loading open orders/)).toBeDefined();
    expect(screen.queryByText("No open orders")).toBeNull();
    expect(screen.queryByText(/Couldn't load open orders/)).toBeNull();

    rerender(<OpenOrdersTable orders={[]} isLoading={false} error={true} />);
    expect(screen.getByText(/Couldn't load open orders/)).toBeDefined();
    expect(screen.queryByText("No open orders")).toBeNull();

    rerender(<OpenOrdersTable orders={[]} isLoading={false} error={false} />);
    expect(screen.getByText(/No open orders/)).toBeDefined();
    expect(screen.queryByText(/Couldn't load open orders/)).toBeNull();
    expect(screen.queryByText(/Loading open orders/)).toBeNull();
  });
});
