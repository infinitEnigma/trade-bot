/** @format */
import {
  assertTickValid,
  isTickMultiple,
  numberToDecimalString,
  quantizePrice,
  quantizePriceNumber,
} from "../price-quantization";

describe("quantizePrice", () => {
  it.each([
    ["1", "100.00", "down", "100"],
    ["0.1", "100.00", "down", "100.0"],
    ["0.01", "100.00", "down", "100.00"],
    ["0.001", "100.00", "down", "100.000"],
    ["0.05", "100.00", "down", "100.00"],
    ["0.05", "100.05", "up", "100.05"],
    ["0.05", "100.03", "down", "100.00"],
    ["0.05", "100.03", "up", "100.05"],
    ["0.01", "100.049", "down", "100.04"],
    ["0.01", "100.049", "up", "100.05"],
    ["0.01", "100.051", "down", "100.05"],
    ["0.01", "100.051", "up", "100.06"],
  ])("tick %s price %s %s -> %s", (tick, price, rounding, expected) => {
    expect(quantizePrice(price, tick, rounding as "down" | "up")).toBe(
      expected
    );
  });

  it("nearest rounds ties up", () => {
    expect(quantizePrice("100.025", "0.05", "nearest")).toBe("100.05");
    expect(quantizePrice("100.024", "0.05", "nearest")).toBe("100.00");
  });

  it("exact ticks pass through for every direction", () => {
    expect(quantizePrice("100.05", "0.05", "down")).toBe("100.05");
    expect(quantizePrice("100.05", "0.05", "up")).toBe("100.05");
  });

  it.each([["0"], ["-0.01"], ["0.00"], ["abc"], [""], ["1.2.3"], ["NaN"]])(
    "rejects bad tick %s",
    tick => {
      expect(() => quantizePrice("100.00", tick, "down")).toThrow();
    }
  );

  it.each([["0"], ["-5"], ["abc"], [""]])("rejects bad price %s", price => {
    expect(() => quantizePrice(price, "0.01", "down")).toThrow();
  });

  it("rejects unknown rounding", () => {
    expect(() => quantizePrice("100.00", "0.01", "round" as never)).toThrow();
  });

  it("never silently defaults to two decimals", () => {
    // tick 1 must not produce "100.03" trimmed to "100.03" nor "100.00" via toFixed.
    expect(quantizePrice("100.7", "1", "down")).toBe("100");
    expect(quantizePrice("100.7", "1", "up")).toBe("101");
  });
});

describe("isTickMultiple / assertTickValid", () => {
  it("distinguishes decimals from tick multiples", () => {
    expect(isTickMultiple("100.00", "0.05")).toBe(true);
    expect(isTickMultiple("100.05", "0.05")).toBe(true);
    expect(isTickMultiple("100.03", "0.05")).toBe(false);
  });

  it("validates the serialized string, not just the number", () => {
    expect(() => assertTickValid("100.03", "0.05")).toThrow(/not a multiple/);
    expect(assertTickValid("100.05", "0.05")).toBe("100.05");
  });
});

describe("precision boundary (number round-trip)", () => {
  it("holds the smallest supported tick (12 dp) without float drift", () => {
    // A 12-dp tick is the documented ceiling (tickSizeFromDecimals <= 12).
    // String inputs stay exact through the bigint-scaled arithmetic.
    expect(quantizePrice("100.000000000001", "0.000000000001", "up")).toBe(
      "100.000000000001"
    );
    expect(isTickMultiple("100.000000000001", "0.000000000001")).toBe(true);
    // Half a 12-dp tick is genuinely off-tick.
    expect(isTickMultiple("100.0000000000005", "0.000000000001")).toBe(false);
  });

  it("keeps a large-but-double-safe price tick-valid through the round-trip", () => {
    // 5e5 is well within IEEE-754's exact 2-dp range (~2e13): numberToDecimal-
    // String's toFixed(12) recovers it exactly and the coarse tick validates.
    expect(numberToDecimalString(500000.25)).toBe("500000.25");
    expect(
      isTickMultiple(quantizePriceNumber(500000.25, "0.05", "down"), "0.05")
    ).toBe(true);
  });

  it("documents the number ceiling: beyond ~1e13 a 2-dp price is not representable", () => {
    // Honest limitation (review P2-b): a JS double cannot hold 2 decimals at
    // 1e9-scale magnitudes, so numberToDecimalString serializes the raw binary
    // value rather than the intended decimal. This is exactly why the engine
    // quantizes to the tick BEFORE submission and validates at the boundary —
    // and why a supported market whose price×tick crosses this ceiling would
    // need canonical decimal strings end-to-end. The engine's own grid is
    // built at the mark price, far below this ceiling.
    expect(numberToDecimalString(1_000_000_000.05)).toBe(
      "1000000000.049999952316"
    );
  });

  it("rejects a tick with precision beyond the 12-dp ceiling rather than silently rounding", () => {
    // The 12-dp ceiling is enforced on the TICK shape: a 13-dp tick is refused.
    expect(() => quantizePrice("100.00", "0.0000000000001", "nearest")).toThrow(
      /excessive precision/
    );
  });

  it("washes float noise so a near-tick price validates as its true value", () => {
    // 100.05 stored as the nearest double reads as 100.0499999999; the
    // number->string wash must recover 100.05 so the boundary accepts it.
    const p = quantizePriceNumber(100.0499999999, "0.05", "nearest");
    expect(numberToDecimalString(p)).toBe("100.05");
    expect(assertTickValid(p, "0.05")).toBe("100.05");
  });
});
