/** @format */

/**
 * F1 notional admission — default SessionCapProvider.
 *
 * Contract:
 * - cap = totalBalance × SESSION_CAP_LEVERAGE (default 10, env-overridable).
 * - account-scoped: kodiak → kodiakIntegrationService.getBalance(userId, id);
 *   lighter → getLighterBalance(userId, id) — never user-aggregate.
 * - fail-CLOSED: unsupported venue, reader failure, or non-positive balance
 *   THROW (the service maps this to a 503 refusal).
 */

jest.mock(
  "../../src/infrastructure/external/kodiak-integration.service",
  () => ({
    kodiakIntegrationService: { getBalance: jest.fn() },
  })
);
jest.mock("../../src/infrastructure/external/lighter/portfolio", () => ({
  getLighterBalance: jest.fn(),
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
import { getLighterBalance } from "../../src/infrastructure/external/lighter/portfolio";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";
import {
  createSessionCapProvider,
  sessionCapLeverage,
} from "../../src/infrastructure/external/exchange-accounts/session-cap.provider";

const getAccountWithSecret =
  exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock;
const kodiakBalance = kodiakIntegrationService.getBalance as jest.Mock;
const lighterBalance = getLighterBalance as jest.Mock;

const kodiakAccount = { id: "acc-1", exchange: "kodiak" };
const lighterAccount = { id: "acc-1", exchange: "lighter" };

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

  it("kodiak: cap = totalBalance × leverage, account-scoped", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "1000" },
    });

    const cap = await createSessionCapProvider().getSessionCap("u1", "acc-1");

    expect(cap).toBe(10000);
    expect(kodiakBalance).toHaveBeenCalledWith("u1", "acc-1");
  });

  it("lighter: cap = totalBalance × leverage, account-scoped", async () => {
    getAccountWithSecret.mockResolvedValue(lighterAccount);
    lighterBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "500" },
    });

    const cap = await createSessionCapProvider().getSessionCap("u1", "acc-1");

    expect(cap).toBe(5000);
    expect(lighterBalance).toHaveBeenCalledWith("u1", "acc-1");
  });

  it("fails closed on an unsupported venue", async () => {
    getAccountWithSecret.mockResolvedValue({
      id: "acc-1",
      exchange: "binance",
    });

    await expect(
      createSessionCapProvider().getSessionCap("u1", "acc-1")
    ).rejects.toThrow(/Unsupported venue/);
  });

  it("fails closed when the balance reader errors", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({ success: false, error: "venue down" });

    await expect(
      createSessionCapProvider().getSessionCap("u1", "acc-1")
    ).rejects.toThrow(/balance unavailable/);
  });

  it("fails closed on a non-positive balance", async () => {
    getAccountWithSecret.mockResolvedValue(kodiakAccount);
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "0" },
    });

    await expect(
      createSessionCapProvider().getSessionCap("u1", "acc-1")
    ).rejects.toThrow(/Non-positive or unreadable balance/);
  });

  it("fails closed when the account cannot be resolved", async () => {
    getAccountWithSecret.mockResolvedValue(null);

    await expect(
      createSessionCapProvider().getSessionCap("u1", "acc-1")
    ).rejects.toThrow(/No exchange account/);
  });
});
