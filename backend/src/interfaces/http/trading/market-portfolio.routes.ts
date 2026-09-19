/** GET /api/market/positions + /balance — authenticated Kodiak user data. */
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
