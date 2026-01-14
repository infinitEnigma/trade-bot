/** @format */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { authService } from "../services/auth";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { Pool } from "pg";

const router = Router();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

// GET /api/bot/instances
router.get(
  "/instances",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await pool.query(
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
      console.error("Get bot instances error:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to get bot instances" });
    }
  }
);

// POST /api/bot/start
router.post(
  "/start",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { strategyId, notionalAmount } = req.body;

      if (!strategyId || !notionalAmount) {
        return res
          .status(400)
          .json({ success: false, error: "Strategy ID and notional amount required" });
      }

      // Verify strategy belongs to user
      const strategyResult = await pool.query(
        "SELECT * FROM strategies WHERE id = $1 AND user_id = $2",
        [strategyId, req.user!.userId]
      );

      if (strategyResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      const strategy = strategyResult.rows[0];

      // Check if bot already exists
      const existingBot = await pool.query(
        "SELECT * FROM bot_instances WHERE strategy_id = $1 AND status IN ('RUNNING', 'STARTING')",
        [strategyId]
      );

      if (existingBot.rows.length > 0) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Bot already running for this strategy",
          });
      }

      // ✅ POSITION VALIDATION: Validate position size before starting bot
      const { validateUserPosition } = await import('../services/position-validator.js');
      const validation = await validateUserPosition(
        req.user!.userId,
        parseFloat(notionalAmount),
        strategy.config?.symbol || 'PERP_BTC_USDC'
      );

      if (!validation.isValid) {
        return res.status(402).json({
          success: false,
          error: validation.reason,
          data: {
            requested: notionalAmount,
            max_allowed: validation.maxAllowed,
            recommended: validation.recommended,
          },
        });
      }

      // Create bot instance
      const botId = uuidv4();
      await pool.query(
        `INSERT INTO bot_instances (id, strategy_id, user_id, status, running_time, total_trades, total_pnl)
       VALUES ($1, $2, $3, 'RUNNING', 0, 0, 0)`,
        [botId, strategyId, req.user!.userId]
      );

      // Update strategy as active
      await pool.query("UPDATE strategies SET active = true WHERE id = $1", [
        strategyId,
      ]);

      // Emit WebSocket event to notify bot engine
      const io = req.app.get("io");
      io.emit("bot:start", { botId, strategyId, strategy });

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
      console.error("Start bot error:", err);
      res.status(500).json({ success: false, error: "Failed to start bot" });
    }
  }
);

