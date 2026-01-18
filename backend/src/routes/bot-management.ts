/**
 * Bot Management Routes
 *
 * Handles user-facing bot operations including CRUD operations,
 * status management, and performance monitoring.
 */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/role-protection";
import { query } from "../database/pool";
import {
    ValidationError,
    NotFoundError,
    DatabaseError,
    ConflictError,
    createErrorResponse,
} from "../types/errors";
import { getCorrelationId, getContextForLogging } from "../utils/context";
import { validators } from "../middleware/validation";
import { encryptionService } from "../services/encryption";
import { engineManager } from "../services/engine-manager";
import { botStatusService } from "../services/bot-status";
import { botPerformanceService } from "../services/bot-performance";
import { UserRole } from "@trade-bot/shared";
import logger from "../services/logger";

const router = Router();

// GET /api/bot/instances
router.get(
    "/instances",
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
        const userId = req.user!.userId as string;
        try {
            const result = await query(
                `SELECT bi.*, s.name as strategy_name, s.type as strategy_type, s.config as strategy_config
       FROM bot_instances bi
       JOIN strategies s ON bi.strategy_id = s.id
       WHERE bi.user_id = $1
       ORDER BY bi.created_at DESC`,
                [userId]
            );

            res.json({
                success: true,
                data: result.rows,
                timestamp: Date.now(),
            });
        } catch (err) {
            logger.error("Get bot instances error", {
                error: err instanceof Error ? err.message : String(err),
                userId: userId,
            });
            const dbError = new DatabaseError("Failed to get bot instances");
            res.status(dbError.statusCode).json(
                createErrorResponse(dbError, getCorrelationId())
            );
        }
    }
);

// POST /api/bot/start
router.post(
    "/start",
    authMiddleware,
    requireRole(UserRole.QUALIFIED_ALPHA),
    validators.startBot,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const { strategyId, notionalAmount } = req.body;

            // Ensure trading engine is running
            await engineManager.ensureEngineRunning();

            // Verify strategy belongs to user
            const strategyResult = await query(
                "SELECT * FROM strategies WHERE id = $1 AND user_id = $2",
                [strategyId, req.user!.userId]
            );

            if (strategyResult.rows.length === 0) {
                const notFoundError = new NotFoundError("Strategy not found");
                return res.status(notFoundError.statusCode).json(
                    createErrorResponse(notFoundError, getCorrelationId())
                );
            }

            const strategy = strategyResult.rows[0];

            // Check if bot can be started
            const startCheck = await botStatusService.canStartBot(strategyId);
            if (!startCheck.canStart) {
                const conflictError = new ConflictError(startCheck.reason || "Cannot start bot");
                return res.status(conflictError.statusCode).json(
                    createErrorResponse(conflictError, getCorrelationId())
                );
            }

            // ✅ POSITION VALIDATION: Validate position size before starting bot
            const { validateUserPosition } =
                await import("../services/position-validator.js");
            const validation = await validateUserPosition(
                req.user!.userId,
                parseFloat(notionalAmount),
                strategy.config?.symbol || "PERP_BTC_USDC"
            );

            if (!validation.isValid) {
                const positionError = new ValidationError(validation.reason || "Position size validation failed");
                const errorResponse = createErrorResponse(positionError, getCorrelationId()) as any;
                errorResponse.data = {
                    requested: notionalAmount,
                    max_allowed: validation.maxAllowed,
                    recommended: validation.recommended,
                };
                return res.status(positionError.statusCode).json(errorResponse);
            }

            // Create bot instance
            const botId = uuidv4();
            await query(
                `INSERT INTO bot_instances (id, strategy_id, user_id, status, running_time, total_trades, total_pnl)
       VALUES ($1, $2, $3, 'RUNNING', 0, 0, 0)`,
                [botId, strategyId, req.user!.userId]
            );

            // Get user's Kodiak credentials
            const credentialsResult = await query(
                "SELECT account_id, access_key, secret_key, encryption_version FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [req.user!.userId]
            );

            if (credentialsResult.rows.length === 0) {
                const authError = new ValidationError("No verified Kodiak credentials found");
                return res.status(authError.statusCode).json(
                    createErrorResponse(authError, getCorrelationId())
                );
            }

            const credentials = credentialsResult.rows[0];

            // Decrypt the credentials using version-aware decryption
            const encryptionVersion = credentials.encryption_version || 1;
            const decryptedCredentials = {
                accountId: await encryptionService.decryptWithVersion(credentials.account_id),
                accessKey: await encryptionService.decryptWithVersion(credentials.access_key),
                secretKey: await encryptionService.decryptWithVersion(credentials.secret_key),
            };

            // Log credential access for audit trail
            await query(
                "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                [
                    req.user!.userId,
                    "CREDENTIAL_ACCESS",
                    {
                        action: "bot_start",
                        botId,
                        strategyId,
                        encryptionVersion,
                        timestamp: new Date().toISOString()
                    },
                ]
            );

            // Update strategy as active
            await query("UPDATE strategies SET active = true WHERE id = $1", [
                strategyId,
            ]);

            // Generate session key for end-to-end encryption
            const sessionKey = randomBytes(32).toString('hex');
            const encryptedSessionKey = await encryptionService.encryptWithVersion(sessionKey);

            // Encrypt credentials with session key for transmission
            const algorithm = 'aes-256-gcm';
            const iv = randomBytes(16);
            const cipher = createCipheriv(algorithm, Buffer.from(sessionKey, 'hex'), iv);

            const credentialsJson = JSON.stringify(decryptedCredentials);
            let encrypted = cipher.update(credentialsJson, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag();

            const encryptedCredentialsPayload = {
                encrypted: encrypted,
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex'),
            };

            // Emit WebSocket event with encrypted credentials
            const io = req.app.get("io");
            io.emit("bot:start", {
                botId,
                strategyId,
                strategy,
                userId: req.user!.userId,
                encryptedCredentials: encryptedCredentialsPayload,
                sessionKey: encryptedSessionKey, // Encrypted session key for engine to decrypt
            });

            res.json({
                success: true,
                data: {
                    botId,
                    strategyId,
                    status: "RUNNING",
                    strategy: {
                        name: strategy.name,
                        type: strategy.type,
                        config: strategy.config,
                    },
                },
                timestamp: Date.now(),
            });
        } catch (err) {
            logger.error("Start bot error", {
                ...getContextForLogging(),
                error: err instanceof Error ? err.message : String(err),
                userId: req.user!.userId,
            });
            const internalError = new DatabaseError("Failed to start bot");
            res.status(internalError.statusCode).json(
                createErrorResponse(internalError, getCorrelationId())
            );
        }
    }
);

