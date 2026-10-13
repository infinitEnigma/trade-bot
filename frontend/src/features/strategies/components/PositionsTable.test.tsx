/** @format */

/**
 * PositionsTable (Phase 3.1, review P2-4): venue truth per row, honest blank
 * fields (never a fabricated 0 — `Number("")` is 0 and must not read as a
 * profitable zero), colour-coded unrealized PnL, and loading/error/flat as
 * three distinct states.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PositionsTable } from "./PositionsTable";
import type { AccountPositionRow } from "../../../infrastructure/api/market";

const row = (
  overrides: Partial<AccountPositionRow> = {}
): AccountPositionRow => ({
  symbol: "PERP_BTC_USDC",
  position_qty: "0.5",
  unsettled_pnl: "12.5",
  mark_price: "65000",
  average_open_price: "64000",
  ...overrides,
});

describe("PositionsTable", () => {
  it("renders the account position's fields", () => {
    render(
      <PositionsTable positions={[row()]} isLoading={false} error={false} />
    );

    expect(screen.getByText("PERP_BTC_USDC")).toBeDefined();
    expect(screen.getByText("0.5")).toBeDefined();
    expect(screen.getByText("64000")).toBeDefined();
    expect(screen.getByText("65000")).toBeDefined();
    expect(screen.getByText("12.5")).toBeDefined();
  });

  it("colour-codes unrealized PnL by sign and keeps the venue string", () => {
    render(
      <PositionsTable
        positions={[row({ unsettled_pnl: "-3.25" })]}
        isLoading={false}
        error={false}
      />
    );

    expect(screen.getByText("-3.25").className).toContain("text-danger");
  });

  it("shows blank fields as an em dash, never a fabricated 0", () => {
    render(
      <PositionsTable
        positions={[row({ unsettled_pnl: "", mark_price: "" })]}
        isLoading={false}
        error={false}
      />
    );

    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps loading, error and flat as three distinct states", () => {
    const { rerender } = render(
      <PositionsTable positions={[]} isLoading={true} error={false} />
    );
    expect(screen.getByText(/Loading positions/)).toBeDefined();
    expect(screen.queryByText(/No position/)).toBeNull();

    rerender(<PositionsTable positions={[]} isLoading={false} error={true} />);
    expect(screen.getByText(/Couldn't load positions/)).toBeDefined();
    expect(screen.queryByText(/No position/)).toBeNull();

    rerender(<PositionsTable positions={[]} isLoading={false} error={false} />);
    expect(screen.getByText(/No position on this market/)).toBeDefined();
  });
});
