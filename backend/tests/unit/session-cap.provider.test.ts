/** @format */

/**
 * F1 notional admission — default SessionCapProvider (residual capacity).
 *
 * Contract:
 * - snapshot = { cap, existingExposure }; cap = totalBalance × SESSION_CAP_LEVERAGE
 *   (default 10, env-overridable); existingExposure = Σ |qty × markPrice| over the
 *   account's OPEN venue positions.
 * - account-scoped: kodiak → kodiakIntegrationService.getBalance/getPositions
 *   (userId, id); lighter → getLighterBalance/getLighterPositions(userId, id) —
 *   never user-aggregate.
 * - fail-CLOSED: unsupported venue, balance reader failure, unavailable
 *   positions, non-positive balance, or an open position that cannot be priced
 *   THROW (the service maps this to a 503 refusal). Flat rows contribute 0.
 */

jest.mock(
  "../../src/infrastructure/external/kodiak-integration.service",
  () => ({
    kodiakIntegrationService: {
      getBalance: jest.fn(),
      getPositions: jest.fn(),
    },
  })
);
jest.mock("../../src/infrastructure/external/lighter/portfolio", () => ({
  getLighterBalance: jest.fn(),
  getLighterPositions: jest.fn(),
}));
jest.mock(
  "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      getAccountWithSecret: jest.fn(),
    },
  })
);

import { kodiakIntegrationService } from "../../src/infrastructure/external/kodiak-integration.service";
import {
  getLighterBalance,
  getLighterPositions,
} from "../../src/infrastructure/external/lighter/portfolio";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";
import {
  createSessionCapProvider,
  sessionCapLeverage,
  sumPositionExposure,
} from "../../src/infrastructure/external/exchange-accounts/session-cap.provider";

const getAccountWithSecret =
  exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock;
const kodiakBalance = kodiakIntegrationService.getBalance as jest.Mock;
const kodiakPositions = kodiakIntegrationService.getPositions as jest.Mock;
const lighterBalance = getLighterBalance as jest.Mock;
const lighterPositions = getLighterPositions as jest.Mock;

const kodiakAccount = { id: "acc-1", exchange: "kodiak" };
const lighterAccount = { id: "acc-1", exchange: "lighter" };

/** Cap-only tests run against a flat (empty) position book. */
const flatKodiak = () =>
  kodiakPositions.mockResolvedValue({ success: true, data: [] });
const flatLighter = () =>
  lighterPositions.mockResolvedValue({ success: true, data: { rows: [] } });

