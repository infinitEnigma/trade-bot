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
    ILogger
} from "@trade-bot/shared";

export interface StrategyServiceDependencies {
    strategyRepository: IStrategyRepository;
    botInstanceRepository: IBotInstanceRepository;
    logger: ILogger;
}

export class StrategyService {
    constructor(private deps: StrategyServiceDependencies) { }

    /**
     * Get all strategies for a user
     */
    async getStrategies(userId: string): Promise<any[]> {
        try {
            const strategies = await this.deps.strategyRepository.getStrategies(userId);
            this.deps.logger.debug("Strategies retrieved successfully", { userId, count: strategies.length });
            return strategies;
        } catch (error) {
            this.deps.logger.error("Failed to get strategies", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw new Error("Failed to get strategies");
        }
    }

    /**
     * Get strategy by ID
     */
    async getStrategy(id: string): Promise<any | null> {
        try {
            const strategy = await this.deps.strategyRepository.getStrategy(id);
            this.deps.logger.debug("Strategy retrieved successfully", { strategyId: id });
            return strategy;
        } catch (error) {
            this.deps.logger.error("Failed to get strategy", {
                error: error instanceof Error ? error.message : String(error),
                strategyId: id
            });
            throw new Error("Failed to get strategy");
        }
    }

    /**
     * Create a new strategy
     */
    async createStrategy(userId: string, strategyData: any): Promise<any> {
        try {
            const strategy = await this.deps.strategyRepository.createStrategy({
                userId,
                ...strategyData
            });
            this.deps.logger.info("Strategy created successfully", {
                strategyId: strategy.id,
                userId
            });
            return strategy;
        } catch (error) {
            this.deps.logger.error("Failed to create strategy", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                strategyData
            });
            throw new Error("Failed to create strategy");
        }
    }

    /**
     * Update strategy
     */
    async updateStrategy(id: string, updates: any): Promise<any> {
        try {
            await this.deps.strategyRepository.updateStrategy(id, updates);
            const updatedStrategy = await this.deps.strategyRepository.getStrategy(id);
            this.deps.logger.info("Strategy updated successfully", { strategyId: id });
            return updatedStrategy;
        } catch (error) {
            this.deps.logger.error("Failed to update strategy", {
                error: error instanceof Error ? error.message : String(error),
                strategyId: id,
                updates
            });
            throw new Error("Failed to update strategy");
        }
    }

    /**
     * Delete strategy
     */
    async deleteStrategy(id: string): Promise<void> {
        try {
            // Delete associated bot instances first
            const botInstances = await this.deps.botInstanceRepository.getActiveBotInstances();
            const strategyBotInstances = botInstances.filter(bot => bot.strategy_id === id);
            for (const botInstance of strategyBotInstances) {
                await this.deps.botInstanceRepository.deleteBotInstance(botInstance.id);
            }

            // Delete the strategy
            await this.deps.strategyRepository.deleteStrategy(id);
            this.deps.logger.info("Strategy deleted successfully", { strategyId: id });
        } catch (error) {
            this.deps.logger.error("Failed to delete strategy", {
                error: error instanceof Error ? error.message : String(error),
                strategyId: id
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
            this.deps.logger.info("Strategy status toggled", { strategyId: id, active });
        } catch (error) {
            this.deps.logger.error("Failed to toggle strategy", {
                error: error instanceof Error ? error.message : String(error),
                strategyId: id,
                active
            });
            throw new Error("Failed to toggle strategy");
        }
    }

    /**
     * Get strategy performance metrics
     */
    async getStrategyPerformance(id: string): Promise<any> {
        try {
            // This would typically query trade repository for performance data
            // For now, return placeholder data
            return {
                totalTrades: 0,
                totalPnL: 0,
                winRate: 0,
                avgTrade: 0,
                bestTrade: 0,
                worstTrade: 0
            };
        } catch (error) {
            this.deps.logger.error("Failed to get strategy performance", {
                error: error instanceof Error ? error.message : String(error),
                strategyId: id
            });
            throw new Error("Failed to get strategy performance");
        }
    }
}

// Export factory function for creating service instances
export function createStrategyService(deps: StrategyServiceDependencies): StrategyService {
    return new StrategyService(deps);
}
