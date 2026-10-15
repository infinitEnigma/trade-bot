/**
 * Pure Strategy Service - Clean Architecture Implementation
 *
 * Business logic for strategy operations including creation, retrieval, updating, and deletion.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IStrategyRepository: Strategy data access abstraction
 * - IBotInstanceRepository: Bot instance data access abstraction
 * - ILogger: Logging abstraction
 *
 * @format
 */

import {
  IStrategyRepository,
  IBotInstanceRepository,
  ILogger,
  Strategy,
  StrategyConfig,
  StrategyType,
  StrategyVenue,
} from "@trade-bot/shared";

export interface StrategyServiceDependencies {
  strategyRepository: IStrategyRepository;
  botInstanceRepository: IBotInstanceRepository;
  logger: ILogger;
}

/** Placeholder performance metrics returned by `getStrategyPerformance`. */
export interface StrategyPerformanceMetrics {
  totalTrades: number;
  totalPnL: number;
  winRate: number;
  avgTrade: number;
  bestTrade: number;
  worstTrade: number;
}

export class StrategyService {
  constructor(private deps: StrategyServiceDependencies) {}

  /**
   * Get all strategies for a user
   */
  async getStrategies(userId: string): Promise<Strategy[]> {
    try {
      const strategies =
        await this.deps.strategyRepository.getStrategies(userId);
      this.deps.logger.debug("Strategies retrieved successfully", {
        userId,
        count: strategies.length,
      });
      return strategies;
    } catch (error) {
      this.deps.logger.error("Failed to get strategies", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw new Error("Failed to get strategies");
    }
  }

  /**
   * Get strategy by ID
   */
  async getStrategy(id: string): Promise<Strategy | null> {
    try {
      const strategy = await this.deps.strategyRepository.getStrategy(id);
      this.deps.logger.debug("Strategy retrieved successfully", {
        strategyId: id,
      });
      return strategy;
    } catch (error) {
      this.deps.logger.error("Failed to get strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      throw new Error("Failed to get strategy");
    }
  }

  /**
   * Create a new strategy
   */
  async createStrategy(
    userId: string,
    strategyData: Omit<Strategy, "id" | "userId" | "createdAt" | "updatedAt">
  ): Promise<Strategy> {
    try {
      const strategy = await this.deps.strategyRepository.createStrategy({
        userId,
        ...strategyData,
      });
      this.deps.logger.info("Strategy created successfully", {
        strategyId: strategy.id,
        userId,
      });
      return strategy;
    } catch (error) {
      this.deps.logger.error("Failed to create strategy", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        strategyData,
      });
      throw new Error("Failed to create strategy");
    }
  }

  /**
   * Full-replacement update (migration 026). The caller supplies the complete
   * strategy — name, type, full config, and the atomic venue pair. Partial
   * config patches are rejected: a partial would be serialized over the whole
   * JSONB column and silently erase omitted fields.
   */
  async updateStrategy(
    id: string,
    updates: {
      name: string;
      type: StrategyType;
      config: StrategyConfig;
      exchange: StrategyVenue["exchange"];
      environment: StrategyVenue["environment"];
    }
  ): Promise<Strategy | null> {
    try {
      StrategyService.assertCompleteConfig(updates.type, updates.config);
      await this.deps.strategyRepository.updateStrategy(id, updates);
      const updatedStrategy =
        await this.deps.strategyRepository.getStrategy(id);
      this.deps.logger.info("Strategy updated successfully", {
        strategyId: id,
      });
      return updatedStrategy;
    } catch (error) {
      this.deps.logger.error("Failed to update strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
        updates,
      });
      if ((error as Error & { statusCode?: number }).statusCode) throw error;
      throw new Error("Failed to update strategy");
    }
  }

  /**
   * Validate that `config` is complete for `type` (migration 026). Mirrors
   * the route Joi schemas — the three layers (API, service, repository
   * contract) enforce the same rules so Joi never accepts what the service
   * rejects, and the service never persists an incomplete config.
   */
  static assertCompleteConfig(
    type: StrategyType,
    config: StrategyConfig
  ): void {
    const fail = (message: string): never => {
      const error = new Error(message);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    };
    if (!config || typeof config.symbol !== "string" || !config.symbol.trim()) {
      fail("Strategy config is missing symbol");
    }
    if (type === StrategyType.GRID) {
      if (
        !Number.isInteger(config.gridSize) ||
        (config.gridSize as number) < 2
      ) {
        fail("GRID config requires gridSize (integer >= 2)");
      }
      if (
        typeof config.gridRange !== "number" ||
        !((config.gridRange as number) > 0)
      ) {
        fail("GRID config requires gridRange (positive number)");
      }
      if (
        typeof config.orderQuantity !== "number" ||
        !((config.orderQuantity as number) > 0)
      ) {
        fail("GRID config requires orderQuantity (positive number)");
      }
    } else if (type === StrategyType.TREND_FOLLOWING) {
      if (
        typeof config.entryThreshold !== "number" ||
        typeof config.exitThreshold !== "number"
      ) {
        fail(
          "TREND_FOLLOWING config requires entryThreshold and exitThreshold"
        );
      }
    }
  }

