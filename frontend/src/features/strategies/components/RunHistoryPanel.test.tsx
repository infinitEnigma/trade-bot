/** @format */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { StrategyRun } from "../types/strategies.types";
import { RunHistoryPanel } from "./RunHistoryPanel";

const makeRun = (overrides: Partial<StrategyRun> = {}): StrategyRun => ({
  id: "6a89f2c1-4b3a-4c2d-8e10-f2c1a937",
  strategy_id: "strategy-1",
  config_version: 1,
  config: {},
  notional_amount: "100",
  state: "RUNNING",
  last_error_code: null,
  created_at: "2026-10-01T10:00:00.000Z",
  ...overrides,
});

describe("RunHistoryPanel", () => {
  it("hides when runs are missing or empty", () => {
    const { rerender } = render(<RunHistoryPanel runs={undefined} />);
    expect(screen.queryByRole("region", { name: "Run history" })).toBeNull();

    rerender(<RunHistoryPanel runs={[]} />);
    expect(screen.queryByRole("region", { name: "Run history" })).toBeNull();
  });

  it("shows one run collapsed with an accessible toggle and expands on click", () => {
    render(<RunHistoryPanel runs={[makeRun()]} />);

    expect(screen.getByText("1 run")).toBeDefined();
    expect(screen.getByLabelText("Run state: Running")).toBeDefined();
    expect(screen.getByText(/Notional \$100\.00 · Created/)).toBeDefined();
    expect(screen.getByText("…f2c1a937")).toBeDefined();
    expect(screen.getByText("…f2c1a937").getAttribute("title")).toBe(
      "6a89f2c1-4b3a-4c2d-8e10-f2c1a937"
    );
    expect(screen.getByText(/ago/)).toBeDefined();
    expect(screen.queryByText(/PnL/i)).toBeNull();

    const toggle = screen.getByRole("button", {
      name: "Expand run history details",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const details = document.getElementById("run-history-details");
    expect(details?.hasAttribute("hidden")).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(details?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("Full Run ID:").nextSibling?.textContent).toBe(
      "6a89f2c1-4b3a-4c2d-8e10-f2c1a937"
    );
  });

  it("shows multiple runs expanded in their existing oldest-to-newest order", () => {
    const runs = [
      makeRun({ id: "run-oldest", state: "STOPPED", notional_amount: "0" }),
      makeRun({
        id: "run-error",
        state: "ERROR",
        notional_amount: "abc",
        created_at: undefined,
      }),
      makeRun({
        id: "run-newest",
        state: "UNRECOGNIZED",
        notional_amount: "",
      }),
    ];
    render(<RunHistoryPanel runs={runs} />);

    expect(screen.getByText("3 runs")).toBeDefined();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("…n-oldest");
    expect(items[1].textContent).toContain("…un-error");
    expect(items[2].textContent).toContain("…n-newest");
    expect(items[0].textContent).toContain("$0.00");
    expect(items[1].textContent).toContain("Notional —");
    expect(items[1].textContent).toContain("Created —");
    expect(items[2].textContent).toContain("Notional —");
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText("?")).toBeDefined();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByText(/PnL/i)).toBeNull();
  });
});
