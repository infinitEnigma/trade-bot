/** @format */

import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth";
import { serviceProvider } from "../../../core/service-provider";
import logger from "../../../core/logging/logger.service";

const router = Router();

/**
 * GET /api/wallet/qualification
 * Check user's wallet qualification for alpha features
 */
router.get("/qualification", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized - user not authenticated"
            });
        }

        const walletQualificationService = serviceProvider.getWalletQualificationService();
        const result = await walletQualificationService.checkAlphaQualification(userId);

        res.json({
            success: true,
            qualified: result.qualified,
            reasons: result.reasons,
            data: result
        });
    } catch (error) {
        logger.error("Wallet qualification check error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to check wallet qualification"
        });
    }
});

// Re-export individual route modules for domain access
export { walletBalanceRoutes } from "./balance";

export { router as walletRoutes };
