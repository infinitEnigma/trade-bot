/**
 * Admission policy configuration — the per-order notional limits and the
 * freshness/tolerance budgets.
 *
 * The per-order policy is UNSET BY DEFAULT on purpose: a missing limit is a
 * control that cannot decide, so the admission fails closed rather than
 * silently allowing. A malformed configuration must surface as an operational
 * error, never as a disabled check.
 */

import {
  admissionPolicyFromEnv,
  describeEffectiveAdmissionPolicy,
  parseMaxOrderNotionalBySymbol,
  symbolNotionalPolicyFromEnv,
  symbolNotionalPolicyLimitsFromEnv,
} from "../../src/core/strategies/admission/admission-policy.config";

describe("parseMaxOrderNotionalBySymbol", () => {
  it("is empty when unset (no cap configured)", () => {
    expect(parseMaxOrderNotionalBySymbol(undefined)).toEqual({});
    expect(parseMaxOrderNotionalBySymbol("")).toEqual({});
    expect(parseMaxOrderNotionalBySymbol("   ")).toEqual({});
  });

  it("parses SYMBOL=AMOUNT pairs", () => {
    expect(parseMaxOrderNotionalBySymbol("BTC=5000,ETH=2500")).toEqual({
      BTC: 5000,
      ETH: 2500,
    });
  });

  it("upper-cases the symbol", () => {
    expect(parseMaxOrderNotionalBySymbol("btc=5000")).toEqual({ BTC: 5000 });
  });

  it("tolerates whitespace", () => {
    expect(parseMaxOrderNotionalBySymbol(" BTC = 5000 , ETH = 100 ")).toEqual({
      BTC: 5000,
      ETH: 100,
    });
  });

  it("throws on a malformed entry (a typo must not disable the control)", () => {
    expect(() => parseMaxOrderNotionalBySymbol("BTC")).toThrow(
      /expected SYMBOL=AMOUNT/
    );
    expect(() => parseMaxOrderNotionalBySymbol("=5000")).toThrow(
      /SYMBOL=AMOUNT/
    );
    expect(() => parseMaxOrderNotionalBySymbol("BTC=")).toThrow(
      /SYMBOL=AMOUNT/
    );
  });

  it("throws on a non-positive or non-finite amount", () => {
    expect(() => parseMaxOrderNotionalBySymbol("BTC=0")).toThrow(
      /positive finite/
    );
    expect(() => parseMaxOrderNotionalBySymbol("BTC=-5")).toThrow(
      /positive finite/
    );
    expect(() => parseMaxOrderNotionalBySymbol("BTC=abc")).toThrow(
      /positive finite/
    );
  });
});

describe("symbolNotionalPolicyLimitsFromEnv", () => {
  it("has NO default cap when nothing is configured", () => {
    const limits = symbolNotionalPolicyLimitsFromEnv({});
    expect(limits.defaultMaxOrderNotional).toBeNull();
    expect(limits.maxOrderNotionalBySymbol).toEqual({});
  });

  it("reads the configured default and per-symbol caps", () => {
    const limits = symbolNotionalPolicyLimitsFromEnv({
      MAX_ORDER_NOTIONAL_DEFAULT: "2500",
      MAX_ORDER_NOTIONAL_BY_SYMBOL: "BTC=5000",
    });
    expect(limits.defaultMaxOrderNotional).toBe(2500);
    expect(limits.maxOrderNotionalBySymbol).toEqual({ BTC: 5000 });
  });

  it("throws on an invalid default", () => {
    expect(() =>
      symbolNotionalPolicyLimitsFromEnv({ MAX_ORDER_NOTIONAL_DEFAULT: "0" })
    ).toThrow(/positive finite/);
  });
});

describe("symbolNotionalPolicyFromEnv", () => {
  it("refuses an unconfigured symbol (fail closed, not allowed)", () => {
    const policy = symbolNotionalPolicyFromEnv({});
    const verdict = policy.evaluateOrder("BTC", 100);
    expect(verdict.allowed).toBe(false);
    expect(verdict.rejection).toBe("POLICY_NOT_CONFIGURED");
  });

  it("enforces a configured symbol cap", () => {
    const policy = symbolNotionalPolicyFromEnv({
      MAX_ORDER_NOTIONAL_BY_SYMBOL: "BTC=5000",
    });
    expect(policy.evaluateOrder("BTC", 4999).allowed).toBe(true);
    expect(policy.evaluateOrder("BTC", 5001).allowed).toBe(false);
  });
});

describe("admissionPolicyFromEnv", () => {
  it("uses the documented defaults when unset", () => {
    const policy = admissionPolicyFromEnv({});
    expect(policy.maxPriceAgeMs).toBe(30_000);
    expect(policy.priceRelativeTolerance).toBe(0.02);
    expect(policy.estimateRelativeTolerance).toBe(0.01);
  });

  it("reads overrides", () => {
    const policy = admissionPolicyFromEnv({
      ADMISSION_MAX_PRICE_AGE_MS: "5000",
      ADMISSION_PRICE_TOLERANCE: "0.5",
      ADMISSION_ESTIMATE_TOLERANCE: "0.25",
    });
    expect(policy.maxPriceAgeMs).toBe(5000);
    expect(policy.priceRelativeTolerance).toBe(0.5);
    expect(policy.estimateRelativeTolerance).toBe(0.25);
  });

  it("throws on an invalid override", () => {
    expect(() =>
      admissionPolicyFromEnv({ ADMISSION_MAX_PRICE_AGE_MS: "abc" })
    ).toThrow(/positive finite/);
    expect(() =>
      admissionPolicyFromEnv({ ADMISSION_PRICE_TOLERANCE: "-1" })
    ).toThrow(/positive finite/);
  });
});

describe("describeEffectiveAdmissionPolicy", () => {
  it("exposes the effective limits and budgets without secrets", () => {
    const described = describeEffectiveAdmissionPolicy({
      MAX_ORDER_NOTIONAL_BY_SYMBOL: "BTC=5000",
      ADMISSION_MAX_PRICE_AGE_MS: "5000",
    });
    expect(described.maxOrderNotionalBySymbol).toEqual({ BTC: 5000 });
    expect(described.defaultMaxOrderNotional).toBeNull();
    expect(described.maxPriceAgeMs).toBe(5000);
  });
});