// POST /api/bot/stop
router.post(
    "/stop",
    authMiddleware,
    requireRole(UserRole.QUALIFIED_ALPHA),
    validators.stopBot,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const { botId } = req.body;

            // Validate bot ownership and check if it can be stopped
            const botData = await botStatusService.validateBotOwnership(botId, req.user!.userId);
            const stopCheck = await botStatusService.canStopBot(botData);

            if (!stopCheck.canStop) {
                const conflictError = new ConflictError(stopCheck.reason || "Cannot stop bot");
                return res.status(conflictError.statusCode).json(
                    createErrorResponse(conflictError, getCorrelationId())
                );
            }

            // Update bot status
            await botStatusService.updateBotStatus(botId, 'STOPPED', null, 'user_stop');

            // Update strategy as inactive
            await query("UPDATE strategies SET active = false WHERE id = $1", [
                botData.strategy_id,
            ]);

            // Emit WebSocket event to notify bot engine
            const io = req.app.get("io");
            io.emit("bot:stop", { botId, strategyId: botData.strategy_id });

            // Check if engine should be stopped (no active bots)
            setTimeout(async () => {
                await engineManager.stopEngineIfNoActiveBots();
            }, 1000); // Small delay to ensure bot is stopped

            res.json({
                success: true,
                data: {
                    botId,
                    status: "STOPPED",
                },
                timestamp: Date.now(),
            });
        } catch (err) {
            logger.error("Stop bot error", {
                error: err instanceof Error ? err.message : String(err),
                userId: req.user!.userId,
            });
            const dbError = new DatabaseError("Failed to stop bot");
            res.status(dbError.statusCode).json(
                createErrorResponse(dbError, getCorrelationId())
            );
        }
    }
);

// GET /api/bot/status/:botId
router.get(
    "/status/:botId",
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const userId = req.user!.userId as string;
            const botId = req.params.botId as string;
            const statusInfo = await botStatusService.getBotStatusInfo(botId, userId);

            res.json({
                success: true,
                data: statusInfo,
                timestamp: Date.now(),
            });
        } catch (err) {
            logger.error("Get bot status error", {
                error: err instanceof Error ? err.message : String(err),
                userId: req.user!.userId,
                botId: req.params.botId,
            });
            const dbError = new DatabaseError("Failed to get bot status");
            res.status(dbError.statusCode).json(
                createErrorResponse(dbError, getCorrelationId())
            );
        }
    }
);

