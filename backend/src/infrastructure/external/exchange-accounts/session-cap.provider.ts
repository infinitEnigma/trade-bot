/** @format */

/**
 * F1 notional admission — default, account-scoped, fail-closed session-cap
 * provider.
 *
 * The cap a lifecycle session may expose = `totalBalance × leverage` for the
 * bound exchange account. Balance is read account-scoped (never user-aggregate)
 * so a user with several venue accounts is capped per the account the session
 * actually trades on:
 * - kodiak  → `kodiakIntegrationService.getBalance(userId, exchangeAccountId)`
 * - lighter → `getLighterBalance(userId, exchangeAccountId)`
 *
 * FAIL-CLOSED: an unsupported venue, an unreadable balance, or a venue error
 * THROWS, so `BotLifecycleService` refuses the write (503) rather than
 * admitting an unbounded notional. Never returns a sentinel like `null`/`0`.
 *
 * This is a notional-INTENT gate: `balance` is total equity (`totalBalance`)
 * — neither venue reader currently exposes free/available collateral, and open
 * venue positions are NOT subtracted. True residual capacity is the deferred
 * PositionValidator work. `leverage` is a product policy constant
 * (`SESSION_CAP_LEVERAGE`, default 10), not the per-strategy leverage, since a
 * session can host runs with differing configs.
 */

import type { SessionCapProvider } from "../../../core/bots/bot-lifecycle.service";
import { integrationLogger } from "../../../core/logging/context-aware-logger.service";
import { exchangeAccountRepositoryAdapter } from "../../adapters/repositories/exchange-account-repository.adapter";
import { kodiakIntegrationService } from "../kodiak-integration.service";
import { getLighterBalance } from "../lighter/portfolio";

/**
 * Upper bound for the configured session-cap leverage. Prevents a large
 * `SESSION_CAP_LEVERAGE` from multiplying a balance into `Infinity` (which
 * would make the `total > cap` comparison false and silently disable the cap).
 */
export const SESSION_CAP_LEVERAGE_MAX = 100;

/** Product leverage policy for the session cap (env-overridable). */
export function sessionCapLeverage(): number {
  const raw = process.env.SESSION_CAP_LEVERAGE;
  // Unset/empty → the documented default. A *set but invalid* value throws
  // (fail-closed) rather than silently reverting to the default, so a typo
  // like "1e999" or "0" surfaces as an operational error, not a disabled cap.
  if (raw === undefined || raw === "") return 10;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid SESSION_CAP_LEVERAGE "${raw}": must be a positive finite number`
    );
  }
  if (parsed > SESSION_CAP_LEVERAGE_MAX) {
    throw new Error(
      `SESSION_CAP_LEVERAGE ${parsed} exceeds the maximum allowed ${SESSION_CAP_LEVERAGE_MAX}`
    );
  }
  return parsed;
}

export function createSessionCapProvider(): SessionCapProvider {
  return {
    async getSessionCap(
      userId: string,
      exchangeAccountId: string
    ): Promise<number> {
      const account =
        await exchangeAccountRepositoryAdapter.getAccountWithSecret(
          userId,
          exchangeAccountId
        );
      if (!account) {
        throw new Error(
          `No exchange account ${exchangeAccountId} for user; cannot determine session cap`
        );
      }

      let totalBalance: number;
      if (account.exchange === "kodiak") {
        const res = await kodiakIntegrationService.getBalance(
          userId,
          exchangeAccountId
        );
        if (!res.success || !res.data) {
          throw new Error(
            `Kodiak balance unavailable for account ${exchangeAccountId}: ${
              res.error || "no data"
            }`
          );
        }
        totalBalance = Number(res.data.totalBalance);
      } else if (account.exchange === "lighter") {
        const res = await getLighterBalance(userId, exchangeAccountId);
        if (!res.success || !res.data) {
          throw new Error(
            `Lighter balance unavailable for account ${exchangeAccountId}: ${
              res.error || "no data"
            }`
          );
        }
        totalBalance = Number(res.data.totalBalance);
      } else {
        throw new Error(
          `Unsupported venue "${account.exchange}" for session cap (account ${exchangeAccountId})`
        );
      }

      if (!Number.isFinite(totalBalance) || totalBalance <= 0) {
        throw new Error(
          `Non-positive or unreadable balance (${totalBalance}) for account ${exchangeAccountId}`
        );
      }

      const leverage = sessionCapLeverage();
      const cap = totalBalance * leverage;
      // Belt-and-suspenders: even with a bounded leverage, an extreme balance
      // could overflow. A non-finite cap would make `total > cap` false and
      // silently disable admission — refuse instead (fail-closed).
      if (!Number.isFinite(cap) || cap <= 0) {
        throw new Error(
          `Computed session cap is not a positive finite number (balance=${totalBalance}, leverage=${leverage}) for account ${exchangeAccountId}`
        );
      }
      integrationLogger.debug("Session cap computed", {
        userId,
        exchangeAccountId,
        exchange: account.exchange,
        totalBalance,
        leverage,
        cap,
      });
      return cap;
    },
  };
}
