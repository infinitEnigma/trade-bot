/**
 * Bot Engine Routes
 *
 * Handles communication between the bot engine and backend API.
 * Processes heartbeats, trade reports, and engine status updates.
 */

import { Router, Request, Response, NextFunction } from "express";
import { query } from "../../../database/pool";
// Bot services have been removed - using direct database operations instead
import { engineManager } from "../../../core/strategies/engine-manager.service";
import { errorNotificationService, ErrorSeverity, ErrorCategory } from "../../../core/notifications/error-notification.service";
import logger from "../../../core/logging/logger.service";

/**
 * Engine health status interface
 */
interface EngineHealth {
    status: string;
    timestamp: number;
    uptime: number;
    memory: NodeJS.MemoryUsage;
    version: string;
    database?: string;
    botStats?: {
        total_bots: number;
        running_bots: number;
        error_bots: number;
    };
}

const router = Router();

/**
 * Bot Engine API Key Authentication Middleware
 * Protects bot engine routes from unauthorized access
 */
const botEngineAuth = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-bot-engine-key'] as string;

    if (!apiKey) {
        logger.warn("Bot engine route accessed without API key", {
            path: req.path,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        });
        return res.status(401).json({
            success: false,
            error: "API key required for bot engine access"
        });
    }

    const expectedKey = process.env.BOT_ENGINE_API_KEY;
    if (!expectedKey) {
        logger.error("BOT_ENGINE_API_KEY not configured");
        return res.status(500).json({
            success: false,
            error: "Server configuration error"
        });
    }

    if (apiKey !== expectedKey) {
        logger.warn("Invalid bot engine API key provided", {
            path: req.path,
            ip: req.ip,
            keyLength: apiKey.length,
        });
        return res.status(401).json({
            success: false,
            error: "Invalid API key"
        });
    }

    // API key is valid
    logger.debug("Bot engine API key validated", {
        path: req.path,
    });

    next();
};

// POST /api/bot/heartbeat (called by bot engine)
router.post("/heartbeat", botEngineAuth, async (req: Request, res: Response) => {
    try {
        const { bot_id, status, position, exposure, timestamp } = req.body;

        if (!bot_id) {
            return res.status(400).json({ success: false, error: "Bot ID required" });
        }

        // Validate bot exists (simplified - no ownership validation for engine calls)
        const botExists = await query("SELECT id FROM bot_instances WHERE id = $1", [bot_id]);
        if (botExists.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Bot not found" });
        }

        // Update bot with heartbeat data
        await query(
            `UPDATE bot_instances
             SET status = $1, position = $2, exposure = $3, last_heartbeat = $4, updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [
                status,
                position || 0,
                exposure || 0,
                new Date(timestamp || Date.now()),
                bot_id,
            ]
        );

        logger.info("Bot heartbeat received", {
            botId: bot_id,
            status,
            position,
            exposure,
        });

        res.json({ success: true });
    } catch (error) {
        const err = error as Error;
        logger.error("Heartbeat error", {
            error: err.message,
            botId: req.body?.bot_id,
        });

        // Notify about heartbeat processing failures
        await errorNotificationService.notifyError(
            err,
            {
                category: ErrorCategory.SYSTEM,
                operation: "bot_heartbeat_processing",
                metadata: {
                    botId: req.body?.bot_id,
                    heartbeatFailure: true,
                },
            },
            ErrorSeverity.MEDIUM
        );

        res.status(500).json({ success: false, error: "Failed to record heartbeat" });
    }
});

// POST /api/bot/report-trade (called by bot engine)
router.post("/report-trade", botEngineAuth, async (req: Request, res: Response) => {
    try {
        const {
            userId,
            strategyId,
            orderId,
            symbol,
            side,
            quantity,
            price,
            pnl,
            fee,
            status,
        } = req.body;

        if (!userId || !orderId) {
            return res
                .status(400)
                .json({ success: false, error: "Missing required fields" });
        }

        // Insert trade record
        await query(
            `INSERT INTO trades (user_id, strategy_id, order_id, symbol, side, quantity, price, pnl, fee, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                userId,
                strategyId,
                orderId,
                symbol,
                side,
                quantity,
                price,
                pnl,
                fee,
                status,
            ]
        );

        // Update bot statistics
        if (strategyId) {
            await query(
                `UPDATE bot_instances
                 SET total_trades = total_trades + 1,
                     total_pnl = total_pnl + COALESCE($1, 0),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE strategy_id = $2`,
                [pnl, strategyId]
            );
        }

        // Performance cache invalidation removed - bot services not implemented

        // Emit WebSocket event to notify frontend
        const io = global.io;
        if (io) {
            io.to(`user:${userId}`).emit("trade:executed", {
                userId,
                strategyId,
                orderId,
                symbol,
                side,
                quantity,
                price,
                pnl,
                fee,
                status,
                timestamp: Date.now(),
            });
        }

        logger.info("Trade reported successfully", {
            userId,
            strategyId,
            orderId,
            symbol,
            side,
            quantity,
            price,
            pnl,
            status,
        });

        res.json({ success: true });
    } catch (error) {
        const err = error as Error;
        logger.error("Report trade error", {
            error: err.message,
            tradeData: {
                userId: req.body?.userId,
                strategyId: req.body?.strategyId,
                orderId: req.body?.orderId,
                symbol: req.body?.symbol,
            },
        });

        // Notify about trade reporting failures
        await errorNotificationService.notifyError(
            err,
            {
                category: ErrorCategory.BUSINESS_LOGIC,
                operation: "trade_reporting",
                userId: req.body?.userId,
                metadata: {
                    strategyId: req.body?.strategyId,
                    orderId: req.body?.orderId,
                    symbol: req.body?.symbol,
                    tradeReportingFailure: true,
                },
            },
            ErrorSeverity.HIGH
        );

        res.status(500).json({ success: false, error: "Failed to report trade" });
    }
});

