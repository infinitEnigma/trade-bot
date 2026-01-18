/** @format */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/role-protection";
import { getPool, query } from "../database/pool"; // ✅ Import from centralized module
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
import { UserRole } from "@trade-bot/shared";
import logger from "../services/logger";

const router = Router();

// ✅ Use centralized pool via helper functions
// No direct pool creation

/**
 * Validate bot status based on heartbeat and engine state
 */
async function validateBotStatus(botData: any, currentTime: number): Promise<{
  updatedStatus: string;
  errorMessage: string | null;
  isStale: boolean;
  lastHeartbeatAge: number;
}> {
  const lastHeartbeat = botData.last_heartbeat ? new Date(botData.last_heartbeat).getTime() : 0;
  const heartbeatAge = currentTime - lastHeartbeat;
  const isStale = heartbeatAge > 60000; // 60 seconds

  // If bot is running but heartbeat is stale, mark as error
  if (botData.status === 'RUNNING' && isStale) {
    return {
      updatedStatus: 'ERROR',
      errorMessage: 'Bot heartbeat timeout - status validation',
      isStale: true,
      lastHeartbeatAge: heartbeatAge,
    };
  }

  // If bot is in error state but heartbeat is recent, check if it recovered
  if (botData.status === 'ERROR' && !isStale && botData.last_error?.includes('heartbeat timeout')) {
    return {
      updatedStatus: 'RUNNING',
      errorMessage: null,
      isStale: false,
      lastHeartbeatAge: heartbeatAge,
    };
  }

  return {
    updatedStatus: botData.status,
    errorMessage: botData.last_error,
    isStale,
    lastHeartbeatAge: heartbeatAge,
  };
}

/**
 * Get engine health status for status validation
 */
async function getEngineHealthStatus(): Promise<{
  running: boolean;
  lastHealthCheck?: number;
  status?: string;
}> {
  try {
    const status = await engineManager.getEngineStatus();
    return {
      running: status.running,
      lastHealthCheck: Date.now(),
      status: status.health?.status || 'unknown',
    };
  } catch (error) {
    return {
      running: false,
      lastHealthCheck: Date.now(),
      status: 'error',
    };
  }
}

/**
 * Perform comprehensive bot status reconciliation
 */
async function reconcileBotStatus(botData: any, currentTime: number): Promise<{
  statusChanged: boolean;
  newStatus: string;
  errorMessage: string | null;
  reason: string;
  engineHealth: any;
}> {
  const engineHealth = await getEngineHealthStatus();
  const validation = await validateBotStatus(botData, currentTime);

  // If engine is not running but bot is supposed to be running
  if (!engineHealth.running && ['RUNNING', 'STARTING'].includes(botData.status)) {
    return {
      statusChanged: true,
      newStatus: 'ERROR',
      errorMessage: 'Engine not running - status reconciliation',
      reason: 'engine_down',
      engineHealth,
    };
  }

  // If status validation indicates a change
  if (validation.updatedStatus !== botData.status) {
    return {
      statusChanged: true,
      newStatus: validation.updatedStatus,
      errorMessage: validation.errorMessage,
      reason: validation.isStale ? 'heartbeat_timeout' : 'status_recovery',
      engineHealth,
    };
  }

  // Check for strategy consistency
  try {
    const strategyResult = await query(
      "SELECT active FROM strategies WHERE id = $1",
      [botData.strategy_id]
    );

    if (strategyResult.rows.length > 0) {
      const strategy = strategyResult.rows[0];

      // If strategy is inactive but bot is running, stop the bot
      if (!strategy.active && botData.status === 'RUNNING') {
        return {
          statusChanged: true,
          newStatus: 'STOPPED',
          errorMessage: 'Strategy deactivated - status reconciliation',
          reason: 'strategy_inactive',
          engineHealth,
        };
      }

      // If strategy is active but bot is stopped, this might indicate inconsistency
      if (strategy.active && botData.status === 'STOPPED') {
        return {
          statusChanged: false,
          newStatus: botData.status,
          errorMessage: null,
          reason: 'strategy_active_bot_stopped',
          engineHealth,
        };
      }
    }
  } catch (error) {
    logger.warn("Strategy consistency check failed during reconciliation", {
      botId: botData.id,
      error: (error as Error).message,
    });
  }

  return {
    statusChanged: false,
    newStatus: botData.status,
    errorMessage: botData.last_error,
    reason: 'no_changes_needed',
    engineHealth,
  };
}

