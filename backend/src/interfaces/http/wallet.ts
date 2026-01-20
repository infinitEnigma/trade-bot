/** @format */

import { Router, Request, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { walletQualificationService } from "../../core/wallet/wallet-qualification.service";
import logger from "../../core/logging/logger.service";

const router = Router();

/**
 * GET /api/wallet/qualification
 * Check user's wallet qualification for alpha features
 */
router.get("/qualification", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.userId as string;
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
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to check wallet qualification"
        });
    }
});

export { router as walletRoutes };
