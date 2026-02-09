/** @format */

import { Router, Response } from "express";
import Joi from "joi";
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth.middleware";
import logger from "../../../core/logging/logger.service";
import { diContainer } from "../../../infrastructure/dependency-injection.container";

const router = Router();

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
      // Ensure user is authenticated (should always be true due to authMiddleware)
      if (!req.user) {
        throw new Error("User not authenticated");
      }

      const strategies = await diContainer.strategyService.getStrategies(req.user.userId);

      res.json({
        success: true,
        data: strategies,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get strategies error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user?.userId,
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
      // Ensure user is authenticated (should always be true due to authMiddleware)
      if (!req.user) {
        throw new Error("User not authenticated");
      }

      const { error, value } = strategySchema.validate(req.body);
      if (error) {
        return res
          .status(400)
          .json({ success: false, error: error.details[0].message });
      }

      const strategy = await diContainer.strategyService.createStrategy(req.user.userId, value);

      res.status(201).json({
        success: true,
        data: strategy,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Create strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user?.userId,
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
      // Ensure user is authenticated (should always be true due to authMiddleware)
      if (!req.user) {
        throw new Error("User not authenticated");
      }

      const strategyId = req.params.id as string;
      const strategy = await diContainer.strategyService.getStrategy(strategyId);

      if (!strategy) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      // Verify user ownership
      if (strategy.userId !== req.user.userId) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      res.json({
        success: true,
        data: strategy,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user?.userId,
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
      // Ensure user is authenticated (should always be true due to authMiddleware)
      if (!req.user) {
        throw new Error("User not authenticated");
      }

      const { error, value } = strategySchema.validate(req.body);
      if (error) {
        return res
          .status(400)
          .json({ success: false, error: error.details[0].message });
      }

      const strategyId = req.params.id as string;
      // Verify strategy exists and belongs to user
      const existingStrategy = await diContainer.strategyService.getStrategy(strategyId);
      if (!existingStrategy) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      if (existingStrategy.userId !== req.user.userId) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      const updatedStrategy = await diContainer.strategyService.updateStrategy(strategyId, value);

      res.json({
        success: true,
        data: updatedStrategy,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Update strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user?.userId,
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
      // Ensure user is authenticated (should always be true due to authMiddleware)
      if (!req.user) {
        throw new Error("User not authenticated");
      }

      const strategyId = req.params.id as string;
      // Verify strategy exists and belongs to user
      const existingStrategy = await diContainer.strategyService.getStrategy(strategyId);
      if (!existingStrategy) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      if (existingStrategy.userId !== req.user.userId) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      await diContainer.strategyService.deleteStrategy(strategyId);

      res.json({
        success: true,
        message: "Strategy deleted",
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Delete strategy error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user?.userId,
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
      // Ensure user is authenticated (should always be true due to authMiddleware)
      if (!req.user) {
        throw new Error("User not authenticated");
      }

      const strategyId = req.params.id as string;
      // Verify strategy exists and belongs to user
      const strategyResult = await diContainer.strategyService.getStrategy(strategyId);
      if (!strategyResult) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      if (strategyResult.userId !== req.user.userId) {
        return res
          .status(404)
          .json({ success: false, error: "Strategy not found" });
      }

      // Get strategy performance
      const performance = await diContainer.strategyService.getStrategyPerformance(strategyId);

      res.json({
        success: true,
        data: performance,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get performance error", {
        error: err instanceof Error ? err.message : String(err),
        userId: req.user?.userId,
        strategyId: req.params.id,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to get performance" });
    }
  }
);

export { router as strategyRoutes };
