/** @format */

/**
 * derivePriceFormat (Phase 3.1, review P1-2): the historic 2/0.01 fallback,
 * a floor at 2 decimals, real fine-tick prices (the live 1e-7 PEPE case)
 * resolving to 7+, a hard ceiling at 8 so an outlier can't blow up the axis,
 * and scientific-notation-safe digit counting.
 */

import { describe, it, expect } from "vitest";
import {
  derivePriceFormat,
  MAX_PRICE_PRECISION,
  MIN_PRICE_PRECISION,
} from "./derivePriceFormat";

describe("derivePriceFormat", () => {
  it("falls back to the historic 2/0.01 for no usable input", () => {
    expect(derivePriceFormat([])).toEqual({ precision: 2, minMove: 0.01 });
    expect(derivePriceFormat([null, undefined, NaN])).toEqual({
      precision: 2,
      minMove: 0.01,
    });
  });

  it("keeps the 2-decimal floor for coarse prices", () => {
    expect(derivePriceFormat([65000, 123.45, 0.5])).toEqual({
      precision: 2,
      minMove: 0.01,
    });
  });

  it("resolves the live fine-tick case (1e-7 PEPE prices) to 7 decimals", () => {
    // 0.0000012 @ quote_tick 1e-7 — the reviewer's misleading-render case.
    expect(derivePriceFormat([0.0000012, 0.000002])).toEqual({
      precision: 7,
      minMove: 1e-7,
    });
  });

  it("counts scientific-notation inputs as their decimal digits", () => {
    // 1e-7 = 0.0000001 → 7 decimals; 1.5e-4 = 0.00015 → 5 decimals.
    expect(derivePriceFormat([1e-7]).precision).toBe(7);
    expect(derivePriceFormat([1.5e-4]).precision).toBe(5);
  });

  it("clamps at the 8-decimal ceiling regardless of the input", () => {
    expect(derivePriceFormat([0.123456789]).precision).toBe(
      MAX_PRICE_PRECISION
    );
    expect(derivePriceFormat([0.123456789]).minMove).toBe(1e-8);
  });

  it("always reports minMove as 10^-precision", () => {
    const format = derivePriceFormat([0.00123]);
    expect(format).toEqual({ precision: 5, minMove: 1e-5 });
    expect(MIN_PRICE_PRECISION).toBe(2);
  });
});
