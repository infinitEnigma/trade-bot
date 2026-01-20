/**
 * User Kodiak Routes
 *
 * Handles Kodiak exchange integration including connection management,
 * data retrieval, and API interactions. Focused on exchange operations.
 */

import { Router, Request, Response } from "express";
import Joi from "joi";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { kodiakConnectionService } from "../../infrastructure/external/kodiak-connection.service";
import { kodiakIntegrationService } from "../../infrastructure/external/kodiak-integration.service";
import logger from "../../core/logging/logger.service";

const router = Router();

// Kodiak connection validation schema
const kodiakConnectionSchema = Joi.object({
    accountId: Joi.string().required(),
    apiKey: Joi.string().required(),
    secretKey: Joi.string().required(),
    walletSignature: Joi.string().optional(),
});

// POST /api/user/kodiak/connect
router.post("/kodiak/connect", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Validate request body
        const { error, value } = kodiakConnectionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }

        const userId = req.user!.userId as string;
        const result = await kodiakConnectionService.connectKodiak(userId, value);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message,
                error: result.error,
            });
        }

        res.json({
            success: true,
            message: result.message,
            data: result.data,
        });

    } catch (error) {
        logger.error("Kodiak connect error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to connect Kodiak credentials"
        });
    }
});

// DELETE /api/user/kodiak/disconnect
router.delete("/kodiak/disconnect", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.userId as string;
        const result = await kodiakConnectionService.disconnectKodiak(userId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message,
                error: result.error,
            });
        }

        res.json({
            success: true,
            message: result.message,
        });

    } catch (error) {
        logger.error("Kodiak disconnect error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to disconnect Kodiak credentials",
        });
    }
});

// GET /api/user/kodiak/status
router.get("/kodiak/status", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.userId as string;
        const status = await kodiakConnectionService.getConnectionStatus(userId);

        res.json({
            success: true,
            data: status,
        });

    } catch (error) {
        logger.error("Get Kodiak status error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to get Kodiak status"
        });
    }
});

// GET /api/user/kodiak/positions
router.get("/kodiak/positions", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.userId as string;
        const result = await kodiakIntegrationService.getPositions(userId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        res.json({
            success: true,
            data: result.data,
        });

    } catch (error) {
        logger.error("Get Kodiak positions error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to get Kodiak positions"
        });
    }
});

// GET /api/user/kodiak/trades
router.get("/kodiak/trades", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.userId as string;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const result = await kodiakIntegrationService.getTrades(userId, limit);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        res.json({
            success: true,
            data: result.data,
        });

    } catch (error) {
        logger.error("Get Kodiak trades error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to get Kodiak trades"
        });
    }
});

// GET /api/user/kodiak/balance
router.get("/kodiak/balance", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.userId as string;
        const result = await kodiakIntegrationService.getBalance(userId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        res.json({
            success: true,
            data: result.data,
        });

    } catch (error) {
        logger.error("Get Kodiak balance error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to get Kodiak balance"
        });
    }
});

// GET /api/user/kodiak/account-info
router.get("/kodiak/account-info", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.userId as string;
        const result = await kodiakIntegrationService.getAccountInfo(userId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        res.json({
            success: true,
            data: result.data,
        });

    } catch (error) {
        logger.error("Get Kodiak account info error", {
            error: error instanceof Error ? error.message : String(error),
            userId: req.user!.userId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to get Kodiak account info"
        });
    }
});

export { router as userKodiakRoutes };
