/** @format */

import { Router, Request, Response } from "express";
import Joi from "joi";
import { v4 as uuidv4 } from "uuid";
import { authService, TokenPayload } from "../core/auth/auth.service";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { Pool } from "pg";
import { query } from "../database/pool"; // ✅ Import from centralized module
import logger from "../services/logger";

const router = Router();

/*const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});*/

const strategySchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid("GRID", "TREND_FOLLOWING", "ARBITRAGE").required(),
  config: Joi.object({
    symbol: Joi.string().required(),
    leverage: Joi.number().min(1).max(20).optional(),
    gridSize: Joi.number().min(2).max(100).optional(),
    gridRange: Joi.number().min(1).max(50).optional(),
    orderQuantity: Joi.number().positive().optional(),
    takeProfit: Joi.number().positive().optional(),
    entryThreshold: Joi.number().optional(),
    exitThreshold: Joi.number().optional(),
    stopLoss: Joi.number().optional(),
  }).required(),
});

// GET /api/strategies
router.get(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM strategies WHERE user_id = $1 ORDER BY created_at DESC",
        [req.user!.userId]
      );

      res.json({
        success: true,
        data: result.rows,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get strategies error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to get strategies" });
    }
  }
);

// POST /api/strategies
router.post(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { error, value } = strategySchema.validate(req.body);
      if (error) {
        return res
          .status(400)
          .json({ success: false, error: error.details[0].message });
      }

      const result = await query(
        `INSERT INTO strategies (user_id, name, type, config)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
        [req.user!.userId, value.name, value.type, JSON.stringify(value.config)]
      );

      res.status(201).json({
        success: true,
        data: result.rows[0],
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Create strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to create strategy" });
    }
  }
);

// GET /api/strategies/:id
router.get(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM strategies WHERE id = $1 AND user_id = $2",
        [req.params.id, req.user!.userId]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      res.json({
        success: true,
        data: result.rows[0],
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
        strategyId: req.params.id,
      });
      res.status(500).json({ success: false, error: "Failed to get strategy" });
    }
  }
);

// PUT /api/strategies/:id
router.put(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { error, value } = strategySchema.validate(req.body);
      if (error) {
        return res
          .status(400)
          .json({ success: false, error: error.details[0].message });
      }

      const result = await query(
        `UPDATE strategies
       SET name = $1, type = $2, config = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
        [
          value.name,
          value.type,
          JSON.stringify(value.config),
          req.params.id,
          req.user!.userId,
        ]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      res.json({
        success: true,
        data: result.rows[0],
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Update strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
        strategyId: req.params.id,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to update strategy" });
    }
  }
);

// DELETE /api/strategies/:id
router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if strategy exists
      const existing = await query(
        "SELECT id FROM strategies WHERE id = $1 AND user_id = $2",
        [req.params.id, req.user!.userId]
      );

      if (existing.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      // Delete associated bot instances first
      await query("DELETE FROM bot_instances WHERE strategy_id = $1", [
        req.params.id,
      ]);

      // Delete the strategy
      await query("DELETE FROM strategies WHERE id = $1 AND user_id = $2", [
        req.params.id,
        req.user!.userId,
      ]);

      res.json({
        success: true,
        message: "Strategy deleted",
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Delete strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
        strategyId: req.params.id,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to delete strategy" });
    }
  }
);

// GET /api/strategies/:id/performance
router.get(
  "/:id/performance",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const strategyResult = await query(
        "SELECT id FROM strategies WHERE id = $1 AND user_id = $2",
        [req.params.id, req.user!.userId]
      );

      if (strategyResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      // Get trade statistics
      const statsResult = await query(
        `SELECT
         COUNT(*) as total_trades,
         COALESCE(SUM(pnl), 0) as total_pnl,
         COALESCE(AVG(pnl), 0) as avg_pnl
       FROM trades
       WHERE strategy_id = $1`,
        [req.params.id]
      );

      // Get recent trades
      const recentTrades = await query(
        "SELECT * FROM trades WHERE strategy_id = $1 ORDER BY executed_at DESC LIMIT 10",
        [req.params.id]
      );

      res.json({
        success: true,
        data: {
          stats: statsResult.rows[0],
          recentTrades: recentTrades.rows,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get performance error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user!.userId,
        strategyId: req.params.id,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to get performance" });
    }
  }
);

export { router as strategyRoutes };
