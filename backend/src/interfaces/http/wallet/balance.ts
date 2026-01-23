/** @format */

import { Router, Request, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth";
import { selectBalanceService } from "../../../core/service-selector";
import logger from "../../../core/logging/logger.service";
import { RateLimiters } from "../../../infrastructure";
import { UserLevel, ValidationError, NotFoundError, ExternalServiceError } from "@trade-bot/shared";

// Select service implementation based on feature flags
const balanceService = selectBalanceService();

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
      const balance = await balanceService.getUserBalance(userId);

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

        // Throw structured errors for VERIFIED users
        if (errorMessage.includes("no Kodiak account connected") ||
          errorMessage.includes("Kodiak credentials not found")) {
          throw new ValidationError("Kodiak account not connected. Please connect your trading account in Settings.", {
            userId,
            operation: "balance_fetch"
          });
        }

        // External service errors (Kodiak API failures)
        if (errorMessage.includes("Orderly API") || errorMessage.includes("Kodiak")) {
          throw new ExternalServiceError("Kodiak", {
            userId,
            operation: "balance_fetch",
            service: "kodiak_api"
          });
        }

        // Generic internal error for unexpected failures
        throw new NotFoundError("Balance data temporarily unavailable", {
          userId,
          operation: "balance_fetch"
        });
      } else {
        // Log as debug for non-VERIFIED users (expected behavior)
        logger.debug("Balance fetch skipped/failed for non-VERIFIED user", {
          userId,
          userLevel,
          error: errorMessage,
        });

        // For non-VERIFIED users, still return user-friendly error
        throw new ValidationError("Balance data requires VERIFIED account status", {
          userId,
          userLevel,
          operation: "balance_fetch"
        });
      }
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
      await balanceService.invalidateBalanceCache(userId);

      const balance = await balanceService.getUserBalance(userId);

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
