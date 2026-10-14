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
    // 5e5 is well within IEEE-754's exact 2-dp range (~2e13): the noise wash
    // recovers it exactly and the coarse tick validates.
    expect(numberToDecimalString(500000.25)).toBe("500000.25");
    expect(
      isTickMultiple(quantizePriceNumber(500000.25, "0.05", "down"), "0.05")
    ).toBe(true);
  });

  it("washes arithmetic float noise so a computed price cannot drift a tick (C3)", () => {
    // REGRESSION: 98 * 1.02 === 99.96000000000001 — noise 0.64 ulp ABOVE the
    // 99.96 boundary. A pure shortest round-trip keeps it, and a round-up
    // quantize then lands one tick HIGH (99.97 instead of 99.96 — grid-partial
    // C3 exit pricing). The wash must snap sub-ulp arithmetic noise back to
    // the intended decimal, which the pre-BTC-fix toFixed(12) did implicitly.
    expect(numberToDecimalString(98 * 1.02)).toBe("99.96");
    expect(quantizePriceNumber(98 * 1.02, "0.01", "up")).toBe(99.96);
    expect(isTickMultiple(98 * 1.02, "0.01")).toBe(true);
  });

  it("never washes away a genuinely distinct high-precision price", () => {
    // ~8800 ulps from 1000 — far outside the ~4-ulp noise band. A 12-dp tick
    // price at magnitude 1000 must survive the wash intact: only sub-ulp
    // noise snaps, never a real decimal.
    expect(numberToDecimalString(1000.000000000001)).toBe("1000.000000000001");
  });

  it("keeps a BTC-scale price tick-valid through the number round-trip (prod 2026-10-14)", () => {
    // REGRESSION: at BTC magnitude (~84k) `toFixed(12)` re-exposed binary float
    // noise (`83879.4.toFixed(12)` === "83879.399999999994"), so the exact
    // integer-modulo validator refused EVERY grid BUY — a price that IS an
    // exact 0.1 multiple was rejected. The shortest round-trip wash recovers
    // the clean decimal, so the boundary now accepts it.
    expect(numberToDecimalString(83879.4)).toBe("83879.4");
    expect(
      isTickMultiple(quantizePriceNumber(83879.4, "0.1", "down"), "0.1")
    ).toBe(true);
    // The defense-in-depth gate (grid requireTickValid) must not throw on these.
    expect(() => assertTickValid(83879.4, "0.1")).not.toThrow();
    expect(() => assertTickValid(84505.4, "0.1")).not.toThrow();
    // A genuinely off-tick BTC price is still refused (fail-closed intact).
    expect(isTickMultiple(83879.45, "0.1")).toBe(false);
  });

  it("recovers the clean decimal at 1e9 scale via shortest round-trip", () => {
    // The shortest round-trip form (`String(1e9+0.05)`) recovers the intended
    // decimal, so a coarse tick validates. This is MORE correct than the old
    // toFixed(12) serialization, which exposed the raw binary
    // ("1000000000.049999952316") and would have refused a valid price. The
    // engine's own grid is built at the mark price, far below this ceiling.
    expect(numberToDecimalString(1_000_000_000.05)).toBe("1000000000.05");
  });

  it("expands micro-tick exponent notation to plain decimal (Kodiak 1e-7)", () => {
    // String(1e-7) === "1e-7"; the strict decimal parser rejects exponents, so
    // numberToDecimalString must expand to "0.0000001" (Kodiak PERP_1000PEPE).
    expect(numberToDecimalString(1e-7)).toBe("0.0000001");
    expect(numberToDecimalString(9.9e-7)).toBe("0.00000099");
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