// POST /api/bot/status/sync
router.post(
    "/status/sync",
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const { botId } = req.body;

            if (!botId) {
                const validationError = new ValidationError("Bot ID required");
                return res.status(validationError.statusCode).json(
                    createErrorResponse(validationError, getCorrelationId())
                );
            }

            // Validate bot ownership
            await botStatusService.validateBotOwnership(botId, req.user!.userId);

            // Perform comprehensive status reconciliation
            const reconciliation = await botStatusService.reconcileBotStatus(
                await botStatusService.validateBotOwnership(botId, req.user!.userId),
                Date.now()
            );

            // Update database if status changed
            if (reconciliation.statusChanged) {
                await botStatusService.updateBotStatus(
                    botId,
                    reconciliation.newStatus,
                    reconciliation.errorMessage,
                    'manual_sync'
                );

                logger.info("Bot status reconciled", {
                    botId,
                    oldStatus: await botStatusService.validateBotOwnership(botId, req.user!.userId).then(b => b.status),
                    newStatus: reconciliation.newStatus,
                    reconciliationReason: reconciliation.reason,
                });
            }

            // Emit status update via WebSocket
            const io = req.app.get("io");
            io.to(`user:${req.user!.userId}`).emit("bot:status", {
                botId,
                status: reconciliation.newStatus,
                previousStatus: await botStatusService.validateBotOwnership(botId, req.user!.userId).then(b => b.status),
                reconciled: reconciliation.statusChanged,
                reason: reconciliation.reason,
                timestamp: Date.now(),
            });

            res.json({
                success: true,
                data: {
                    botId,
                    status: reconciliation.newStatus,
                    reconciled: reconciliation.statusChanged,
                    reason: reconciliation.reason,
                    engineHealth: reconciliation.engineHealth,
                },
                timestamp: Date.now(),
            });
        } catch (err) {
            logger.error("Bot status sync error", {
                error: err instanceof Error ? err.message : String(err),
                userId: req.user!.userId,
                botId: req.body?.botId,
            });
            const dbError = new DatabaseError("Failed to sync bot status");
            res.status(dbError.statusCode).json(
                createErrorResponse(dbError, getCorrelationId())
            );
        }
    }
);

// GET /api/bot/performance/:botId
router.get(
    "/performance/:botId",
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const userId = req.user!.userId as string;
            const botId = req.params.botId as string;
            const performance = await botPerformanceService.getBotPerformance(botId, userId);

            res.json({
                success: true,
                data: performance,
                timestamp: Date.now(),
            });
        } catch (err) {
            logger.error("Get bot performance error", {
                error: err instanceof Error ? err.message : String(err),
                userId: req.user!.userId,
                botId: req.params.botId,
            });
            const dbError = new DatabaseError("Failed to get bot performance");
            res.status(dbError.statusCode).json(
                createErrorResponse(dbError, getCorrelationId())
            );
        }
    }
);

// POST /api/bot/emergency-stop
router.post(
    "/emergency-stop",
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const { botId } = req.body;

            if (!botId) {
                return res
                    .status(400)
                    .json({ success: false, error: "Bot ID required" });
            }

            // Validate bot ownership
            const botData = await botStatusService.validateBotOwnership(botId, req.user!.userId);

            if (botData.status !== "RUNNING") {
                return res
                    .status(400)
                    .json({ success: false, error: "Bot is not running" });
            }

            // Update bot status to FORCE_STOPPING
            await botStatusService.updateBotStatus(botId, 'FORCE_STOPPING', 'Emergency stop initiated', 'emergency_stop');

            // Log emergency stop action
            await query(
                "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                [
                    req.user!.userId,
                    "EMERGENCY_STOP",
                    { botId, strategyId: botData.strategy_id },
                ]
            );

            // Emit WebSocket event to notify bot engine - CANCEL_ALL_ORDERS
            const io = req.app.get("io");
            io.emit("bot:emergency-stop", {
                botId,
                strategyId: botData.strategy_id,
                action: "CANCEL_ALL_ORDERS",
                timestamp: Date.now(),
            });

            // Set timeout to mark as stopped if bot doesn't respond
            setTimeout(async () => {
                try {
                    const currentBot = await query(
                        "SELECT status FROM bot_instances WHERE id = $1",
                        [botId]
                    );

                    if (currentBot.rows[0]?.status === "FORCE_STOPPING") {
                        await botStatusService.updateBotStatus(botId, 'STOPPED', 'Emergency stop timeout', 'emergency_stop_timeout');

                        // Update strategy as inactive
                        await query("UPDATE strategies SET active = false WHERE id = $1", [
                            botData.strategy_id,
                        ]);
                    }
                } catch (error) {
                    logger.error("Emergency stop timeout error", {
                        error: error instanceof Error ? error.message : String(error),
                        botId,
                    });
                }
            }, 30000); // 30 second timeout

            res.json({
                success: true,
                data: {
                    botId,
                    status: "FORCE_STOPPING",
                    message: "Emergency stop initiated. All orders will be cancelled.",
                },
                timestamp: Date.now(),
            });
        } catch (err) {
            logger.error("Emergency stop error", {
                error: err instanceof Error ? err.message : String(err),
                userId: req.user!.userId,
            });
            res
                .status(500)
                .json({ success: false, error: "Failed to initiate emergency stop" });
        }
    }
);

export { router as botManagementRoutes };
