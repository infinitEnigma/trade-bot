/**
 * Strategy Service
 *
 * Handles strategy operations including creation, retrieval, updating, and deletion.
 * Provides centralized strategy management with proper validation and business logic.
 *
 * @format
 */

import logger from "../../core/logging/logger.service";
import { IStrategyRepository, IBotInstanceRepository } from "@trade-bot/shared";
import { strategyRepositoryAdapter } from "../../infrastructure/adapters/repositories/strategy-repository.adapter";
import { botInstanceRepositoryAdapter } from "../../infrastructure/adapters/repositories/bot-instance-repository.adapter";

export interface StrategyServiceDependencies {
    strategyRepository: IStrategyRepository;
    botInstanceRepository: IBotInstanceRepository;
}

export class StrategyService {
    constructor(private deps: StrategyServiceDependencies) { }

    /**
     * Get all strategies for a user
     */
    async getStrategies(userId: string): Promise<any[]> {
        try {
            const strategies = await this.deps.strategyRepository.getStrategies(userId);
            logger.debug("Strategies retrieved successfully", { userId, count: strategies.length });
            return strategies;
        } catch (error) {
            logger.error("Failed to get strategies", {
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
            logger.debug("Strategy retrieved successfully", { strategyId: id });
            return strategy;
        } catch (error) {
            logger.error("Failed to get strategy", {
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
            logger.info("Strategy created successfully", {
                strategyId: strategy.id,
                userId
            });
            return strategy;
        } catch (error) {
            logger.error("Failed to create strategy", {
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
            logger.info("Strategy updated successfully", { strategyId: id });
            return updatedStrategy;
        } catch (error) {
            logger.error("Failed to update strategy", {
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
            logger.info("Strategy deleted successfully", { strategyId: id });
        } catch (error) {
            logger.error("Failed to delete strategy", {
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
            logger.info("Strategy status toggled", { strategyId: id, active });
        } catch (error) {
            logger.error("Failed to toggle strategy", {
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
            logger.error("Failed to get strategy performance", {
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

// Legacy singleton instance for backward compatibility
export const strategyService = createStrategyService({
    strategyRepository: strategyRepositoryAdapter,
    botInstanceRepository: botInstanceRepositoryAdapter
});