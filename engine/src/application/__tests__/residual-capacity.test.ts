/** @format */

/**
 * Pure-math contract for the engine residual-capacity backstop.
 *
 * The numeric rules MUST stay in lockstep with the backend's
 * `session-cap.provider` suite (leverage default/bound, exposure row rules):
 * a drift means backend and engine gate the same account differently.
 */

import {
  assertEngineResidualCapacity,
  SESSION_CAP_LEVERAGE_DEFAULT,
  SESSION_CAP_LEVERAGE_MAX,
  sessionCapLeverage,
  sessionRequestedNotional,
  sumPositionExposure,
} from "../residual-capacity";

describe("sessionCapLeverage", () => {
  const original = process.env.SESSION_CAP_LEVERAGE;

  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_CAP_LEVERAGE;
    else process.env.SESSION_CAP_LEVERAGE = original;
  });

  it("defaults to the product policy (10) when unset or empty", () => {
    delete process.env.SESSION_CAP_LEVERAGE;
    expect(sessionCapLeverage()).toBe(SESSION_CAP_LEVERAGE_DEFAULT);
    process.env.SESSION_CAP_LEVERAGE = "";
    expect(sessionCapLeverage()).toBe(SESSION_CAP_LEVERAGE_DEFAULT);
  });

  it("reads SESSION_CAP_LEVERAGE from env", () => {
    process.env.SESSION_CAP_LEVERAGE = "5";
    expect(sessionCapLeverage()).toBe(5);
  });

  it("throws (fail-closed) on an invalid SESSION_CAP_LEVERAGE", () => {
    for (const bad of ["0", "-1", "abc", "1e999", "101"]) {
      process.env.SESSION_CAP_LEVERAGE = bad;
      expect(() => sessionCapLeverage()).toThrow(/SESSION_CAP_LEVERAGE/);
    }
  });

  it("keeps the max leverage bound aligned with the backend", () => {
    expect(SESSION_CAP_LEVERAGE_MAX).toBe(100);
  });
});

describe("sumPositionExposure", () => {
  it("sums |qty × mark| across long and short rows", () => {
    expect(
      sumPositionExposure([
        { qty: 0.5, mark: 2000, symbol: "ETH_USDC_PERP" },
        { qty: -2, mark: 100, symbol: "WBTC_USDC_PERP" },
      ])
    ).toBeCloseTo(1000 + 200, 10);
  });

  it("treats flat rows as zero exposure even with a bogus mark", () => {
    expect(
      sumPositionExposure([
        { qty: 0, mark: 0, symbol: "FLAT" },
        { qty: "0", mark: "not-a-number", symbol: "FLAT_STR" },
        { qty: 1, mark: 10, symbol: "OPEN" },
      ])
    ).toBeCloseTo(10, 10);
  });

  it("accepts numeric venue values and numeric strings", () => {
    expect(
      sumPositionExposure([
        { qty: "0.25", mark: "4000", symbol: "ETH" },
        { qty: 2, mark: 50, symbol: "ALT" },
      ])
    ).toBeCloseTo(1000 + 100, 10);
  });

  it("throws when a non-zero quantity has a missing/non-numeric mark", () => {
    for (const mark of [undefined, null, "abc", Number.NaN]) {
      expect(() =>
        sumPositionExposure([{ qty: 1, mark, symbol: "ETH" }])
      ).toThrow(/invalid mark price/);
    }
  });

  it("throws when a non-zero quantity has a non-positive mark", () => {
    for (const mark of [0, -5]) {
      expect(() =>
        sumPositionExposure([{ qty: 1, mark, symbol: "ETH" }])
      ).toThrow(/invalid mark price/);
    }
  });

  it("throws when a non-zero quantity cannot be parsed", () => {
    for (const qty of [undefined, null, "abc", Number.NaN]) {
      expect(() =>
        sumPositionExposure([{ qty, mark: 100, symbol: "ETH" }])
      ).toThrow(/unparseable quantity/);
    }
  });

  it("throws on a non-finite total (overflow guard)", () => {
    expect(() =>
      sumPositionExposure([
        { qty: 1e308, mark: 1e308, symbol: "HUGE" },
        { qty: 1e308, mark: 1e308, symbol: "HUGE2" },
      ])
    ).toThrow(/not a finite number/);
  });
});

describe("sessionRequestedNotional", () => {
  it("sums a session's declared run notionals", () => {
    expect(
      sessionRequestedNotional([
        { runId: "r1", notionalAmount: 250 },
        { runId: "r2", notionalAmount: 750 },
      ])
    ).toBe(1000);
  });

  it("accepts numeric strings on the wire", () => {
    expect(
      sessionRequestedNotional([{ runId: "r1", notionalAmount: "400" }])
    ).toBe(400);
  });

  it("throws (fail-closed) when any run lacks a positive notional", () => {
    for (const bad of [0, -100, undefined, null, Number.NaN, "abc"]) {
      expect(() =>
        sessionRequestedNotional([{ runId: "r1", notionalAmount: bad }])
      ).toThrow(/missing or non-positive notional/);
    }
  });
});

describe("assertEngineResidualCapacity", () => {
  // cap = totalValue(100) × leverage(10) = $1000
  const within = {
    exposure: 400,
    requested: 600,
    totalValue: 100,
    leverage: 10,
  };

  it("admits exposure + requested ≤ cap", () => {
    expect(() => assertEngineResidualCapacity(within)).not.toThrow();
  });

  it("admits at the exact boundary (== cap)", () => {
    expect(() =>
      assertEngineResidualCapacity({ ...within, exposure: 500, requested: 500 })
    ).not.toThrow();
  });

  it("refuses (>) with an ops-readable message carrying the three numbers", () => {
    expect(() =>
      assertEngineResidualCapacity({
        ...within,
        exposure: 400,
        requested: 600.01,
      })
    ).toThrow(
      /Engine residual capacity exceeded: exposure \$400\.00 \+ session \$600\.01 > cap \$1000\.00/
    );
  });

  it("fails closed on a non-finite or non-positive total value", () => {
    for (const totalValue of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        assertEngineResidualCapacity({ ...within, totalValue })
      ).toThrow(/total value/);
    }
  });

  it("fails closed on a negative or NaN exposure / requested", () => {
    expect(() =>
      assertEngineResidualCapacity({ ...within, exposure: -1 })
    ).toThrow(/exposure/);
    expect(() =>
      assertEngineResidualCapacity({ ...within, requested: Number.NaN })
    ).toThrow(/Session notional/);
  });

  it("fails closed on an invalid leverage", () => {
    for (const leverage of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        assertEngineResidualCapacity({ ...within, leverage })
      ).toThrow(/leverage/);
    }
  });

  it("fails closed when the computed cap overflows to Infinity", () => {
    expect(() =>
      assertEngineResidualCapacity({
        exposure: 0,
        requested: 1,
        totalValue: Number.MAX_VALUE,
        leverage: SESSION_CAP_LEVERAGE_MAX,
      })
    ).toThrow(/not a positive finite number/);
  });
});
