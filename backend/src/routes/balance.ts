/** @format */

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { getUserBalance, invalidateBalanceCache } from '../services/balance';
import logger from '../services/logger';
import { RateLimiters } from '../services/rate-limiter';

const router = Router();

/**
 * GET /api/balance/current
 * Get user's current account balance from Orderly
 */
router.get(
  '/current',
  RateLimiters.balance,
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      const balance = await getUserBalance(userId);

      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      logger.error('Get balance error', {
        userId: (req as AuthenticatedRequest).user?.userId,
        error: (error as Error).message,
      });

      // Return user-friendly error for missing Kodiak credentials
      if ((error as Error).message.includes('no Kodiak account connected')) {
        return res.status(400).json({
          success: false,
          error: 'Kodiak account not connected. Please connect your trading account in Settings.',
        });
      }

      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  }
);

/**
 * POST /api/balance/refresh
 * Force refresh balance from Orderly API
 */
router.post(
  '/refresh',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      // ✅ Invalidate cache to force fresh fetch
      await invalidateBalanceCache(userId);

      const balance = await getUserBalance(userId);

      logger.info('Balance manually refreshed', { userId });

      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      logger.error('Refresh balance error', {
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
