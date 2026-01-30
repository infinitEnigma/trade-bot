/**
 * User Profile Routes
 *
 * Handles user profile management including retrieval, updates, and wallet verification.
 * Focused on user account operations.
 */

import { Router, Response } from "express";
import Joi from "joi";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth";
import { serviceProvider } from "../../../core/service-provider";
import { createErrorResponse } from "../../../shared/types/errors";
import { getCorrelationId } from "../../../shared/utils/context";
import logger from "../../../core/logging/logger.service";

const router = Router();

// Profile update validation schema
const profileUpdateSchema = Joi.object({
    email: Joi.string().email().optional(),
    currentPassword: Joi.string().when('newPassword', {
        is: Joi.exist(),
        then: Joi.required(),
        otherwise: Joi.forbidden()
    }),
    newPassword: Joi.string().min(8).optional(),
});

// Wallet verification validation schema
const walletVerificationSchema = Joi.object({
    walletAddress: Joi.string().required(),
    signature: Joi.string().required(),
    message: Joi.string().required(),
});

// GET /api/user/profile
router.get("/profile", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Ensure user is authenticated (should always be true due to authMiddleware)
        if (!req.user) {
            throw new Error("User not authenticated");
        }

        const userId = req.user.userId as string;
        const userProfileService = serviceProvider.getUserProfileService();
        const profile = await userProfileService.getUserProfile(userId);

        res.json({
            success: true,
            data: profile,
        });

        logger.info("Profile retrieved successfully", {
            userId,
            hasKodiak: profile.hasKodiak,
            correlationId: getCorrelationId(),
        });
    } catch (error) {
        logger.error("Get profile error", {
            ...createErrorResponse(error instanceof Error ? error : new Error(String(error)), getCorrelationId()),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to get profile"
        });
    }
});

// POST /api/user/profile/update
router.post("/profile/update", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Ensure user is authenticated (should always be true due to authMiddleware)
        if (!req.user) {
            throw new Error("User not authenticated");
        }

        // Validate request body
        const { error, value } = profileUpdateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }

        const userId = req.user.userId as string;
        const userProfileService = serviceProvider.getUserProfileService();
        const result = await userProfileService.updateUserProfile(userId, value);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
                message: result.message,
            });
        }

        res.json({
            success: true,
            message: result.message,
            data: result.data,
        });

    } catch (error) {
        logger.error("Profile update error", {
            ...createErrorResponse(error instanceof Error ? error : new Error(String(error)), getCorrelationId()),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to update profile",
        });
    }
});

// POST /api/user/verify-wallet
router.post("/verify-wallet", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Ensure user is authenticated (should always be true due to authMiddleware)
        if (!req.user) {
            throw new Error("User not authenticated");
        }

        // Validate request body
        const { error, value } = walletVerificationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message,
            });
        }

        const userId = req.user.userId as string;
        const userProfileService = serviceProvider.getUserProfileService();
        const result = await userProfileService.verifyWalletOwnership(
            userId,
            value.walletAddress,
            value.signature,
            value.message
        );

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.message,
            });
        }

        res.json({
            success: true,
            message: result.message,
        });

    } catch (error) {
        logger.error("Wallet verification error", {
            ...createErrorResponse(error instanceof Error ? error : new Error(String(error)), getCorrelationId()),
            userId: req.user?.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to verify wallet",
        });
    }
});

export { router as userProfileRoutes };