// GET /api/bot/instances
router.get(
  "/instances",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await query(
        `SELECT bi.*, s.name as strategy_name, s.type as strategy_type, s.config as strategy_config
       FROM bot_instances bi
       JOIN strategies s ON bi.strategy_id = s.id
       WHERE bi.user_id = $1
       ORDER BY bi.created_at DESC`,
        [req.user!.userId]
      );

      res.json({
        success: true,
        data: result.rows,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get bot instances error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
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

      // Check if bot already exists
      const existingBot = await query(
        "SELECT * FROM bot_instances WHERE strategy_id = $1 AND status IN ('RUNNING', 'STARTING')",
        [strategyId]
      );

      if (existingBot.rows.length > 0) {
        const conflictError = new ConflictError("Bot already running for this strategy");
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

      // Verify bot belongs to user
      const botResult = await query(
        "SELECT * FROM bot_instances WHERE id = $1 AND user_id = $2",
        [botId, req.user!.userId]
      );

      if (botResult.rows.length === 0) {
        const notFoundError = new NotFoundError("Bot not found");
        return res.status(notFoundError.statusCode).json(
          createErrorResponse(notFoundError, getCorrelationId())
        );
      }

      const bot = botResult.rows[0];

      if (bot.status !== "RUNNING") {
        const conflictError = new ConflictError("Bot is not running");
        return res.status(conflictError.statusCode).json(
          createErrorResponse(conflictError, getCorrelationId())
        );
      }

      // Update bot status
      await query("UPDATE bot_instances SET status = 'STOPPED' WHERE id = $1", [
        botId,
      ]);

      // Update strategy as inactive
      await query("UPDATE strategies SET active = false WHERE id = $1", [
        bot.strategy_id,
      ]);

      // Emit WebSocket event to notify bot engine
      const io = req.app.get("io");
      io.emit("bot:stop", { botId, strategyId: bot.strategy_id });

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
      const result = await query(
        `SELECT bi.*, s.name as strategy_name, s.type as strategy_type
       FROM bot_instances bi
       JOIN strategies s ON bi.strategy_id = s.id
       WHERE bi.id = $1 AND bi.user_id = $2`,
        [req.params.botId, req.user!.userId]
      );

      if (result.rows.length === 0) {
        const notFoundError = new NotFoundError("Bot not found");
        return res.status(notFoundError.statusCode).json(
          createErrorResponse(notFoundError, getCorrelationId())
        );
      }

      const botData = result.rows[0];
      const now = Date.now();

      // Enhanced status validation
      const statusValidation = await validateBotStatus(botData, now);

      // Update bot status if validation indicates changes
      if (statusValidation.updatedStatus !== botData.status) {
        await query(
          "UPDATE bot_instances SET status = $1, last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
          [statusValidation.updatedStatus, statusValidation.errorMessage, req.params.botId]
        );

        botData.status = statusValidation.updatedStatus;
        botData.last_error = statusValidation.errorMessage;

        logger.info("Bot status updated during status check", {
          botId: req.params.botId,
          oldStatus: result.rows[0].status,
          newStatus: statusValidation.updatedStatus,
          reason: statusValidation.errorMessage,
        });
      }

      // Add real-time status information
      const responseData = {
        ...botData,
        statusValidation: {
          isStale: statusValidation.isStale,
          lastHeartbeatAge: statusValidation.lastHeartbeatAge,
          engineHealth: await getEngineHealthStatus(),
        },
        timestamp: now,
      };

      res.json({
        success: true,
        data: responseData,
        timestamp: now,
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

      // Get bot data
      const result = await query(
        "SELECT * FROM bot_instances WHERE id = $1 AND user_id = $2",
        [botId, req.user!.userId]
      );

      if (result.rows.length === 0) {
        const notFoundError = new NotFoundError("Bot not found");
        return res.status(notFoundError.statusCode).json(
          createErrorResponse(notFoundError, getCorrelationId())
        );
      }

      const botData = result.rows[0];
      const now = Date.now();

      // Perform comprehensive status reconciliation
      const reconciliation = await reconcileBotStatus(botData, now);

      // Update database if status changed
      if (reconciliation.statusChanged) {
        await query(
          "UPDATE bot_instances SET status = $1, last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
          [reconciliation.newStatus, reconciliation.errorMessage, botId]
        );

        logger.info("Bot status reconciled", {
          botId,
          oldStatus: botData.status,
          newStatus: reconciliation.newStatus,
          reconciliationReason: reconciliation.reason,
        });
      }

      // Emit status update via WebSocket
      const io = req.app.get("io");
      io.to(`user:${req.user!.userId}`).emit("bot:status", {
        botId,
        status: reconciliation.newStatus,
        previousStatus: botData.status,
        reconciled: reconciliation.statusChanged,
        reason: reconciliation.reason,
        timestamp: now,
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
        timestamp: now,
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
      const botResult = await query(
        "SELECT * FROM bot_instances WHERE id = $1 AND user_id = $2",
        [req.params.botId, req.user!.userId]
      );

      if (botResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Bot not found" });
      }

      const bot = botResult.rows[0];

      // Get trade statistics
      const statsResult = await query(
        `SELECT
         COUNT(*) as total_trades,
         SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
         SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
         COALESCE(SUM(pnl), 0) as total_pnl,
         COALESCE(AVG(pnl), 0) as avg_pnl,
         COALESCE(SUM(ABS(pnl)), 0) as total_volume
       FROM trades
       WHERE user_id = $1 AND strategy_id = $2`,
        [req.user!.userId, bot.strategy_id]
      );

      // Get daily P&L
      const dailyResult = await query(
        `SELECT
         DATE(executed_at) as date,
         COALESCE(SUM(pnl), 0) as daily_pnl
       FROM trades
       WHERE user_id = $1 AND strategy_id = $2
       GROUP BY DATE(executed_at)
       ORDER BY date DESC
       LIMIT 30`,
        [req.user!.userId, bot.strategy_id]
      );

      res.json({
        success: true,
        data: {
          bot: {
            id: bot.id,
            status: bot.status,
            runningTime: bot.running_time,
            totalTrades: bot.total_trades,
            totalPnl: bot.total_pnl,
          },
          performance: statsResult.rows[0],
          dailyPnl: dailyResult.rows,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get bot performance error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
        botId: req.params.botId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to get bot performance" });
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

      // Verify bot belongs to user
      const botResult = await query(
        "SELECT * FROM bot_instances WHERE id = $1 AND user_id = $2",
        [botId, req.user!.userId]
      );

      if (botResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Bot not found" });
      }

      const bot = botResult.rows[0];

      if (bot.status !== "RUNNING") {
        return res
          .status(400)
          .json({ success: false, error: "Bot is not running" });
      }

      // Update bot status to FORCE_STOPPING
      await query(
        "UPDATE bot_instances SET status = 'FORCE_STOPPING' WHERE id = $1",
        [botId]
      );

      // Log emergency stop action
      await query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [
          req.user!.userId,
          "EMERGENCY_STOP",
          { botId, strategyId: bot.strategy_id },
        ]
      );

      // Emit WebSocket event to notify bot engine - CANCEL_ALL_ORDERS
      const io = req.app.get("io");
      io.emit("bot:emergency-stop", {
        botId,
        strategyId: bot.strategy_id,
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
            await query(
              "UPDATE bot_instances SET status = 'STOPPED' WHERE id = $1",
              [botId]
            );

            // Update strategy as inactive
            await query("UPDATE strategies SET active = false WHERE id = $1", [
              bot.strategy_id,
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

// POST /api/bot/heartbeat (called by bot engine)
router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const { bot_id, status, position, exposure, timestamp } = req.body;

    if (!bot_id) {
      return res.status(400).json({ success: false, error: "Bot ID required" });
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
  } catch (err) {
    logger.error("Heartbeat error", {
      error: err instanceof Error ? err.message : String(err),
    });
    res
      .status(500)
      .json({ success: false, error: "Failed to record heartbeat" });
  }
});

// POST /api/bot/report-trade (called by bot engine)
router.post("/report-trade", async (req: Request, res: Response) => {
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

    // Emit WebSocket event to notify frontend
    const io = req.app.get("io");
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
    });

    res.json({ success: true });
  } catch (err) {
    logger.error("Report trade error", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ success: false, error: "Failed to report trade" });
  }
});

// Enhanced bot state reconciliation and recovery - runs every 30 seconds
setInterval(async () => {
  try {
    // Get all bots that need reconciliation
    const botsToReconcile = await query(`
      SELECT bi.*, s.active as strategy_active, s.user_id
      FROM bot_instances bi
      JOIN strategies s ON bi.strategy_id = s.id
      WHERE bi.status IN ('RUNNING', 'STARTING', 'FORCE_STOPPING')
    `);

    for (const bot of botsToReconcile.rows) {
      try {
        const reconciliation = await reconcileBotStatus(bot, Date.now());

        if (reconciliation.statusChanged) {
          // Update bot status in database
          await query(
            "UPDATE bot_instances SET status = $1, last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
            [reconciliation.newStatus, reconciliation.errorMessage, bot.id]
          );

          // If bot stopped due to strategy deactivation, update strategy
          if (reconciliation.newStatus === 'STOPPED' && reconciliation.reason === 'strategy_inactive') {
            await query("UPDATE strategies SET active = false WHERE id = $1", [bot.strategy_id]);
          }

          // Emit status update via WebSocket
          const io = global.io;
          if (io) {
            io.to(`user:${bot.user_id}`).emit("bot:status", {
              botId: bot.id,
              status: reconciliation.newStatus,
              previousStatus: bot.status,
              reconciled: true,
              reason: reconciliation.reason,
              timestamp: Date.now(),
            });
          }

          logger.info("Bot status reconciled", {
            botId: bot.id,
            oldStatus: bot.status,
            newStatus: reconciliation.newStatus,
            reason: reconciliation.reason,
          });

          // Log reconciliation action
          await query(
            "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
            [
              bot.user_id,
              "BOT_STATUS_RECONCILED",
              {
                botId: bot.id,
                oldStatus: bot.status,
                newStatus: reconciliation.newStatus,
                reason: reconciliation.reason,
                engineHealth: reconciliation.engineHealth,
              },
            ]
          );
        }

        // Check for recovery opportunities
        if (bot.status === 'ERROR' && bot.last_error?.includes('heartbeat timeout')) {
          const lastHeartbeat = bot.last_heartbeat ? new Date(bot.last_heartbeat).getTime() : 0;
          const timeSinceHeartbeat = Date.now() - lastHeartbeat;

          // If heartbeat is recent (< 30 seconds), bot may have recovered
          if (timeSinceHeartbeat < 30000) {
            await query(
              "UPDATE bot_instances SET status = 'RUNNING', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
              [bot.id]
            );

            // Emit recovery notification
            const io = global.io;
            if (io) {
              io.to(`user:${bot.user_id}`).emit("bot:status", {
                botId: bot.id,
                status: 'RUNNING',
                previousStatus: 'ERROR',
                reconciled: true,
                reason: 'bot_recovered',
                timestamp: Date.now(),
              });
            }

            logger.info("Bot recovered from error state", {
              botId: bot.id,
              timeSinceHeartbeat,
            });
          }
        }

      } catch (botError) {
        logger.error("Bot reconciliation error", {
          botId: bot.id,
          error: botError instanceof Error ? botError.message : String(botError),
        });
      }
    }

    // Check if engine should be stopped after reconciliation
    setTimeout(async () => {
      await engineManager.stopEngineIfNoActiveBots();
    }, 2000);

  } catch (error) {
    logger.error("Bot state reconciliation error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}, 30000); // Check every 30 seconds

export { router as botRoutes };
