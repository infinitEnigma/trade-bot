/** @format */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { authService, TokenPayload } from "../services/auth";
import { Pool } from "pg";

const router = Router();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: () => void
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ success: false, error: "No token provided" });
  }

  const payload = await authService.validateToken(token);
  if (!payload) {
    return res.status(403).json({ success: false, error: "Invalid token" });
  }

  req.user = payload;
  next();
};

// GET /api/bot/instances
router.get(
  "/instances",
  authenticateToken,
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
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { strategyId } = req.body;

      if (!strategyId) {
        return res
          .status(400)
          .json({ success: false, error: "Strategy ID required" });
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
        "SELECT * FROM bot_instances WHERE strategy_id = $1 AND status = 'RUNNING'",
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
  authenticateToken,
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
  authenticateToken,
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
  authenticateToken,
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

export { router as botRoutes };