// POST /api/bot/stop
router.post(
  "/stop",
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
      const botResult = await pool.query(
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

      // Update bot status
      await pool.query(
        "UPDATE bot_instances SET status = 'STOPPED' WHERE id = $1",
        [botId]
      );

      // Update strategy as inactive
      await pool.query("UPDATE strategies SET active = false WHERE id = $1", [
        bot.strategy_id,
      ]);

      // Emit WebSocket event to notify bot engine
      const io = req.app.get("io");
      io.emit("bot:stop", { botId, strategyId: bot.strategy_id });

      res.json({
        success: true,
        data: {
          botId,
          status: "STOPPED",
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Stop bot error:", err);
      res.status(500).json({ success: false, error: "Failed to stop bot" });
    }
  }
);

// GET /api/bot/status/:botId
router.get(
  "/status/:botId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT bi.*, s.name as strategy_name, s.type as strategy_type
       FROM bot_instances bi
       JOIN strategies s ON bi.strategy_id = s.id
       WHERE bi.id = $1 AND bi.user_id = $2`,
        [req.params.botId, req.user!.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Bot not found" });
      }

      res.json({
        success: true,
        data: result.rows[0],
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Get bot status error:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to get bot status" });
    }
  }
);

// GET /api/bot/performance/:botId
router.get(
  "/performance/:botId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const botResult = await pool.query(
        "SELECT * FROM bot_instances WHERE id = $1 AND user_id = $2",
        [req.params.botId, req.user!.userId]
      );

      if (botResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Bot not found" });
      }

      const bot = botResult.rows[0];

      // Get trade statistics
      const statsResult = await pool.query(
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
      const dailyResult = await pool.query(
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
      console.error("Get bot performance error:", err);
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
      const botResult = await pool.query(
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
      await pool.query(
        "UPDATE bot_instances SET status = 'FORCE_STOPPING' WHERE id = $1",
        [botId]
      );

      // Log emergency stop action
      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
        [req.user!.userId, "EMERGENCY_STOP", { botId, strategyId: bot.strategy_id }]
      );

      // Emit WebSocket event to notify bot engine - CANCEL_ALL_ORDERS
      const io = req.app.get("io");
      io.emit("bot:emergency-stop", {
        botId,
        strategyId: bot.strategy_id,
        action: 'CANCEL_ALL_ORDERS',
        timestamp: Date.now()
      });

      // Set timeout to mark as stopped if bot doesn't respond
      setTimeout(async () => {
        try {
          const currentBot = await pool.query(
            "SELECT status FROM bot_instances WHERE id = $1",
            [botId]
          );

          if (currentBot.rows[0]?.status === 'FORCE_STOPPING') {
            await pool.query(
              "UPDATE bot_instances SET status = 'STOPPED' WHERE id = $1",
              [botId]
            );

            // Update strategy as inactive
            await pool.query("UPDATE strategies SET active = false WHERE id = $1", [
              bot.strategy_id,
            ]);
          }
        } catch (error) {
          console.error('Emergency stop timeout error:', error);
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
      console.error("Emergency stop error:", err);
      res.status(500).json({ success: false, error: "Failed to initiate emergency stop" });
    }
  }
);

// POST /api/bot/heartbeat (called by bot engine)
router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const { bot_id, status, position, exposure, timestamp } = req.body;

    if (!bot_id) {
      return res
        .status(400)
        .json({ success: false, error: "Bot ID required" });
    }

    // Update bot with heartbeat data
    await pool.query(
      `UPDATE bot_instances
       SET status = $1, position = $2, exposure = $3, last_heartbeat = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [status, position || 0, exposure || 0, new Date(timestamp || Date.now()), bot_id]
    );

    console.log(`❤️ Bot ${bot_id} heartbeat: status=${status}, position=${position}, exposure=${exposure}`);

    res.json({ success: true });
  } catch (err) {
    console.error("Heartbeat error:", err);
    res.status(500).json({ success: false, error: "Failed to record heartbeat" });
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
    await pool.query(
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
      await pool.query(
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
    console.error("Report trade error:", err);
    res.status(500).json({ success: false, error: "Failed to report trade" });
  }
});

// Dead bot detection - runs every 10 seconds
setInterval(async () => {
  try {
    const deadBots = await pool.query(
      `SELECT id, strategy_id FROM bot_instances
       WHERE status IN ('RUNNING', 'FORCE_STOPPING')
       AND last_heartbeat < NOW() - INTERVAL '60 seconds'`
    );

    for (const bot of deadBots.rows) {
      console.log(`💀 Detected dead bot: ${bot.id}, marking as ERROR`);

      // Mark bot as dead/error
      await pool.query(
        "UPDATE bot_instances SET status = 'ERROR', last_error = 'Bot heartbeat timeout - marked as dead' WHERE id = $1",
        [bot.id]
      );

      // Update strategy as inactive
      await pool.query("UPDATE strategies SET active = false WHERE id = $1", [
        bot.strategy_id,
      ]);

      // Log the dead bot detection
      await pool.query(
        "INSERT INTO audit_logs (user_id, action, details) VALUES ((SELECT user_id FROM bot_instances WHERE id = $1), $2, $3)",
        [bot.id, "BOT_DEAD_DETECTED", { botId: bot.id, reason: "heartbeat_timeout" }]
      );
    }
  } catch (error) {
    console.error('Dead bot detection error:', error);
  }
}, 10000); // Check every 10 seconds

export { router as botRoutes };
