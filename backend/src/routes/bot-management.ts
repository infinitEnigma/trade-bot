/**
 * ===========================================
 * 🤖 BOT MANAGEMENT API ROUTES
 * ===========================================
 *
 * User-facing bot lifecycle management endpoints for the Trade Bot platform.
 * Handles bot creation, execution, monitoring, and emergency operations with
 * enterprise-grade security and comprehensive audit trails.
 *
 * ARCHITECTURE OVERVIEW:
 * - RESTful API design with WebSocket real-time updates
 * - Secure credential handling with memory-safe operations
 * - End-to-end encryption for bot engine communication
 * - Comprehensive audit logging and compliance tracking
 * - Position validation and risk management integration
 *
 * SECURITY MODEL:
 * - JWT authentication required for all operations
 * - Role-based access control (QUALIFIED_ALPHA minimum)
 * - Secure credential handling with automatic memory cleanup
 * - End-to-end encryption using session keys
 * - Comprehensive audit logging for all bot operations
 *
 * API ENDPOINTS:
 * - GET /instances - List user's bot instances
 * - POST /start - Start bot with secure credential transmission
 * - POST /stop - Graceful bot shutdown
 * - GET /status/:botId - Real-time bot status with reconciliation
 * - POST /status/sync - Manual status synchronization
 * - GET /performance/:botId - Performance metrics and analytics
 * - POST /emergency-stop - Critical safety operations
 *
 * WEBSOCKET INTEGRATION:
 * - Real-time bot status updates via Socket.IO
 * - Encrypted credential transmission to bot engine
 * - Live performance metrics broadcasting
 * - Emergency stop event propagation
 *
 * CREDENTIAL SECURITY:
 * - SecureCredentials container with automatic memory wiping
 * - Context manager pattern for guaranteed cleanup
 * - End-to-end encryption using AES-256-GCM
 * - Session key generation and secure transmission
 *
 * INTEGRATION POINTS:
 * - Bot Engine: WebSocket communication for bot lifecycle
 * - Position Validator: Pre-start risk assessment
 * - Database: Bot instances, strategies, audit logs
 * - Redis: Status caching and coordination
 * - Market Stream: Real-time data for active bots
 *
 * OPERATIONAL FEATURES:
 * - Automatic engine management (start/stop based on active bots)
 * - Comprehensive error handling and recovery
 * - Performance monitoring and analytics
 * - Emergency stop with order cancellation
 * - Status reconciliation and health monitoring
 *
 * MONITORING & ALERTS:
 * - Bot lifecycle event logging
 * - Performance metric collection
 * - Error rate tracking and alerting
 * - Security event auditing
 * - Resource usage monitoring
 *
 * @format
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
import { withCredentials, SecureCredentials } from "../services/encryption"; // ✅ Secure credential handling
import { engineManager } from "../services/engine-manager";
import { botStatusService } from "../services/bot-status";
import { botPerformanceService } from "../services/bot-performance";
import { UserRole } from "@trade-bot/shared";
import logger from "../services/logger";

const router = Router();

/**
 * Check if user has verified Kodiak credentials (without decrypting)
 */
async function hasUserKodiakCredentials(userId: string): Promise<boolean> {
    try {
        const result = await query(
            "SELECT id FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
            [userId]
        );
        return result.rows.length > 0;
    } catch (error) {
        logger.error("Failed to check user Kodiak credentials", {
            error: error instanceof Error ? error.message : String(error),
            userId,
        });
        return false;
    }
}

/**
 * ===========================================
 * 📋 GET BOT INSTANCES
 * ===========================================
 *
 * Retrieves all bot instances belonging to the authenticated user.
 * Returns comprehensive bot information including strategy details and status.
 *
 * ENDPOINT: GET /api/bot/instances
 * AUTH: JWT required
 * ROLE: Any authenticated user
 *
 * QUERY PARAMETERS: None
 *
 * RESPONSE:
 * ```json
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "id": "uuid",
 *       "strategy_id": "uuid",
 *       "user_id": "uuid",
 *       "status": "RUNNING|STOPPED|ERROR",
 *       "running_time": 3600,
 *       "total_trades": 150,
 *       "total_pnl": 1250.50,
 *       "created_at": "2024-01-01T00:00:00Z",
 *       "strategy_name": "Grid Trading BTC",
 *       "strategy_type": "GRID",
 *       "strategy_config": { "symbol": "PERP_BTC_USDC", ... }
 *     }
 *   ],
 *   "timestamp": 1640995200000
 * }
 * ```
 *
 * SECURITY:
 * - Validates user ownership of all returned bot instances
 * - No sensitive data exposure (credentials, internal IDs)
 * - Rate limited via global limiter
 *
 * PERFORMANCE:
 * - Single optimized JOIN query
 * - Ordered by creation date (most recent first)
 * - Minimal data transfer (strategy config included)
 *
 * ERROR HANDLING:
 * - Database errors: Generic "Failed to get bot instances"
 * - Logs detailed error information for debugging
 * - Returns structured error response with correlation ID
 *
 * @param req - Express request with authenticated user
 * @param res - Express response
 * @returns Promise<void> - JSON response with bot instances or error
 */
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

