/** @format */
import {
  assertTickValid,
  isTickMultiple,
  quantizePrice,
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

  it("throws at the submission boundary for off-tick prices", () => {
    expect(() => assertTickValid("100.03", "0.05")).toThrow(/not a multiple/);
    expect(assertTickValid("100.05", "0.05")).toBe("100.05");
  });
});
