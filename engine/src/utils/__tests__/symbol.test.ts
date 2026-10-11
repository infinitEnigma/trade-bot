import { normalizeSymbol, symbolsMatch } from "../symbol";

describe("symbolsMatch / normalizeSymbol", () => {
  it("matches the same symbol regardless of case and surrounding whitespace", () => {
    expect(symbolsMatch("ETH_PERP", "eth_perp")).toBe(true);
    expect(symbolsMatch("  eth_perp  ", "ETH_PERP")).toBe(true);
    expect(symbolsMatch("Eth_Perp", "ETH_PERP")).toBe(true);
  });

  it("does not match a different symbol", () => {
    expect(symbolsMatch("ETH_PERP", "BTC_PERP")).toBe(false);
  });

  it("treats an unknown separator/suffix format as NOT a match (fail safe)", () => {
    // Conservative by design: a format we do not normalize must not be guessed
    // into a match, or a flatten could close the wrong market.
    expect(symbolsMatch("ETH-PERP", "ETH_PERP")).toBe(false);
    expect(symbolsMatch("ETHPERP", "ETH_PERP")).toBe(false);
  });

  it("never matches an empty/blank symbol against a real one", () => {
    expect(symbolsMatch("", "ETH_PERP")).toBe(false);
    expect(symbolsMatch("   ", "ETH_PERP")).toBe(false);
    expect(symbolsMatch(undefined as unknown as string, "ETH_PERP")).toBe(
      false
    );
  });

  it("normalizes by trimming and upper-casing", () => {
    expect(normalizeSymbol("  eth_perp ")).toBe("ETH_PERP");
  });
});
