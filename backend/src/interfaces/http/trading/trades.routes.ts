/** @format */

/**
 * GET /api/trades — the local trade-ledger read behind the multi-account
 * Recent-Trades surfaces (Batch 1).
 *
 * Distinct from `GET /api/market/trades` (the per-account VENUE proxy), this
 * reads the platform's own `trades` display rows - written in the same
 * transaction as the durable ledger - so one query answers all three shapes:
 *
 *   GET /api/trades                       → all the caller's recent trades
 *   GET /api/trades?exchangeAccountId=…   → scoped to one exchange account
 *   GET /api/trades?strategyId=…          → one strategy's fills (strategy card)
 *
 * HTTP only: parse the query, hand it to `GetTradesUseCase` (which owns
 * ownership validation, limit clamping and the repository fan-out), map the
 * result. The use case is injected - `server/route-config.ts` is the HTTP
 * composition root (dependency inversion - review P1, 2026-10-15; routes no
 * longer import repository adapters).
 *
 * Response rows carry `strategyName` + `exchangeAccountId` labels (LEFT
 * JOINs: NULL = no attribution, rendered honestly by the UI) and preserve
 * NULL fee/pnl (unknown ≠ zero, F2).
 */

import { Router, Response } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import { GetTradesUseCase } from "../../../core/trades/get-trades.use-case";
import { errMessage, fail, ok } from "./market-helpers";

export function createTradesRoutes(useCase: GetTradesUseCase): Router {
  const tradesRoutes = Router();

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

        // parseInt mirrors the former route: garbage → NaN → the use case's
        // 50 default; oversized values are clamped to 200 inside the use case.
        const limit =
          req.query.limit !== undefined
            ? parseInt(String(req.query.limit), 10)
            : undefined;

        const result = await useCase.execute({
          userId,
          strategyId: req.query.strategyId,
          exchangeAccountId: req.query.exchangeAccountId,
          limit,
        });
        if (!result.ok) {
          return res
            .status(result.status)
            .json({ success: false, error: result.error });
        }
        ok(res, { rows: result.rows });
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

  return tradesRoutes;
}