describe("SessionCapProvider (F1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SESSION_CAP_LEVERAGE;
  });

  it("defaults leverage to 10", () => {
    expect(sessionCapLeverage()).toBe(10);
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

  it("fails closed when the computed cap would overflow to Infinity", async () => {
    process.env.SESSION_CAP_LEVERAGE = "100"; // max allowed
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1e308" }, // ×100 → Infinity
    });
    flatKodiak();

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/not a positive finite number/);
  });

  it("kodiak: cap = totalBalance × leverage, account-scoped", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1000" },
    });
    flatKodiak();

    const snapshot = await createSessionCapProvider().getAdmissionSnapshot(
      "u1",
      "acc-1"
    );

    expect(snapshot).toEqual({ cap: 10000, existingExposure: 0 });
    expect(kodiakBalance).toHaveBeenCalledWith("u1", "acc-1");
    expect(kodiakPositions).toHaveBeenCalledWith("u1", "acc-1");
  });

  it("lighter: cap = totalBalance × leverage, account-scoped", async () => {
    getAccountWithSecret.mockResolvedValue(lighterAccount);
    lighterBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "500" },
    });
    flatLighter();

    const snapshot = await createSessionCapProvider().getAdmissionSnapshot(
      "u1",
      "acc-1"
    );

    expect(snapshot).toEqual({ cap: 5000, existingExposure: 0 });
    expect(lighterBalance).toHaveBeenCalledWith("u1", "acc-1");
    expect(lighterPositions).toHaveBeenCalledWith("u1", "acc-1");
  });

  it("kodiak: existingExposure = Σ |positionAmt × markPrice| (longs, shorts, flat)", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1000" },
    });
    kodiakPositions.mockResolvedValue({
      success: true,
      data: [
        { symbol: "PERP_BTC_USDC", positionAmt: "0.5", markPrice: "2000" }, // 1,000 long
        { symbol: "PERP_ETH_USDC", positionAmt: "-0.25", markPrice: "4000" }, // 1,000 short
        { symbol: "PERP_FLAT_USDC", positionAmt: "0", markPrice: "0" }, // flat
      ],
    });

    const snapshot = await createSessionCapProvider().getAdmissionSnapshot(
      "u1",
      "acc-1"
    );

    // Cap 10,000; open positions eat 2,000 of headroom.
    expect(snapshot).toEqual({ cap: 10000, existingExposure: 2000 });
  });

  it("lighter: existingExposure = Σ |position_qty × mark_price|", async () => {
    getAccountWithSecret.mockResolvedValue(lighterAccount);
    lighterBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "500" },
    });
    lighterPositions.mockResolvedValue({
      success: true,
      data: {
        rows: [{ symbol: "ETH", position_qty: "2", mark_price: "100" }],
      },
    });

    const snapshot = await createSessionCapProvider().getAdmissionSnapshot(
      "u1",
      "acc-1"
    );

    expect(snapshot).toEqual({ cap: 5000, existingExposure: 200 });
  });

  it("fails closed on an unsupported venue", async () => {
    getAccountWithSecret.mockResolvedValue({
      id: "acc-1",
      exchange: "binance",
    });

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/Unsupported venue/);
  });

  it("fails closed when the balance reader errors", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({ success: false, error: "venue down" });
    flatKodiak();

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/balance unavailable/);
  });

  it("fails closed (503) when the kodiak positions reader is down", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1000" },
    });
    kodiakPositions.mockResolvedValue({
      success: false,
      error: "positions endpoint down",
    });

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/positions unavailable/);
  });

  it("fails closed (503) when the lighter positions reader is down", async () => {
    getAccountWithSecret.mockResolvedValue(lighterAccount);
    lighterBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1000" },
    });
    lighterPositions.mockResolvedValue({
      success: false,
      error: "positions endpoint down",
    });

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/positions unavailable/);
  });

  it("fails closed when an open position has a missing/invalid mark", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1000" },
    });
    kodiakPositions.mockResolvedValue({
      success: true,
      data: [
        { symbol: "PERP_BTC_USDC", positionAmt: "0.5", markPrice: "" }, // open but unpriceable
      ],
    });

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/invalid mark price/);
  });

  it("fails closed when an open position has an unparseable quantity", async () => {
    getAccountWithSecret.mockResolvedValue(lighterAccount);
    lighterBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1000" },
    });
    lighterPositions.mockResolvedValue({
      success: true,
      data: {
        rows: [{ symbol: "ETH", position_qty: "abc", mark_price: "100" }],
      },
    });

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/unparseable quantity/);
  });

  it("fails closed on a non-positive balance", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "0" },
    });
    flatKodiak();

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/Non-positive or unreadable balance/);
  });

  it("fails closed when the account cannot be resolved", async () => {
    getAccountWithSecret.mockResolvedValue(null);

    await expect(
      createSessionCapProvider().getAdmissionSnapshot("u1", "acc-1")
    ).rejects.toThrow(/No exchange account/);
  });
});

describe("sumPositionExposure (F1 exposure math)", () => {
  it("sums absolute notionals across long and short rows", () => {
    expect(
      sumPositionExposure(
        [
          { qty: "1", mark: "50000", symbol: "BTC" },
          { qty: "-0.5", mark: "3000", symbol: "ETH" },
        ],
        "acc-1"
      )
    ).toBe(51500);
  });

  it("accepts numeric (non-string) venue values", () => {
    expect(
      sumPositionExposure([{ qty: 2, mark: 100.5, symbol: "ETH" }], "acc-1")
    ).toBe(201);
  });

  it("treats flat rows (qty 0) as zero exposure even with a bogus mark", () => {
    expect(
      sumPositionExposure(
        [
          { qty: "0", mark: "", symbol: "FLAT" },
          { qty: "0", mark: "9999", symbol: "FLAT2" },
        ],
        "acc-1"
      )
    ).toBe(0);
  });

  it("throws when a non-zero quantity has a null/undefined/empty mark", () => {
    for (const mark of [null, undefined, "", "   "]) {
      expect(() =>
        sumPositionExposure([{ qty: "0.5", mark, symbol: "BTC" }], "acc-1")
      ).toThrow(/invalid mark price/);
    }
  });

  it("throws when a non-zero quantity has a non-positive mark", () => {
    for (const mark of ["0", "-100", 0]) {
      expect(() =>
        sumPositionExposure([{ qty: "0.5", mark, symbol: "BTC" }], "acc-1")
      ).toThrow(/invalid mark price/);
    }
  });

  it("throws when the quantity cannot be parsed", () => {
    for (const qty of ["abc", "", null, undefined]) {
      expect(() =>
        sumPositionExposure([{ qty, mark: "100", symbol: "BTC" }], "acc-1")
      ).toThrow(/unparseable quantity/);
    }
  });
});
