/** @format */

import { Router, Response } from "express";
import Joi from "joi";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";
import { diContainer } from "../../../infrastructure/dependency-injection.container";
import { assertSymbolSupported } from "../../../infrastructure/external/venue-symbols";

const router = Router();

const gridConfigSchema = Joi.object({
  symbol: Joi.string().required(),
  gridSize: Joi.number().integer().min(2).max(100).required(),
  gridRange: Joi.number().min(1).max(50).required(),
  orderQuantity: Joi.number().positive().required(),
  leverage: Joi.number().min(1).max(20).optional(),
  takeProfit: Joi.number().positive().optional(),
  stopLoss: Joi.number().min(0.1).max(50).optional(),
  entryThreshold: Joi.forbidden(),
  exitThreshold: Joi.forbidden(),
  exchange: Joi.forbidden(),
  environment: Joi.forbidden(),
}).unknown(false);

const trendConfigSchema = Joi.object({
  symbol: Joi.string().required(),
  entryThreshold: Joi.number().required(),
  exitThreshold: Joi.number().required(),
  leverage: Joi.number().min(1).max(20).optional(),
  takeProfit: Joi.number().positive().optional(),
  stopLoss: Joi.number().min(0.1).max(50).optional(),
  gridSize: Joi.forbidden(),
  gridRange: Joi.forbidden(),
  orderQuantity: Joi.forbidden(),
  exchange: Joi.forbidden(),
  environment: Joi.forbidden(),
}).unknown(false);

const fallbackConfigSchema = Joi.object({
  symbol: Joi.string().required(),
  exchange: Joi.forbidden(),
  environment: Joi.forbidden(),
}).unknown(false);

const strategySchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid("GRID", "TREND_FOLLOWING", "ARBITRAGE").required(),
  // Venue pair (migration 026): top-level, atomic, never inside config.
  exchange: Joi.string().valid("kodiak", "lighter").required(),
  environment: Joi.string().valid("testnet", "mainnet").required(),
  config: Joi.alternatives()
    .conditional(Joi.ref("type"), {
      switch: [
        { is: "GRID", then: gridConfigSchema },
        { is: "TREND_FOLLOWING", then: trendConfigSchema },
      ],
      otherwise: fallbackConfigSchema,
    })
    .required(),
}).unknown(false);

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

      const strategies = await diContainer.strategyService.getStrategies(
        req.user.userId
      );

      res.json({
        success: true,
        data: strategies,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get strategies error", err as Error, {
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

      const strategy = await diContainer.strategyService.createStrategy(
        req.user.userId,
        value
      );

      res.status(201).json({
        success: true,
        data: strategy,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Create strategy error", err as Error, {
        userId: req.user?.userId,
      });
      // Business rejections (e.g. incomplete config) carry statusCode and
      // must reach the client — only genuine unknowns become 500.
      const statusCode =
        (err as Error & { statusCode?: number }).statusCode ?? 500;
      res.status(statusCode).json({
        success: false,
        error:
          statusCode === 500
            ? "Failed to create strategy"
            : (err as Error).message,
      });
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
      const strategy =
        await diContainer.strategyService.getStrategy(strategyId);

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
      logger.error("Get strategy error", err as Error, {
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
      const existingStrategy =
        await diContainer.strategyService.getStrategy(strategyId);
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

      // Guarded edit (migration 026): symbol/venue changes are refused while
      // the strategy is operationally active. The check + write share one
      // strategy-row lock (strategy service → guarded repository tx), so a
      // start racing this PUT either wins first (PUT gets 409) or loses
      // (admission revalidates the new row). Symbol re-check runs against
      // the strategy's OWN venue, fail-open on catalog outage (PUT path).
      try {
        const newSymbol = String(
          (value.config as { symbol?: unknown })?.symbol ?? ""
        );
        const oldSymbol = String(
          (existingStrategy.config as unknown as { symbol?: unknown })
            ?.symbol ?? ""
        );
        if (newSymbol && newSymbol !== oldSymbol) {
          await assertSymbolSupported(
            newSymbol,
            String(value.exchange),
            String(value.environment)
          );
        }
        await diContainer.strategyService.updateStrategyGuarded(
          strategyId,
          value
        );
      } catch (guardErr) {
        const guardStatus =
          (guardErr as Error & { statusCode?: number }).statusCode ?? 500;
        if (guardStatus === 400 || guardStatus === 404 || guardStatus === 409) {
          return res
            .status(guardStatus)
            .json({ success: false, error: (guardErr as Error).message });
        }
        throw guardErr;
      }

      const updatedStrategy =
        await diContainer.strategyService.getStrategy(strategyId);

      res.json({
        success: true,
        data: updatedStrategy,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Update strategy error", err as Error, {
        userId: req.user?.userId,
        strategyId: req.params.id,
      });
      const statusCode =
        (err as Error & { statusCode?: number }).statusCode ?? 500;
      res.status(statusCode).json({
        success: false,
        error:
          statusCode === 500
            ? "Failed to update strategy"
            : (err as Error).message,
      });
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
      const existingStrategy =
        await diContainer.strategyService.getStrategy(strategyId);
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
      logger.error("Delete strategy error", err as Error, {
        userId: req.user?.userId,
        strategyId: req.params.id,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to delete strategy" });
    }
  }
);

// GET /api/strategies/performance — grouped lifetime aggregates for all
// strategies owned by the caller (master-list PnL). Single SQL query, no N+1.
router.get(
  "/performance",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        throw new Error("User not authenticated");
      }

      const performance =
        await diContainer.strategyService.getStrategyPerformanceByUser(
          req.user.userId
        );

      res.json({
        success: true,
        data: performance,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get grouped performance error", err as Error, {
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to get performance" });
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
      const strategyResult =
        await diContainer.strategyService.getStrategy(strategyId);
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
      const performance =
        await diContainer.strategyService.getStrategyPerformance(strategyId);

      res.json({
        success: true,
        data: performance,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error("Get performance error", err as Error, {
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
