/** @format */

import { describe, expect, it } from "vitest";
import {
  computeRunNotionalAllocation,
  parseNotionalAmount,
} from "../../../../../features/strategies/utils/runNotionalAllocation";

describe("parseNotionalAmount", () => {
  it("preserves a valid zero string", () => {
    expect(parseNotionalAmount("0")).toBe(0);
    expect(parseNotionalAmount(" 0 ")).toBe(0);
  });

  it("parses a plain decimal string", () => {
    expect(parseNotionalAmount("100")).toBe(100);
    expect(parseNotionalAmount("0.5")).toBe(0.5);
  });

  it("renders null for missing values", () => {
    expect(parseNotionalAmount(null)).toBeNull();
    expect(parseNotionalAmount(undefined)).toBeNull();
  });

  it("rejects an empty / whitespace-only string", () => {
    expect(parseNotionalAmount("")).toBeNull();
    expect(parseNotionalAmount("   ")).toBeNull();
  });

  it("rejects non-numeric and negative strings", () => {
    expect(parseNotionalAmount("abc")).toBeNull();
    expect(parseNotionalAmount("-5")).toBeNull();
    expect(parseNotionalAmount("Infinity")).toBeNull();
  });

  it("does not throw on a numeric value coming off the wire", () => {
    // The backend can serialize DECIMAL/NUMERIC as a number rather than a
    // string; without String() coercion `.trim()` would throw here.
    expect(parseNotionalAmount(100)).toBe(100);
    expect(parseNotionalAmount(80684.85)).toBe(80684.85);
    expect(parseNotionalAmount(0)).toBe(0);
    expect(parseNotionalAmount(-1)).toBeNull();
  });
});

describe("computeRunNotionalAllocation", () => {
  it("returns no runs when bots have none", () => {
    const result = computeRunNotionalAllocation([{ runs: [] }, {}]);
    expect(result).toEqual({
      hasRuns: false,
      hasInvalid: false,
      overflow: false,
      total: 0,
      count: 0,
    });
  });

  it("sums valid string notionals", () => {
    const result = computeRunNotionalAllocation([
      { runs: [{ notional_amount: "100" }, { notional_amount: "50.5" }] },
    ]);
    expect(result.total).toBe(150.5);
    expect(result.count).toBe(2);
  });

  it("treats a numeric notional as valid instead of throwing", () => {
    const result = computeRunNotionalAllocation([
      { runs: [{ notional_amount: 80684.85 }] },
    ]);
    expect(result.total).toBe(80684.85);
    expect(result.count).toBe(1);
  });

  it("marks invalid when any run is invalid (all-or-nothing)", () => {
    const result = computeRunNotionalAllocation([
      { runs: [{ notional_amount: "100" }, { notional_amount: "abc" }] },
    ]);
    expect(result.hasInvalid).toBe(true);
    expect(result.total).toBeNull();
  });
});
