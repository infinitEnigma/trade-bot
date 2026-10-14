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
  GridStrategyForm: ({
    strategy,
    onPreviewChange,
  }: {
    strategy?: { name: string };
    onPreviewChange?: (preview: unknown) => void;
  }) => (
    <div>
      {strategy ? `grid-form:edit:${strategy.name}` : "grid-form:create"}
      {onPreviewChange ? (
        <button onClick={() => onPreviewChange({ symbol: "PERP_BTC_USDC" })}>
          publish-preview
        </button>
      ) : null}
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

  // ---- F5: side drawer + live preview seam ----

  it("opens as a labelled side drawer, not a viewport-covering modal", () => {
    // The old centred full-screen modal hid the chart exactly while the
    // operator was configuring a grid. The drawer anchors right, and from
    // `lg` up its scrim is click-through so the chart stays usable.
    render(<StrategyForm onClose={() => {}} onSuccess={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Create New Strategy");
  });

  it("forwards the live-preview seam to the grid form", () => {
    const onPreviewChange = vi.fn();
    render(
      <StrategyForm
        strategy={baseStrategy}
        onClose={() => {}}
        onSuccess={() => {}}
        onPreviewChange={onPreviewChange}
      />
    );

    fireEvent.click(screen.getByText("publish-preview"));
    expect(onPreviewChange).toHaveBeenCalledWith({ symbol: "PERP_BTC_USDC" });
  });
});
