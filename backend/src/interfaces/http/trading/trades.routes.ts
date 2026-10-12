/** @format */

/**
 * GET /api/trades — the local trade-ledger read behind the multi-account
 * Recent-Trades surfaces (Batch 1).
 *
 * Distinct from `GET /api/market/trades` (the per-account VENUE proxy), this
 * reads the platform's own `trades` display rows — written in the same
 * transaction as the durable ledger — so one query answers all three shapes:
 *
 *   GET /api/trades                       → all the caller's recent trades
 *   GET /api/trades?exchangeAccountId=…   → scoped to one exchange account
 *   GET /api/trades?strategyId=…          → one strategy's fills (strategy card)
 *
 * Query params:
 * - `exchangeAccountId` (optional) — must be owned by the caller (404 on a
 *   foreign/unknown id, matching the portfolio-routes contract; a UUID that
 *   isn't theirs is indistinguishable from a missing one);
 * - `strategyId` (optional) — validated the same way against the caller's
 *   strategies (ownership enforced inside the repo by `user_id` regardless);
 * - `limit` (optional) — default 50, capped at 200 (never unbounded).
 *
 * The response rows carry `strategyName` + `exchangeAccountId` labels (LEFT
 * JOINs: NULL = no attribution, rendered honestly by the UI) and preserve
 * NULL fee/pnl (unknown ≠ zero, F2).
 */

import { Router, Response } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import {
  tradeRepositoryAdapter,
  FilteredTrade,
} from "../../../infrastructure/adapters/repositories/trade-repository.adapter";
import { strategyRepositoryAdapter } from "../../../infrastructure/adapters/repositories/strategy-repository.adapter";
import { exchangeAccountRepositoryAdapter } from "../../../infrastructure/adapters/repositories/exchange-account-repository.adapter";
import { errMessage, fail, ok } from "./market-helpers";

export const tradesRoutes = Router();

/** Loose v4 uuid shape — rows are written by gen_random_uuid(). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Validate one optional id param against the caller's own rows.
 *
 * - absent → `{ ok: true }` (no filter);
 * - malformed → `{ ok: false, status: 400 }`;
 * - unknown or foreign → `{ ok: false, status: 404 }`.
 *
 * Exported for unit tests (the 400/404 contract). `existsForUser` answers
 * ownership, so a foreign id is indistinguishable from a missing one.
 */
export async function resolveOwnedId(
  userId: string,
  raw: unknown,
  existsForUser: (userId: string, id: string) => Promise<boolean>
): Promise<{ ok: true; id?: string } | { ok: false; status: number }> {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
    return { ok: false, status: 400 };
  }
  const owned = await existsForUser(userId, raw);
  if (!owned) return { ok: false, status: 404 };
  return { ok: true, id: raw };
}

tradesRoutes.get(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const strategyScope = await resolveOwnedId(
        userId,
        req.query.strategyId,
        (uid, id) => strategyRepositoryAdapter.strategyExistsForUser(id, uid)
      );
      if (!strategyScope.ok) {
        return res
          .status(strategyScope.status)
          .json({ success: false, error: "Strategy not found" });
      }

      const accountScope = await resolveOwnedId(
        userId,
        req.query.exchangeAccountId,
        async (uid, id) =>
          (await exchangeAccountRepositoryAdapter.getAccountWithSecret(
            uid,
            id
          )) !== null
      );
      if (!accountScope.ok) {
        return res
          .status(accountScope.status)
          .json({ success: false, error: "Exchange account not found" });
      }

      const rawLimit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : DEFAULT_LIMIT;
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, MAX_LIMIT)
          : DEFAULT_LIMIT;

      const rows: FilteredTrade[] =
        await tradeRepositoryAdapter.getTradesFiltered(userId, {
          exchangeAccountId: accountScope.id,
          strategyId: strategyScope.id,
          limit,
        });
      ok(res, { rows });
    } catch (err: unknown) {
      fail(res, "ledger_trades_endpoint", "Failed to fetch trades", {
        userId: req.user?.userId,
        strategyId: req.query.strategyId,
        exchangeAccountId: req.query.exchangeAccountId,
        error: errMessage(err),
      });
    }
  }
);
