/** GET /api/market/positions + /balance + /trades — authenticated exchange user data (C2: replaces the deleted /api/user/kodiak/* routes; C3b: optional `?exchangeAccountId=` scoping so two accounts of one user display independently). */
import { Router, Response } from "express";
import { kodiakIntegrationService } from "../../../infrastructure/external/kodiak-integration.service";
import {
  getLighterBalance,
  getLighterPnl,
  getLighterPositions,
  getLighterTrades,
} from "../../../infrastructure/external/lighter/portfolio";
import { exchangeAccountRepositoryAdapter } from "../../../infrastructure/adapters/repositories/exchange-account-repository.adapter";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import { errMessage, fail, ok } from "./market-helpers";

export const portfolioRoutes = Router();

/** Loose v4 shape — rows are written by gen_random_uuid(). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Venue = "kodiak" | "lighter";

type AccountScope =
  | { ok: true; exchangeAccountId?: string; exchange: Venue }
  | { ok: false; status: number; error: string };

/**
 * C3b: validate the optional `exchangeAccountId` query param.
 *
 * - absent → legacy default (the service resolves the user's first ACTIVE
 *   kodiak account, exactly as before C3b) — scope carries `exchange:"kodiak"`;
 * - malformed → 400; unknown or not owned by the caller → 404 (a foreign id
 *   is indistinguishable from a missing one, so existence is not leaked);
 * - not ACTIVE → 409 (same state-conflict answer as bot start / revoke).
 *
 * The returned `exchange` is the venue dispatch: Kodiak rows keep the
 * `kodiakIntegrationService`, Lighter rows go to the Lighter portfolio
 * reader (P0-L2 follow-up — the old "this route family only speaks Kodiak"
 * 400 is gone, so the venue-agnostic dashboard gets data for both venues).
 *
 * Repo failures propagate to the caller's try/catch and hit `fail()` like
 * every other error on these endpoints.
 *
 * Exported for unit tests (scope rules are the 400/404/409 contract).
 */
export async function resolveAccountScope(
  userId: string,
  raw: unknown
): Promise<AccountScope> {
  if (raw === undefined || raw === null || raw === "")
    return { ok: true, exchange: "kodiak" };
  if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
    return {
      ok: false,
      status: 400,
      error: "Invalid exchangeAccountId format",
    };
  }
  const account = await exchangeAccountRepositoryAdapter.getAccountWithSecret(
    userId,
    raw
  );
  if (!account) {
    return { ok: false, status: 404, error: "Exchange account not found" };
  }
  if (account.status !== "ACTIVE") {
    return { ok: false, status: 409, error: "Exchange account is not active" };
  }
  return {
    ok: true,
    exchangeAccountId: account.id,
    exchange: account.exchange,
  };
}

portfolioRoutes.get(
  "/positions",
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
      const scope = await resolveAccountScope(
        userId,
        req.query.exchangeAccountId
      );
      if (!scope.ok) {
        return res
          .status(scope.status)
          .json({ success: false, error: scope.error });
      }
      const positionsResponse =
        scope.exchange === "lighter"
          ? await getLighterPositions(userId, scope.exchangeAccountId as string)
          : await kodiakIntegrationService.getPositions(
              userId,
              scope.exchangeAccountId
            );
      if (!positionsResponse.success) {
        return res.status(400).json({
          success: false,
          error: positionsResponse.error || "Failed to fetch positions",
        });
      }
      ok(res, positionsResponse.data);
    } catch (err: unknown) {
      fail(res, "positions_endpoint", "Failed to fetch positions", {
        userId: req.user?.userId,
        exchangeAccountId: req.query.exchangeAccountId,
        error: errMessage(err),
      });
    }
  }
);

portfolioRoutes.get(
  "/balance",
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
      const scope = await resolveAccountScope(
        userId,
        req.query.exchangeAccountId
      );
      if (!scope.ok) {
        return res
          .status(scope.status)
          .json({ success: false, error: scope.error });
      }
      const balanceResponse =
        scope.exchange === "lighter"
          ? await getLighterBalance(userId, scope.exchangeAccountId as string)
          : await kodiakIntegrationService.getBalance(
              userId,
              scope.exchangeAccountId
            );
      if (!balanceResponse.success) {
        return res.status(400).json({
          success: false,
          error: balanceResponse.error || "Failed to fetch balance",
        });
      }
      ok(res, balanceResponse.data);
    } catch (err: unknown) {
      fail(res, "balance_endpoint", "Failed to fetch balance", {
        userId: req.user?.userId,
        exchangeAccountId: req.query.exchangeAccountId,
        error: errMessage(err),
      });
    }
  }
);

