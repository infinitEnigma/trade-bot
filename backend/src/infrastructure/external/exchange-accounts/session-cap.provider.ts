/** @format */

/**
 * F1 notional admission — default, account-scoped, fail-closed admission
 * snapshot provider (residual capacity, Model A).
 *
 * Returns the two numbers the gate needs for the bound exchange account:
 * - `cap` = `totalBalance × leverage` — the gross notional ceiling.
 * - `existingExposure` = `Σ |qty × markPrice|` over the account's OPEN venue
 *   positions (manual trades + other activity on the same account), so the
 *   session can only consume the RESIDUAL `cap − existingExposure`.
 *
 * Both reads are account-scoped (never user-aggregate) so a user with several
 * venue accounts is gated per the account the session actually trades on:
 * - kodiak  → `kodiakIntegrationService.getBalance/getPositions(userId, exchangeAccountId)`
 * - lighter → `getLighterBalance/getLighterPositions(userId, exchangeAccountId)`
 *
 * FAIL-CLOSED: an unsupported venue, an unreadable balance, unavailable
 * positions, or an open position whose quantity/mark cannot be priced THROWS,
 * so `BotLifecycleService` refuses the write (503) rather than admitting
 * against an unknown capacity. Never returns a sentinel like `null`/`0`.
 *
 * `leverage` is a product policy constant (`SESSION_CAP_LEVERAGE`, default 10),
 * not the per-strategy leverage, since a session can host runs with differing
 * configs. `balance` is total equity (`totalBalance`) — neither venue reader
 * currently exposes free/available collateral — so residual capacity is
 * approximate until a free-collateral reader lands (honest follow-up).
 */

import type {
  AdmissionSnapshot,
  SessionCapProvider,
} from "../../../core/bots/bot-lifecycle.service";
import { integrationLogger } from "../../../core/logging/context-aware-logger.service";
import { exchangeAccountRepositoryAdapter } from "../../adapters/repositories/exchange-account-repository.adapter";
import { kodiakIntegrationService } from "../kodiak-integration.service";
import { getLighterBalance, getLighterPositions } from "../lighter/portfolio";

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

/**
 * `Σ |qty × markPrice|` over one account's open positions — the `existingExposure`
 * half of the admission snapshot. Entries arrive venue-agnostic ({@link sumPositionExposure}
 * callers map their row shape first).
 *
 * FAIL-CLOSED row rules:
 * - a non-zero quantity with a missing/non-numeric/non-positive mark THROWS
 *   (an unpriceable open position must not silently free up headroom);
 * - a non-zero quantity that cannot be parsed THROWS;
 * - flat rows (parsed qty === 0) contribute 0 (venues may include closed rows);
 * - a non-finite total THROWS (IEEE754 overflow guard, mirrors the cap check).
 */
export function sumPositionExposure(
  rows: ReadonlyArray<{
    qty: unknown;
    mark: unknown;
    symbol?: string;
  }>,
  exchangeAccountId: string
): number {
  let exposure = 0;
  for (const row of rows) {
    const qty =
      typeof row.qty === "string"
        ? parseFloat(row.qty)
        : row.qty === null || row.qty === undefined
          ? Number.NaN
          : Number(row.qty);
    if (!Number.isFinite(qty)) {
      throw new Error(
        `Open position on account ${exchangeAccountId} (market ${
          row.symbol ?? "unknown"
        }) has an unparseable quantity (${String(row.qty)}); cannot compute exposure`
      );
    }
    if (qty === 0) continue; // flat row — no exposure contribution
    const mark =
      typeof row.mark === "string"
        ? parseFloat(row.mark)
        : row.mark === null || row.mark === undefined
          ? Number.NaN
          : Number(row.mark);
    if (!Number.isFinite(mark) || mark <= 0) {
      throw new Error(
        `Open position on account ${exchangeAccountId} (market ${
          row.symbol ?? "unknown"
        }) has a missing or invalid mark price (${String(row.mark)}); cannot price exposure`
      );
    }
    exposure += Math.abs(qty * mark);
  }
  if (!Number.isFinite(exposure)) {
    throw new Error(
      `Computed venue exposure is not a finite number for account ${exchangeAccountId}`
    );
  }
  return exposure;
}

export function createSessionCapProvider(): SessionCapProvider {
  return {
    async getAdmissionSnapshot(
      userId: string,
      exchangeAccountId: string
    ): Promise<AdmissionSnapshot> {
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
      let existingExposure: number;
      if (account.exchange === "kodiak") {
        const [balanceRes, positionsRes] = await Promise.all([
          kodiakIntegrationService.getBalance(userId, exchangeAccountId),
          kodiakIntegrationService.getPositions(userId, exchangeAccountId),
        ]);
        if (!balanceRes.success || !balanceRes.data) {
          throw new Error(
            `Kodiak balance unavailable for account ${exchangeAccountId}: ${
              balanceRes.error || "no data"
            }`
          );
        }
        totalBalance = Number(balanceRes.data.totalBalance);
        if (!positionsRes.success || !Array.isArray(positionsRes.data)) {
          throw new Error(
            `Kodiak positions unavailable for account ${exchangeAccountId}: ${
              (!positionsRes.success && positionsRes.error) || "no data"
            }`
          );
        }
        existingExposure = sumPositionExposure(
          positionsRes.data.map(p => ({
            qty: p.positionAmt,
            mark: p.markPrice,
            symbol: p.symbol,
          })),
          exchangeAccountId
        );
      } else if (account.exchange === "lighter") {
        const [balanceRes, positionsRes] = await Promise.all([
          getLighterBalance(userId, exchangeAccountId),
          getLighterPositions(userId, exchangeAccountId),
        ]);
        if (!balanceRes.success || !balanceRes.data) {
          throw new Error(
            `Lighter balance unavailable for account ${exchangeAccountId}: ${
              balanceRes.error || "no data"
            }`
          );
        }
        totalBalance = Number(balanceRes.data.totalBalance);
        if (
          !positionsRes.success ||
          !positionsRes.data ||
          !Array.isArray(positionsRes.data.rows)
        ) {
          throw new Error(
            `Lighter positions unavailable for account ${exchangeAccountId}: ${
              (!positionsRes.success && positionsRes.error) || "no data"
            }`
          );
        }
        existingExposure = sumPositionExposure(
          positionsRes.data.rows.map(row => ({
            qty: row.position_qty,
            mark: row.mark_price,
            symbol: row.symbol,
          })),
          exchangeAccountId
        );
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
      integrationLogger.debug("Admission snapshot computed", {
        userId,
        exchangeAccountId,
        exchange: account.exchange,
        totalBalance,
        leverage,
        cap,
        existingExposure,
      });
      return { cap, existingExposure };
    },
  };
}
