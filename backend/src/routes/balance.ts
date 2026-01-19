/** @format */

import { Router, Request, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { getUserBalance, invalidateBalanceCache } from "../core/wallet/balance.service";
import logger from "../services/logger";
import { RateLimiters } from "../services/rate-limiter";
import { UserLevel } from "@trade-bot/shared";

const router = Router();

/**
 * GET /api/balance/current
 * Get user's current account balance from Orderly
 */
router.get(
  "/current",
  RateLimiters.balance,
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const userLevel = req.user!.userLevel;

    try {
      // BASIC users don't have balance data yet - skip API calls
      if (userLevel === UserLevel.BASIC) {
        logger.debug("Balance request from BASIC user, skipping API call", {
          userId,
          userLevel
        });
        return res.json({
          success: true,
          data: null,
          message: "Balance data available after Kodiak account setup"
        });
      }

      // VERIFIED users get real balance data
      const balance = await getUserBalance(userId);

      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Log differently based on user level
      if (userLevel === UserLevel.VERIFIED) {
        // Only log as error for VERIFIED users (unexpected failures)
        logger.error("Balance fetch failed for VERIFIED user", {
          userId,
          userLevel,
          error: errorMessage,
        });
      } else {
        // Log as debug for non-VERIFIED users (expected behavior)
        logger.debug("Balance fetch skipped/failed for non-VERIFIED user", {
          userId,
          userLevel,
          error: errorMessage,
        });
      }

      // Return user-friendly error for missing Kodiak credentials
      if (errorMessage.includes("no Kodiak account connected") ||
        errorMessage.includes("Kodiak credentials not found")) {
        return res.status(400).json({
          success: false,
          error:
            "Kodiak account not connected. Please connect your trading account in Settings.",
        });
      }

      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * POST /api/balance/refresh
 * Force refresh balance from Orderly API
 */
router.post(
  "/refresh",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      // ✅ Invalidate cache to force fresh fetch
      await invalidateBalanceCache(userId);

      const balance = await getUserBalance(userId);

      logger.info("Balance manually refreshed", { userId });

      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      logger.error("Refresh balance error", {
        userId: (req as AuthenticatedRequest).user?.userId,
        error: (error as Error).message,
      });

      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  }
);

export const balanceRoutes = router;
