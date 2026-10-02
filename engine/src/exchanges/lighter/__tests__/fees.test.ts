/** @format */

/**
 * Phase-1 fee sourcing tests: the account tier → rate mapping.
 *
 * Pure module — no network, no sidecar. The fixture is the exact body
 * `GET /api/v1/accountLimits` returned for the testnet account on 2026-10-02.
 */

import {
  LIGHTER_FEE_SCHEDULE,
  parseLighterAccountTier,
  resolveLighterFeeRates,
} from "../fees";

const LIVE_STANDARD = {
  code: 200,
  max_llp_percentage: 100,
  max_llp_amount: "0.000000",
  user_tier: "standard",
  can_create_public_pool: false,
  user_tier_name: "standard",
  current_maker_fee_tick: 0,
  current_taker_fee_tick: 0,
  leased_lit: "0.00000000",
  effective_lit_stakes: "0.00000000",
  user_tier_last_update: 0,
};

describe("parseLighterAccountTier", () => {
  it.each([
    ["std", "standard"],
    ["standard", "standard"],
    ["Standard", "standard"],
    [" plus ", "plus"],
    ["PREMIUM", "premium"],
  ])("maps %p to %p", (raw, expected) => {
    expect(parseLighterAccountTier(raw)).toBe(expected);
  });

  it("refuses anything else (never a guessed tier)", () => {
    for (const raw of ["gold", "", null, undefined, 7, {}]) {
      expect(parseLighterAccountTier(raw)).toBeUndefined();
    }
  });
});

describe("resolveLighterFeeRates", () => {
  it("books a Standard account at the venue's zero-fee rate", () => {
    // The venue charges no maker/taker fee on Standard accounts (the default),
    // which is what `current_*_fee_tick = 0` on the live body encodes.
    expect(resolveLighterFeeRates(LIVE_STANDARD)).toMatchObject({
      makerRate: 0,
      takerRate: 0,
      tier: "standard",
      venueReported: true,
      exact: true,
    });
  });

  it("prices Plus at 0.005% on both sides", () => {
    const rates = resolveLighterFeeRates({ user_tier_name: "plus" });
    expect(rates.makerRate).toBe(0.00005);
    expect(rates.takerRate).toBe(0.00005);
    expect(rates.venueReported).toBe(true);
    expect(rates.exact).toBe(true);
  });

  it("uses the undiscounted Premium base, flagging staked LIT as an upper bound", () => {
    const base = resolveLighterFeeRates({
      user_tier_name: "premium",
      effective_lit_stakes: "0.00000000",
    });
    expect(base).toMatchObject({
      makerRate: 0.00004,
      takerRate: 0.00028,
      exact: true,
    });

    const staked = resolveLighterFeeRates({
      user_tier_name: "premium",
      effective_lit_stakes: "10000.00000000",
    });
    expect(staked.makerRate).toBe(0.00004);
    expect(staked.takerRate).toBe(0.00028);
    expect(staked.venueReported).toBe(true);
    // The discount is not applied, so the rate can only overstate the fee.
    expect(staked.exact).toBe(false);
    expect(staked.basis).toContain("NOT applied");
  });

  it("falls back to the worst published rate — never a silent zero", () => {
    const rates = resolveLighterFeeRates({ user_tier_name: "mystery" });
    expect(rates.venueReported).toBe(false);
    expect(rates.exact).toBe(false);
    expect(rates.makerRate).toBe(LIGHTER_FEE_SCHEDULE.premium.makerRate);
    expect(rates.takerRate).toBe(LIGHTER_FEE_SCHEDULE.premium.takerRate);
    expect(rates.takerRate).toBeGreaterThan(0);
    expect(rates.tier).toBe("mystery");
    expect(rates.basis).toContain("unmapped");
  });

  it("treats an empty/garbage body as unmapped, not as zero-fee", () => {
    for (const body of [undefined, null, {}, { user_tier_name: 12 }]) {
      const rates = resolveLighterFeeRates(body);
      expect(rates.venueReported).toBe(false);
      expect(rates.takerRate).toBeGreaterThan(0);
    }
  });

  it("prices a fill's fee as notional × rate with bps fidelity", () => {
    // 0.01 ETH @ 2764.01 = 27.6401 USDC notional; Premium taker = 0.028% =
    // 2.8 bps.
    const notional = 0.01 * 2764.01;
    const { takerRate } = resolveLighterFeeRates({ user_tier_name: "premium" });
    expect(notional * takerRate).toBeCloseTo(0.007739228, 9);
  });
});
