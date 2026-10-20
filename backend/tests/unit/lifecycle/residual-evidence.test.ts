/**
 * Parser contract tests for the residual-evidence parser (PLATFORM_REVIEW §Parser).
 *
 * The parser never decides admission — any `cleanup_incomplete` marker blocks
 * the account, parsed or not. It only decides whether the operator's quantity
 * and symbol must match the text:
 *   - One pair, all occurrences identical  -> parsed   (body must match exactly)
 *   - No pair                             -> unparsed (body is stored; symbol
 *     must be a symbol on the session's runs)
 *   - Two or more different pairs         -> ambiguous (never summed, never
 *     "the larger one", never an implied 0)
 *
 * Quantity tokens are matched as exact decimal strings: `2` and `2.0` are
 * different tokens; the parser never normalizes to IEEE floats.
 *
 * @format
 */

import {
  parseResidualEvidence,
  ResidualEvidence,
} from "../../../src/core/bots/lifecycle/residual-evidence";

const parsedOf = (raw: string): { quantity: string; symbol: string } => {
  const evidence = parseResidualEvidence(raw);
  if (evidence.kind !== "parsed") {
    throw new Error(`expected parsed evidence, got ${evidence.kind}`);
  }
  return { quantity: evidence.quantity, symbol: evidence.symbol };
};

describe("parseResidualEvidence", () => {
  describe("unparsed (no marker or no quantity pair)", () => {
    it("is unparsed when the marker is absent entirely", () => {
      expect(parseResidualEvidence("emergency_stop:FULL_SHUTDOWN")).toEqual({
        kind: "unparsed",
      });
    });

    it("is unparsed for `exposure unknown` (no number in the detail)", () => {
      expect(
        parseResidualEvidence(
          "cleanup_incomplete: exposure unknown after panic flatten"
        )
      ).toEqual({ kind: "unparsed" });
    });

    it("is unparsed for `position unknown` (word, not a quantity)", () => {
      expect(
        parseResidualEvidence(
          "cleanup_incomplete: position unknown BTC still open"
        )
      ).toEqual({ kind: "unparsed" });
    });

    it("is unparsed for `stop failed` (never names a size)", () => {
      expect(
        parseResidualEvidence("cleanup_incomplete: stop failed at venue")
      ).toEqual({ kind: "unparsed" });
    });

    it("rejects non-decimal quantity tokens: 1e2, +2, -1", () => {
      expect(
        parseResidualEvidence(
          "cleanup_incomplete: position 1e2 BTC not flattened"
        )
      ).toEqual({ kind: "unparsed" });
      expect(
        parseResidualEvidence(
          "cleanup_incomplete: position +2 BTC not flattened"
        )
      ).toEqual({ kind: "unparsed" });
      expect(
        parseResidualEvidence(
          "cleanup_incomplete: position -1 BTC not flattened"
        )
      ).toEqual({ kind: "unparsed" });
    });

    it("rejects an empty quantity token (double space before symbol)", () => {
      expect(
        parseResidualEvidence("cleanup_incomplete: position  BTC not flattened")
      ).toEqual({ kind: "unparsed" });
    });
  });

  describe("parsed (one pair, every occurrence identical)", () => {
    it("parses `position <qty> <symbol> not flattened`", () => {
      expect(
        parsedOf(
          "emergency_stop:FULL_SHUTDOWN; cleanup_incomplete: position 2.5 BTC not flattened: lighter create UNRESOLVED for 25732067474944 (submitted, not yet visible)"
        )
      ).toEqual({ quantity: "2.5", symbol: "BTC" });
    });

    it("parses `position <qty> <symbol> still open`", () => {
      expect(
        parsedOf(
          "cleanup_incomplete: position 0.1 ETH still open after panic flatten"
        )
      ).toEqual({ quantity: "0.1", symbol: "ETH" });
    });

    it("parses `position <qty> <symbol> not verified`", () => {
      expect(
        parsedOf(
          "cleanup_incomplete: position 3 SOL not verified after flatten"
        )
      ).toEqual({ quantity: "3", symbol: "SOL" });
    });

    it("parses the re-read-failed shape `(last seen <qty> <symbol>)`", () => {
      expect(
        parsedOf(
          "cleanup_incomplete: position re-read failed after flatten slices (last seen 0.25 ETH): venue timeout"
        )
      ).toEqual({ quantity: "0.25", symbol: "ETH" });
    });

    it("returns the quantity token exactly as written: 2 stays 2, 2.0 stays 2.0", () => {
      expect(
        parsedOf("cleanup_incomplete: position 2 BTC not flattened")
      ).toEqual({ quantity: "2", symbol: "BTC" });
      expect(
        parsedOf("cleanup_incomplete: position 2.0 BTC not flattened")
      ).toEqual({ quantity: "2.0", symbol: "BTC" });
      expect(
        parsedOf("cleanup_incomplete: position 2.50 BTC not flattened")
      ).toEqual({ quantity: "2.50", symbol: "BTC" });
    });

    it("treats two identical occurrences as one pair, not ambiguous", () => {
      expect(
        parsedOf(
          "cleanup_incomplete: position 2 BTC not flattened; re-read says position 2 BTC not flattened"
        )
      ).toEqual({ quantity: "2", symbol: "BTC" });
    });

    it("scans text after `;` (the second shape occurrence is still the same pair)", () => {
      const raw =
        "cleanup_incomplete: position 0.1 ETH still open; then position 0.1 ETH not verified";
      expect(parsedOf(raw)).toEqual({ quantity: "0.1", symbol: "ETH" });
    });

    it("strips exactly one leading `:` or `;` after the marker", () => {
      expect(
        parsedOf("cleanup_incomplete: position 1 BTC not flattened")
      ).toEqual({ quantity: "1", symbol: "BTC" });
      expect(
        parsedOf("cleanup_incomplete; position 1 BTC not flattened")
      ).toEqual({ quantity: "1", symbol: "BTC" });
    });

    it("accepts symbol tokens with dots/dashes/slashes (e.g. 1000PEPE)", () => {
      expect(
        parsedOf("cleanup_incomplete: position 100 1000PEPE not flattened")
      ).toEqual({ quantity: "100", symbol: "1000PEPE" });
      expect(
        parsedOf("cleanup_incomplete: position 1 BTC-USD not flattened")
      ).toEqual({ quantity: "1", symbol: "BTC-USD" });
    });
  });

  describe("ambiguous (two or more different pairs)", () => {
    it("is ambiguous for `2 BTC` and `1 ETH` — never summed, never pick-one", () => {
      const evidence: ResidualEvidence = parseResidualEvidence(
        "cleanup_incomplete: position 2 BTC not flattened; position 1 ETH still open"
      );
      expect(evidence).toEqual({ kind: "ambiguous" });
    });

    it("is ambiguous when the same quantity carries two symbols", () => {
      expect(
        parseResidualEvidence(
          "cleanup_incomplete: position 1 BTC still open; position 1 ETH still open"
        )
      ).toEqual({ kind: "ambiguous" });
    });

    it("is ambiguous when two quantities carry one symbol", () => {
      expect(
        parseResidualEvidence(
          "cleanup_incomplete: position 2 BTC still open; position 3 BTC still open"
        )
      ).toEqual({ kind: "ambiguous" });
    });
  });
});
