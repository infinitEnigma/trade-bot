/** @format */

import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth";
import { blockchainService } from "../../../infrastructure/external/blockchain.service";
import logger from "../../../core/logging/logger.service";
import { RateLimiters } from "../../../infrastructure";
import { UserLevel, ValidationError, NotFoundError, ExternalServiceError } from "../../../shared/src";

const router = Router();

/**
 * GET /api/balance/current
 * Get user's current wallet balance from connected blockchain wallet
 */
router.get(
  "/current",
  RateLimiters.balance,
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    // Ensure user is authenticated (should always be true due to authMiddleware)
    if (!req.user) {
      throw new ValidationError("User not authenticated", {
        operation: "wallet_balance_fetch"
      });
    }

    const userId = req.user.userId;
    const userLevel = req.user.userLevel;

    try {
      // BASIC users don't have wallet balance data yet - skip API calls
      if (userLevel === UserLevel.BASIC) {
        logger.debug("Wallet balance request from BASIC user, skipping rpc call", {
          userId,
          userLevel
        });
        return res.json({
          success: true,
          data: null,
          message: "Wallet balance data available after wallet connection"
        });
      }

      // Get user's wallet address from database
      const walletAddress = await blockchainService.getUserWalletAddress(userId);

      if (!walletAddress) {
        logger.debug("No wallet address found for user", {
          userId,
          userLevel
        });
        throw new ValidationError("No connected wallet found. Please connect your wallet in Settings.", {
          userId,
          operation: "wallet_balance_fetch"
        });
      }

      // VERIFIED users get real wallet balance data from blockchain
      const balance = await blockchainService.getNativeBalance(walletAddress);

      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Log differently based on user level
      if (userLevel === UserLevel.VERIFIED) {
        // Only log as error for VERIFIED users (unexpected failures)
        logger.error("Wallet balance fetch failed for VERIFIED user", {
          userId,
          userLevel,
          error: errorMessage,
        });

        // Throw structured errors for VERIFIED users
        if (errorMessage.includes("no Kodiak account connected") ||
          errorMessage.includes("Kodiak credentials not found") ||
          errorMessage.includes("No connected wallet found")) {
          throw new ValidationError("Wallet not connected. Please connect your wallet in Settings.", {
            userId,
            operation: "wallet_balance_fetch"
          });
        }

        // Blockchain service errors
        if (errorMessage.includes("Failed to get balance") || errorMessage.includes("blockchain")) {
          throw new ExternalServiceError("Blockchain", {
            userId,
            operation: "wallet_balance_fetch",
            service: "blockchain_rpc"
          });
        }

        // Generic internal error for unexpected failures
        throw new NotFoundError("Wallet balance data temporarily unavailable", {
          userId,
          operation: "wallet_balance_fetch"
        });
      } else {
        // Log as debug for non-VERIFIED users (expected behavior)
        logger.debug("Wallet balance fetch skipped/failed for non-VERIFIED user", {
          userId,
          userLevel,
          error: errorMessage,
        });

        // For non-VERIFIED users, still return user-friendly error
        throw new ValidationError("Wallet balance data requires VERIFIED account status", {
          userId,
          userLevel,
          operation: "wallet_balance_fetch"
        });
      }
    }
  }
);

/**
 * POST /api/balance/refresh
 * Force refresh wallet balance from blockchain
 */
router.post(
  "/refresh",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Ensure user is authenticated (should always be true due to authMiddleware)
      if (!req.user) {
        throw new ValidationError("User not authenticated", {
          operation: "wallet_balance_refresh"
        });
      }

      const userId = req.user.userId;

      // Get user's wallet address
      const walletAddress = await blockchainService.getUserWalletAddress(userId);

      if (!walletAddress) {
        logger.debug("No wallet address found for refresh", { userId });
        throw new ValidationError("No connected wallet found. Please connect your wallet in Settings.", {
          userId,
          operation: "wallet_balance_refresh"
        });
      }

      // ✅ Invalidate cache to force fresh fetch
      await blockchainService.invalidateUserCache(userId, walletAddress);

      const balance = await blockchainService.getNativeBalance(walletAddress);

      logger.info("Wallet balance manually refreshed", { userId });

      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      logger.error("Refresh wallet balance error", {
        userId: (req as AuthenticatedRequest).user?.userId,
        error: (error as Error).message,
      });

      res.status(500).json({
        success: true,
        error: (error as Error).message,
      });
    }
  }
);

export const walletBalanceRoutes = router;