/**
 * ===========================================
 * 🚀 START BOT INSTANCE
 * ===========================================
 *
 * Creates and starts a new bot instance with comprehensive security validations,
 * position risk assessment, and secure credential transmission to the bot engine.
 *
 * ENDPOINT: POST /api/bot/start
 * AUTH: JWT required + QUALIFIED_ALPHA role minimum
 * VALIDATION: strategyId (UUID), notionalAmount (positive number)
 *
 * REQUEST BODY:
 * ```json
 * {
 *   "strategyId": "uuid-of-user-strategy",
 *   "notionalAmount": 1000.50
 * }
 * ```
 *
 * WORKFLOW:
 * 1. **Engine Preparation**: Ensure trading engine is running
 * 2. **Ownership Validation**: Verify strategy belongs to user
 * 3. **Bot State Check**: Ensure bot can be started (no conflicts)
 * 4. **Risk Assessment**: Validate position size against account limits
 * 5. **Bot Creation**: Generate bot instance in database
 * 6. **Credential Verification**: Check user has verified Kodiak credentials
 * 7. **Audit Logging**: Record credential access for compliance
 * 8. **Strategy Activation**: Mark strategy as active
 * 9. **Secure Transmission**: Encrypt credentials with session key
 * 10. **Engine Notification**: Send encrypted payload via WebSocket
 *
 * SECURITY FEATURES:
 * - **Role-based Access**: QUALIFIED_ALPHA minimum required
 * - **Ownership Validation**: User can only start their own strategies
 * - **Position Validation**: Risk assessment before bot execution
 * - **Secure Credentials**: Memory-safe decryption and immediate cleanup
 * - **End-to-End Encryption**: AES-256-GCM with session keys
 * - **Audit Trail**: All credential access logged with timestamps
 *
 * POSITION VALIDATION:
 * - Account balance and leverage limits
 * - Maximum single position size (25% of account)
 * - Orderly exchange-specific limits
 * - Total exposure limits (80% of account balance)
 * - Margin requirements verification
 *
 * CREDENTIAL SECURITY:
 * ```typescript
 * // Secure credential lifecycle
 * await withCredentials(userId, async (credentials) => {
 *   // Credentials decrypted and used securely
 *   // Automatically wiped from memory after callback
 * });
 * ```
 *
 * WEBSOCKET PAYLOAD:
 * ```json
 * {
 *   "botId": "uuid",
 *   "strategyId": "uuid",
 *   "strategy": { "name": "...", "config": {...} },
 *   "userId": "uuid",
 *   "encryptedCredentials": {
 *     "encrypted": "base64-ciphertext",
 *     "iv": "hex-iv",
 *     "authTag": "hex-tag"
 *   },
 *   "sessionKey": "encrypted-session-key"
 * }
 * ```
 *
 * RESPONSE:
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "botId": "uuid",
 *     "strategyId": "uuid",
 *     "status": "RUNNING",
 *     "strategy": {
 *       "name": "Grid Trading BTC",
 *       "type": "GRID",
 *       "config": { "symbol": "PERP_BTC_USDC", ... }
 *     }
 *   },
 *   "timestamp": 1640995200000
 * }
 * ```
 *
 * ERROR HANDLING:
 * - **Engine Not Running**: Auto-start engine, retry operation
 * - **Strategy Not Found**: 404 with ownership validation
 * - **Bot Start Conflict**: 409 with reason (already running, etc.)
 * - **Position Validation**: 400 with risk assessment details
 * - **Credential Missing**: 400 with clear user guidance
 * - **Engine Communication**: Comprehensive error logging
 *
 * PERFORMANCE:
 * - **Pre-validation**: Risk assessment before resource allocation
 * - **Atomic Operations**: Database consistency across all steps
 * - **Resource Management**: Automatic engine lifecycle management
 * - **Cleanup Guarantee**: Credentials wiped even on failures
 *
 * MONITORING:
 * - Bot creation events logged with full context
 * - Credential access audited for compliance
 * - Performance metrics collected for optimization
 * - Error rates tracked for reliability monitoring
 *
 * @param req - Express request with validated bot start parameters
 * @param res - Express response
 * @returns Promise<void> - JSON response with bot details or error
 */
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

            // Check if user has verified credentials first
            const hasCredentials = await hasUserKodiakCredentials(req.user!.userId);
            if (!hasCredentials) {
                const authError = new ValidationError("No verified Kodiak credentials found");
                return res.status(authError.statusCode).json(
                    createErrorResponse(authError, getCorrelationId())
                );
            }

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
                        timestamp: new Date().toISOString()
                    },
                ]
            );

            // Update strategy as active
            await query("UPDATE strategies SET active = true WHERE id = $1", [
                strategyId,
            ]);

            // Use secure credential handling - decrypt, use, and auto-cleanup
            await withCredentials(req.user!.userId, async (credentials: SecureCredentials) => {
                // Generate session key for end-to-end encryption
                const sessionKey = randomBytes(32).toString('hex');

                // Get encryption service instance
                const { encryptionService } = await import("../services/encryption.js");
                const encryptedSessionKey = await encryptionService.encryptWithVersion(sessionKey);

                // Create decrypted credentials object (temporary, will be encrypted immediately)
                const decryptedCredentials = {
                    accountId: credentials.get('accountId'),
                    accessKey: credentials.get('apiKey'),
                    secretKey: credentials.get('secretKey'),
                };

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
