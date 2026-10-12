/** @format */

/**
 * StrategyTypeChooser contract: Grid is the only clickable card (the engine
 * implements exactly one strategy); Trend Following and Arbitrage render
 * disabled with a "Coming soon" badge — the roadmap is visible without a
 * create path that would silently start a default GRID.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StrategyType } from "../../../shared/types";
import { StrategyTypeChooser } from "./StrategyTypeChooser";

describe("StrategyTypeChooser", () => {
  it("offers Grid as the only clickable card and emits its type", () => {
    const onSelect = vi.fn();
    render(<StrategyTypeChooser onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /grid trading/i }));
    expect(onSelect).toHaveBeenCalledWith(StrategyType.GRID);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders Trend Following and Arbitrage disabled with 'Coming soon'", () => {
    render(<StrategyTypeChooser onSelect={vi.fn()} />);

    for (const title of [/trend following/i, /arbitrage/i]) {
      const card = screen.getByText(title).closest("div[aria-disabled]");
      expect(card).not.toBeNull();
      expect(card).toHaveAttribute("aria-disabled", "true");
    }
    // Exactly two "Coming soon" badges — the two unimplemented types.
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    // Only the Grid card is a button (the enabled affordance).
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