// POST /api/bot/engine-status (called by bot engine)
router.post("/engine-status", botEngineAuth, async (req: Request, res: Response) => {
    try {
        const { status, activeBots, totalBots, uptime, memoryUsage, cpuUsage } = req.body;

        // Update engine status in memory
        // This could be extended to store in database if needed
        const engineStatus = {
            running: status === 'running',
            status,
            activeBots: activeBots || 0,
            totalBots: totalBots || 0,
            uptime: uptime || 0,
            memoryUsage,
            cpuUsage,
            lastUpdate: Date.now(),
        };

        // Store engine status (could be in Redis or database)
        // For now, we'll just log it and potentially store in a simple cache
        logger.info("Engine status update received", {
            status,
            activeBots,
            totalBots,
            uptime,
            memoryUsage,
            cpuUsage,
        });

        // Check for engine health issues
        if (status !== 'running') {
            await errorNotificationService.notifyError(
                new Error(`Engine status: ${status}`),
                {
                    category: ErrorCategory.SYSTEM,
                    operation: "engine_health_check",
                    metadata: {
                        engineStatus,
                        engineHealthIssue: true,
                    },
                },
                status === 'error' ? ErrorSeverity.CRITICAL : ErrorSeverity.HIGH
            );
        }

        // Check if we should stop engine (no active bots)
        if (activeBots === 0 && status === 'running') {
            setTimeout(async () => {
                try {
                    await engineManager.stopEngineIfNoActiveBots();
                } catch (error) {
                    logger.error("Failed to check engine stop condition", {
                        error: (error as Error).message,
                    });
                }
            }, 5000); // 5 second delay to allow for race conditions
        }

        res.json({
            success: true,
            acknowledged: true,
            timestamp: Date.now(),
        });
    } catch (error) {
        const err = error as Error;
        logger.error("Engine status update error", {
            error: err.message,
            statusData: req.body,
        });

        res.status(500).json({
            success: false,
            error: "Failed to process engine status update"
        });
    }
});

// POST /api/bot/bot-error (called by bot engine when bot encounters error)
// Simplified - bot services not implemented
router.post("/bot-error", botEngineAuth, async (req: Request, res: Response) => {
    try {
        const { botId, error } = req.body;

        if (!botId || !error) {
            return res.status(400).json({
                success: false,
                error: "Bot ID and error message required"
            });
        }

        // Update bot status to ERROR (simplified)
        await query(
            "UPDATE bot_instances SET status = 'ERROR', last_error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
            [error, botId]
        );

        logger.error("Bot error reported by engine", {
            botId,
            error,
        });

        res.json({
            success: true,
            acknowledged: true,
            timestamp: Date.now(),
        });
    } catch (err) {
        const error = err as Error;
        logger.error("Bot error reporting failed", {
            error: error.message,
            botId: req.body?.botId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to process bot error report"
        });
    }
});

// POST /api/bot/bot-recovery (called by bot engine when bot recovers)
// Simplified - bot services not implemented
router.post("/bot-recovery", botEngineAuth, async (req: Request, res: Response) => {
    try {
        const { botId } = req.body;

        if (!botId) {
            return res.status(400).json({
                success: false,
                error: "Bot ID required"
            });
        }

        // Update bot status to RUNNING (simplified)
        await query(
            "UPDATE bot_instances SET status = 'RUNNING', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            [botId]
        );

        logger.info("Bot recovery reported by engine", {
            botId,
        });

        res.json({
            success: true,
            acknowledged: true,
            timestamp: Date.now(),
        });
    } catch (error) {
        const err = error as Error;
        logger.error("Bot recovery reporting failed", {
            error: err.message,
            botId: req.body?.botId,
        });

        res.status(500).json({
            success: false,
            error: "Failed to process bot recovery report"
        });
    }
});

// GET /api/bot/engine/health (health check endpoint for engine)
router.get("/engine/health", async (req: Request, res: Response) => {
    try {
        // Get basic system health
        const health: EngineHealth = {
            status: "healthy",
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version,
        };

        // Get basic bot statistics from database
        const botStatsResult = await query(`
            SELECT
                COUNT(*) as total_bots,
                COUNT(CASE WHEN status = 'RUNNING' THEN 1 END) as running_bots,
                COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as error_bots
            FROM bot_instances
        `);
        const botStats = botStatsResult.rows[0];

        // Check database connectivity
        try {
            await query("SELECT 1");
            health.database = "connected";
        } catch (_error) {
            health.database = "disconnected";
            health.status = "degraded";
        }

        res.json({
            success: true,
            data: {
                ...health,
                botStats,
            },
        });
    } catch (error) {
        const err = error as Error;
        logger.error("Engine health check error", {
            error: err.message,
        });

        res.status(500).json({
            success: false,
            status: "unhealthy",
            error: err.message,
            timestamp: Date.now(),
        });
    }
});

export { router as botEngineRoutes };
