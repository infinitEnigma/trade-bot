/** @format */

/**
 * Grid preview geometry (F5) — the levels the form's fields will build.
 * Pure logic, so the band/spacing/count contract and every rejection path are
 * pinned without rendering a chart.
 */

import { describe, it, expect } from "vitest";
import {
  computeGridPreview,
  DEFAULT_GRID_RANGE_PERCENT,
  DEFAULT_GRID_SIZE,
} from "../../../shared/components/charts/gridPreview";

const input = (
  overrides: Partial<{
    symbol: string;
    gridSize?: number;
    gridRange?: number;
  }> = {}
) => ({ symbol: "PERP_BTC_USDC", ...overrides });

describe("computeGridPreview", () => {
  it("builds gridSize + 1 evenly spaced levels across the band", () => {
    // 100 ± 1% → [99, 101], 4 levels → step 0.5
    const preview = computeGridPreview(
      100,
      input({ gridSize: 4, gridRange: 2 })
    );

    expect(preview).not.toBeNull();
    expect(preview?.levels).toHaveLength(5);
    expect(preview?.levels.map(l => l.price)).toEqual([
      99, 99.5, 100, 100.5, 101,
    ]);
    expect(preview?.levels.map(l => l.label)).toEqual([
      "G0",
      "G1",
      "G2",
      "G3",
      "G4",
    ]);
    expect(preview?.bandBottom).toBe(99);
    expect(preview?.bandTop).toBe(101);
    expect(preview?.spacing).toBe(0.5);
    expect(preview?.center).toBe(100);
  });

  it("falls back to the engine defaults when a field is left empty", () => {
    const preview = computeGridPreview(50_000, input());

    expect(preview?.gridSize).toBe(DEFAULT_GRID_SIZE);
    expect(preview?.gridRange).toBe(DEFAULT_GRID_RANGE_PERCENT);
    // 50 000 ± 2.5% → [48 750, 51 250], 11 levels → step 250
    expect(preview?.levels).toHaveLength(DEFAULT_GRID_SIZE + 1);
    expect(preview?.bandBottom).toBe(48_750);
    expect(preview?.bandTop).toBe(51_250);
    expect(preview?.spacing).toBe(250);
  });

  it("rejects a grid size the engine would refuse (non-integer, out of bounds)", () => {
    expect(computeGridPreview(100, input({ gridSize: 2.5 }))).toBeNull();
    expect(computeGridPreview(100, input({ gridSize: 1 }))).toBeNull();
    expect(computeGridPreview(100, input({ gridSize: 101 }))).toBeNull();
  });

  it("rejects a range outside the engine bounds", () => {
    expect(computeGridPreview(100, input({ gridRange: 0.5 }))).toBeNull();
    expect(computeGridPreview(100, input({ gridRange: 51 }))).toBeNull();
  });

  it("rejects a symbol-less input — levels must never be misattributed", () => {
    expect(computeGridPreview(100, input({ symbol: "" }))).toBeNull();
    expect(computeGridPreview(100, input({ symbol: "   " }))).toBeNull();
  });

  it("rejects a centre price it cannot draw around", () => {
    expect(computeGridPreview(0, input())).toBeNull();
    expect(computeGridPreview(-5, input())).toBeNull();
    expect(computeGridPreview(Number.NaN, input())).toBeNull();
  });

  it("keeps the band inside ±range%/2 at the documented extremes", () => {
    const wide = computeGridPreview(100, input({ gridSize: 2, gridRange: 50 }));
    expect(wide?.bandBottom).toBe(75);
    expect(wide?.bandTop).toBe(125);

    const narrow = computeGridPreview(
      100,
      input({ gridSize: 2, gridRange: 1 })
    );
    expect(narrow?.bandBottom).toBe(99.5);
    expect(narrow?.bandTop).toBe(100.5);
  });
});