portfolioRoutes.get(
  "/trades",
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
      const scope = await resolveAccountScope(
        userId,
        req.query.exchangeAccountId
      );
      if (!scope.ok) {
        return res
          .status(scope.status)
          .json({ success: false, error: scope.error });
      }
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;
      const resolvedLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
      const tradesResponse =
        scope.exchange === "lighter"
          ? await getLighterTrades(
              userId,
              resolvedLimit,
              scope.exchangeAccountId as string
            )
          : await kodiakIntegrationService.getTrades(
              userId,
              resolvedLimit,
              scope.exchangeAccountId
            );
      if (!tradesResponse.success) {
        return res.status(400).json({
          success: false,
          error: tradesResponse.error || "Failed to fetch trades",
        });
      }
      ok(res, tradesResponse.data);
    } catch (err: unknown) {
      fail(res, "trades_endpoint", "Failed to fetch trades", {
        userId: req.user?.userId,
        exchangeAccountId: req.query.exchangeAccountId,
        error: errMessage(err),
      });
    }
  }
);
portfolioRoutes.get(
  "/pnl",
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
      const scope = await resolveAccountScope(
        userId,
        req.query.exchangeAccountId
      );
      if (!scope.ok) {
        return res
          .status(scope.status)
          .json({ success: false, error: scope.error });
      }
      // Lighter has no per-fill realized PnL on `/api/v1/trades` rows
      // (verified live 2026-10-09) — its authoritative realized figure is
      // the venue-computed `trade_pnl` series from `/api/v1/pnl`. Kodiak
      // keeps its native per-trade `realizedPnl` rows via `/trades`, so a
      // non-Lighter account answers 404 (unknown source, not an error).
      if (scope.exchange !== "lighter") {
        return res
          .status(404)
          .json({ success: false, error: "Venue PnL series not available" });
      }
      const countBack = req.query.countBack
        ? parseInt(req.query.countBack as string, 10)
        : 168;
      const pnlResponse = await getLighterPnl(
        userId,
        Number.isFinite(countBack) && countBack > 0 ? countBack : 168,
        scope.exchangeAccountId as string
      );
      if (!pnlResponse.success) {
        return res.status(400).json({
          success: false,
          error: pnlResponse.error || "Failed to fetch venue PnL",
        });
      }
      ok(res, pnlResponse.data);
    } catch (err: unknown) {
      fail(res, "pnl_endpoint", "Failed to fetch venue PnL", {
        userId: req.user?.userId,
        exchangeAccountId: req.query.exchangeAccountId,
        error: errMessage(err),
      });
    }
  }
);

portfolioRoutes.get(
  "/pnl",
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
      const scope = await resolveAccountScope(
        userId,
        req.query.exchangeAccountId
      );
      if (!scope.ok) {
        return res
          .status(scope.status)
          .json({ success: false, error: scope.error });
      }
      // Lighter has no per-fill realized PnL on `/api/v1/trades` rows
      // (verified live 2026-10-09) — its authoritative realized figure is
      // the venue-computed `trade_pnl` series from `/api/v1/pnl`. Kodiak
      // keeps its native per-trade `realizedPnl` rows via `/trades`, so a
      // non-Lighter account answers 404 (unknown source, not an error).
      if (scope.exchange !== "lighter") {
        return res
          .status(404)
          .json({ success: false, error: "Venue PnL series not available" });
      }
      const countBack = req.query.countBack
        ? parseInt(req.query.countBack as string, 10)
        : 168;
      const pnlResponse = await getLighterPnl(
        userId,
        Number.isFinite(countBack) && countBack > 0 ? countBack : 168,
        scope.exchangeAccountId as string
      );
      if (!pnlResponse.success) {
        return res.status(400).json({
          success: false,
          error: pnlResponse.error || "Failed to fetch venue PnL",
        });
      }
      ok(res, pnlResponse.data);
    } catch (err: unknown) {
      fail(res, "pnl_endpoint", "Failed to fetch venue PnL", {
        userId: req.user?.userId,
        exchangeAccountId: req.query.exchangeAccountId,
        error: errMessage(err),
      });
    }
  }
);
