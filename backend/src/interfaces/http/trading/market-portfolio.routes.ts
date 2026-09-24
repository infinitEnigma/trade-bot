/** GET /api/market/positions + /balance + /trades — authenticated exchange user data (C2: replaces the deleted /api/user/kodiak/* routes). */
import { Router, Response } from "express";
import { kodiakIntegrationService } from "../../../infrastructure/external/kodiak-integration.service";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import { errMessage, fail, ok } from "./market-helpers";

export const portfolioRoutes = Router();

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
      const positionsResponse =
        await kodiakIntegrationService.getPositions(userId);
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
      const balanceResponse = await kodiakIntegrationService.getBalance(userId);
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
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;
      const tradesResponse = await kodiakIntegrationService.getTrades(
        userId,
        Number.isFinite(limit) && limit > 0 ? limit : 50
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
        error: errMessage(err),
      });
    }
  }
);
