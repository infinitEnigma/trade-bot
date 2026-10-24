/** @format */

import { formatNotional } from "../../../../../shared/utils/number";

describe("formatNotional", () => {
  it("preserves a valid zero as $0.00", () => {
    expect(formatNotional("0")).toBe("$0.00");
  });

  it("formats a plain decimal string", () => {
    expect(formatNotional("100")).toBe("$100.00");
  });

  it("formats a fractional decimal string", () => {
    expect(formatNotional("0.5")).toBe("$0.50");
  });

  it("formats a string with surrounding whitespace", () => {
    expect(formatNotional("  12.34  ")).toBe("$12.34");
  });

  it("renders '—' for a missing value", () => {
    expect(formatNotional(null)).toBe("—");
    expect(formatNotional(undefined)).toBe("—");
  });

  it("renders '—' for an empty string", () => {
    expect(formatNotional("")).toBe("—");
  });

  it("renders '—' for non-numeric content", () => {
    expect(formatNotional("abc")).toBe("—");
    expect(formatNotional("12abc")).toBe("—");
    expect(formatNotional("NaN")).toBe("—");
    expect(formatNotional("1/0")).toBe("—"); // division expression — not a number
  });

  it("formats a number that happens to be written with exponent notation", () => {
    // Number('1e3') is a finite, non-negative value → kept (fail-closed only
    // rejects empty, non-finite, and negative inputs).
    expect(formatNotional("1e3")).toBe("$1,000.00");
  });

  it("renders '—' for negative amounts", () => {
    expect(formatNotional("-5")).toBe("—");
    expect(formatNotional("-0.01")).toBe("—");
  });

  it("renders '—' for non-finite values", () => {
    expect(formatNotional("Infinity")).toBe("—");
    expect(formatNotional("1/0")).toBe("—");
  });
});
