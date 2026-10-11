/** @format */

/**
 * Phase 4: one boundary resolver for grid config.
 *
 * Missing numerics keep historical defaults (legacy call sites omit params);
 * any explicitly present-but-invalid field throws CommandError
 * (non-retryable) instead of trading on a substituted guess. Every rejection
 * below is one the old `Number(x) || default` coercion would have silently
 * admitted (negative grid size, "abc" → 10, 0 → default).
 */

import {
  assertValidGridConfig,
  resolveGridConfig,
} from "../../strategies/grid-config";
import { CommandError } from "../../application/command-error";
import { GridStrategyConfig } from "../../types/strategy";

const BASE = {
  symbol: "PERP_BTC_USDC",
  gridSize: 10,
  gridRange: 5,
  orderQuantity: 1,
};

function rejectsInvalid(raw: Record<string, unknown>, label: RegExp): void {
  expect(() => resolveGridConfig(raw)).toThrow(CommandError);
  try {
    resolveGridConfig(raw);
    throw new Error("expected resolveGridConfig to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).retryable).toBe(false);
    expect((error as Error).message).toMatch(label);
  }
}

describe("resolveGridConfig (Phase 4 boundary)", () => {
  it("resolves a complete valid config", () => {
    expect(resolveGridConfig({ ...BASE, takeProfit: 2 })).toEqual({
      symbol: "PERP_BTC_USDC",
      gridSize: 10,
      gridRangePercent: 5,
      orderQuantity: 1,
      takeProfitPercent: 2,
    });
  });

  it("applies historical defaults for missing numerics", () => {
    expect(resolveGridConfig({ symbol: "ETH" })).toEqual({
      symbol: "ETH",
      gridSize: 10,
      gridRangePercent: 5,
      orderQuantity: 1,
      takeProfitPercent: undefined,
    });
  });

  it("accepts numeric strings (wire payloads carry strings)", () => {
    const resolved = resolveGridConfig({
      symbol: "ETH",
      gridSize: "10",
      gridRange: "5",
      orderQuantity: "1",
    });
    expect(resolved.gridSize).toBe(10);
    expect(resolved.gridRangePercent).toBe(5);
    expect(resolved.orderQuantity).toBe(1);
  });

  it("rejects negative grid size (old code: survived the || 10 fallback)", () => {
    rejectsInvalid({ ...BASE, gridSize: -5 }, /gridSize/);
  });

  it("rejects non-integer, zero, oversized grid size", () => {
    rejectsInvalid({ ...BASE, gridSize: 2.5 }, /integer/);
    rejectsInvalid({ ...BASE, gridSize: 0 }, /gridSize/);
    rejectsInvalid({ ...BASE, gridSize: 1 }, /gridSize/);
    rejectsInvalid({ ...BASE, gridSize: 101 }, /gridSize/);
    rejectsInvalid({ ...BASE, gridSize: "abc" }, /finite/);
    rejectsInvalid({ ...BASE, gridSize: NaN }, /finite/);
    rejectsInvalid({ ...BASE, gridSize: true }, /finite/);
  });

  it("rejects zero/negative/oversized/non-numeric grid range", () => {
    rejectsInvalid({ ...BASE, gridRange: 0 }, /gridRange/);
    rejectsInvalid({ ...BASE, gridRange: -3 }, /gridRange/);
    rejectsInvalid({ ...BASE, gridRange: 51 }, /gridRange/);
    rejectsInvalid({ ...BASE, gridRange: "wide" }, /finite/);
    rejectsInvalid({ ...BASE, gridRange: Infinity }, /finite/);
  });

  it("rejects zero/negative/non-numeric order quantity", () => {
    rejectsInvalid({ ...BASE, orderQuantity: 0 }, /orderQuantity/);
    rejectsInvalid({ ...BASE, orderQuantity: -1 }, /orderQuantity/);
    rejectsInvalid({ ...BASE, orderQuantity: "lots" }, /finite/);
    rejectsInvalid({ ...BASE, orderQuantity: NaN }, /finite/);
  });

  it("rejects empty symbol (whitespace included)", () => {
    rejectsInvalid({ ...BASE, symbol: "" }, /symbol/i);
    rejectsInvalid({ ...BASE, symbol: "   " }, /symbol/i);
    rejectsInvalid({ gridSize: 10 }, /symbol/i);
  });

  it("rejects non-positive takeProfit, allows omission", () => {
    rejectsInvalid({ ...BASE, takeProfit: 0 }, /takeProfit/);
    rejectsInvalid({ ...BASE, takeProfit: -2 }, /takeProfit/);
    expect(resolveGridConfig(BASE).takeProfitPercent).toBeUndefined();
  });

  it("assertValidGridConfig mirrors the boundary for direct construction", () => {
    expect(() =>
      assertValidGridConfig({
        symbol: "ETH",
        gridSize: 10,
        gridRangePercent: 5,
        orderQuantity: 1,
      } as GridStrategyConfig)
    ).not.toThrow();
    expect(() =>
      assertValidGridConfig({
        symbol: "ETH",
        gridSize: -5,
        gridRangePercent: 5,
        orderQuantity: 1,
      } as GridStrategyConfig)
    ).toThrow(CommandError);
    expect(() =>
      assertValidGridConfig({
        symbol: "",
        gridSize: 10,
        gridRangePercent: 5,
        orderQuantity: 1,
      } as GridStrategyConfig)
    ).toThrow(CommandError);
  });
});