  /**
   * Guarded full-replacement update (migration 026, P0 race). The edit
   * blocker check and the write share one strategy-row `FOR UPDATE` lock so
   * a start/attach racing this PUT cannot interleave: either the edit commits
   * first (admission revalidates the new row) or admission wins (PUT 409s).
   * Only symbol/venue-affecting fields go through the blocker gate — but the
   * write itself is always the full replacement, so the row never holds a
   * half-applied patch.
   */
  async updateStrategyGuarded(
    id: string,
    updates: {
      name: string;
      type: StrategyType;
      config: StrategyConfig;
      exchange: StrategyVenue["exchange"];
      environment: StrategyVenue["environment"];
    }
  ): Promise<Strategy | null> {
    StrategyService.assertCompleteConfig(updates.type, updates.config);
    const { transaction } = await import("../../database/pool");
    const { BotLifecycleRepository } =
      await import("../bots/lifecycle/bot-lifecycle.repository");
    const lifecycleRepo = new BotLifecycleRepository();
    try {
      await transaction(async client => {
        const locked = await lifecycleRepo.lockStrategyRow(client, id);
        if (!locked) {
          const notFound = new Error("Strategy not found");
          (notFound as Error & { statusCode?: number }).statusCode = 404;
          throw notFound;
        }
        const symbolChanged =
          String(
            (updates.config as unknown as { symbol?: unknown }).symbol ?? ""
          ) !== locked.symbol;
        const venueChanged =
          updates.exchange !== locked.exchange ||
          updates.environment !== locked.environment;
        if (symbolChanged || venueChanged) {
          const block = await lifecycleRepo.findEditBlockersTx(client, id);
          if (block.blocked) {
            const locked_err = new Error(
              `Strategy cannot be edited while live: ${block.reason}. Stop the run and resolve orders/exposure first.`
            );
            (locked_err as Error & { statusCode?: number }).statusCode = 409;
            throw locked_err;
          }
        }
        await this.deps.strategyRepository.updateStrategyTx?.(
          id,
          updates,
          client
        );
        if (!this.deps.strategyRepository.updateStrategyTx) {
          await this.deps.strategyRepository.updateStrategy(id, updates);
        }
      });
      return this.deps.strategyRepository.getStrategy(id);
    } catch (error) {
      this.deps.logger.error("Failed guarded strategy update", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      if ((error as Error & { statusCode?: number }).statusCode) throw error;
      throw new Error("Failed to update strategy");
    }
  }

  /**
   * Delete strategy
   */
  async deleteStrategy(id: string): Promise<void> {
    try {
      // Delete ALL associated bot instances first — live and terminal.
      // getActiveBotInstances only covers live rows (legacy `status`), so a
      // strategy delete through it would leak STOPPED/ERROR/UNKNOWN history
      // that keeps blocking the venue-account revoke (FK RESTRICT, 013).
      // The strategy→bot FK is ON DELETE CASCADE (001), but the explicit
      // per-row delete also clears lifecycle children deterministically.
      const botInstances =
        await this.deps.botInstanceRepository.getBotInstancesByStrategy(id);
      for (const botInstance of botInstances) {
        await this.deps.botInstanceRepository.deleteBotInstance(botInstance.id);
      }

      // Delete the strategy
      await this.deps.strategyRepository.deleteStrategy(id);
      this.deps.logger.info("Strategy deleted successfully", {
        strategyId: id,
      });
    } catch (error) {
      this.deps.logger.error("Failed to delete strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      throw new Error("Failed to delete strategy");
    }
  }

  /**
   * Toggle strategy active status
   */
  async toggleStrategy(id: string, active: boolean): Promise<void> {
    try {
      await this.deps.strategyRepository.toggleStrategy(id, active);
      this.deps.logger.info("Strategy status toggled", {
        strategyId: id,
        active,
      });
    } catch (error) {
      this.deps.logger.error("Failed to toggle strategy", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
        active,
      });
      throw new Error("Failed to toggle strategy");
    }
  }

  /**
   * Get strategy performance metrics
   */
  async getStrategyPerformance(
    id: string
  ): Promise<StrategyPerformanceMetrics> {
    try {
      // This would typically query trade repository for performance data
      // For now, return placeholder data
      return {
        totalTrades: 0,
        totalPnL: 0,
        winRate: 0,
        avgTrade: 0,
        bestTrade: 0,
        worstTrade: 0,
      };
    } catch (error) {
      this.deps.logger.error("Failed to get strategy performance", {
        error: error instanceof Error ? error.message : String(error),
        strategyId: id,
      });
      throw new Error("Failed to get strategy performance");
    }
  }
}

// Export factory function for creating service instances
export function createStrategyService(
  deps: StrategyServiceDependencies
): StrategyService {
  return new StrategyService(deps);
}
