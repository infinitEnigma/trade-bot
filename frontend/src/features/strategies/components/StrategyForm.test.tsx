/** @format */

/**
 * StrategyForm orchestrator contract: create starts on the type chooser and
 * advances to the chosen type's form; edit routes a GRID row straight to its
 * form and shows read-only details for any other type (defensive — 29/29
 * prod rows are GRID).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Strategy, StrategyType } from "../../../shared/types";
import { StrategyForm } from "./StrategyForm";

vi.mock("./StrategyTypeChooser", () => ({
  StrategyTypeChooser: ({ onSelect }: { onSelect: (t: never) => void }) => (
    <div>
      <span>chooser-step</span>
      <button onClick={() => onSelect("GRID" as never)}>pick-grid</button>
    </div>
  ),
}));

vi.mock("./GridStrategyForm", () => ({
  GridStrategyForm: ({ strategy }: { strategy?: { name: string } }) => (
    <div>
      {strategy ? `grid-form:edit:${strategy.name}` : "grid-form:create"}
    </div>
  ),
}));

const baseStrategy = new Strategy(
  "s1",
  "u1",
  "My Grid",
  StrategyType.GRID,
  "PERP_ETH_USDC",
  { symbol: "PERP_ETH_USDC", gridSize: 10, gridRange: 5 },
  true
);

describe("StrategyForm orchestration", () => {
  it("create: opens on the chooser, Grid pick advances to the grid form", () => {
    render(<StrategyForm onClose={() => {}} onSuccess={() => {}} />);

    expect(screen.getByText("chooser-step")).toBeDefined();
    expect(screen.queryByText("grid-form:create")).toBeNull();

    fireEvent.click(screen.getByText("pick-grid"));
    expect(screen.getByText("grid-form:create")).toBeDefined();
    expect(screen.queryByText("chooser-step")).toBeNull();
    expect(screen.getByText(/create grid strategy/i)).toBeDefined();
  });

  it("edit GRID: skips the chooser and mounts the grid form in edit mode", () => {
    render(
      <StrategyForm
        strategy={baseStrategy}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(screen.getByText("grid-form:edit:My Grid")).toBeDefined();
    expect(screen.queryByText("chooser-step")).toBeNull();
    expect(screen.getByText("Edit Strategy")).toBeDefined();
  });

  it("edit non-GRID (defensive): read-only details, never a foreign form", () => {
    const trendRow = new Strategy(
      "s2",
      "u1",
      "Old Trend",
      StrategyType.TREND_FOLLOWING,
      "PERP_BTC_USDC",
      { symbol: "PERP_BTC_USDC", leverage: 5 },
      true
    );
    render(
      <StrategyForm
        strategy={trendRow}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(screen.queryByText(/grid-form/)).toBeNull();
    expect(screen.getByText(/not editable yet/i)).toBeDefined();
    expect(screen.getByText("Old Trend")).toBeDefined();
    expect(screen.getByText("Trend Following")).toBeDefined();
  });
});
