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

/** Product leverage policy for the session cap (env-overridable). */
export function sessionCapLeverage(): number {
  const raw = process.env.SESSION_CAP_LEVERAGE;
  const parsed = raw !== undefined && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export function createSessionCapProvider(): SessionCapProvider {
  return {
    async getSessionCap(
      userId: string,
      exchangeAccountId: string
    ): Promise<number> {
      const account = await exchangeAccountRepositoryAdapter.getAccountWithSecret(
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

      const cap = totalBalance * sessionCapLeverage();
      integrationLogger.debug("Session cap computed", {
        userId,
        exchangeAccountId,
        exchange: account.exchange,
        totalBalance,
        leverage: sessionCapLeverage(),
        cap,
      });
      return cap;
    },
  };
}
