/** @format */

import { Strategy, StrategyType } from "../../../shared/types";
import { tradingApi } from "../../../infrastructure/api";
import { StrategyFormData, BotInstance } from "../types/strategies.types";

/**
 * Strategy Service
 * Handles all strategy-related business logic and API calls
 */
export class StrategyService {
    private static instance: StrategyService;

    private constructor() { }

    public static getInstance(): StrategyService {
        if (!StrategyService.instance) {
            StrategyService.instance = new StrategyService();
        }
        return StrategyService.instance;
    }

    /**
     * Get all strategies
     */
    async getStrategies(): Promise<Strategy[]> {
        try {
            const response = await tradingApi.getStrategies();
            return response.success ? response.data || [] : [];
        } catch (error) {
            console.error("Strategy service getStrategies error:", error);
            return [];
        }
    }

    /**
     * Create a new strategy
     */
    async createStrategy(data: StrategyFormData): Promise<Strategy | null> {
        try {
            const response = await tradingApi.createStrategy({
                name: data.name,
                type: data.type,
                config: data.config,
            });

            if (response.success) {
                return response.data;
            }
            return null;
        } catch (error) {
            console.error("Strategy service createStrategy error:", error);
            throw error;
        }
    }

    /**
     * Update an existing strategy
     */
    async updateStrategy(id: string, data: Partial<StrategyFormData>): Promise<Strategy | null> {
        try {
            const updateData: {
                name: string;
                type: StrategyType;
                config: Record<string, unknown>;
                active?: boolean;
            } = {
                name: data.name || "",
                type: data.type || StrategyType.GRID,
                config: data.config || { type: StrategyType.GRID, config: { symbol: '', leverage: 1, gridSize: 10, gridRange: 5, orderQuantity: 1 } }
            };

            if (data.active !== undefined) updateData.active = data.active;

            const response = await tradingApi.updateStrategy(id, updateData);

            if (response.success) {
                return response.data;
            }
            return null;
        } catch (error) {
            console.error("Strategy service updateStrategy error:", error);
            throw error;
        }
    }

    /**
     * Delete a strategy
     */
    async deleteStrategy(id: string): Promise<boolean> {
        try {
            const response = await tradingApi.deleteStrategy(id);
            return response.success;
        } catch (error) {
            console.error("Strategy service deleteStrategy error:", error);
            throw error;
        }
    }

    /**
     * Get bot instance for a strategy
     */
    async getBotForStrategy(strategyId: string): Promise<BotInstance | null> {
        try {
            const response = await tradingApi.getBotInstances();
            if (response.success && response.data) {
                const bot = response.data.find((bot: { strategy_id: string }) => bot.strategy_id === strategyId);
                if (bot) {
                    return {
                        id: bot.id,
                        strategy_id: bot.strategy_id,
                        status: bot.status,
                        total_trades: bot.total_trades,
                        total_pnl: bot.total_pnl,
                        last_updated: bot.last_updated,
                        config: bot.config || { type: StrategyType.GRID, config: { symbol: '', leverage: 1, gridSize: 10, gridRange: 5, orderQuantity: 1 } }
                    };
                }
            }
            return null;
        } catch (error) {
            console.error("Strategy service getBotForStrategy error:", error);
            return null;
        }
    }

    /**
     * Get all bot instances
     */
    async getAllBotInstances(): Promise<BotInstance[]> {
        try {
            const response = await tradingApi.getBotInstances();
            if (response.success && response.data) {
                return response.data.map((bot: { strategy_id: string; status: string; total_trades: number; total_pnl: number; last_updated: string; config?: unknown }) => ({
                    id: bot.strategy_id,
                    strategy_id: bot.strategy_id,
                    status: bot.status as "RUNNING" | "STOPPED" | "ERROR" | "STARTING" | "STOPPING",
                    total_trades: bot.total_trades,
                    total_pnl: bot.total_pnl,
                    last_updated: bot.last_updated,
                    config: bot.config || { type: StrategyType.GRID, config: { symbol: '', leverage: 1, gridSize: 10, gridRange: 5, orderQuantity: 1 } }
                }));
            }
            return [];
        } catch (error) {
            console.error("Strategy service getAllBotInstances error:", error);
            return [];
        }
    }

    /**
     * Validate strategy configuration
     */
    validateStrategyConfig(type: StrategyType, config: Record<string, unknown>): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];

        switch (type) {
            case StrategyType.GRID:
                if (!config.symbol || typeof config.symbol !== 'string') {
                    errors.push("Symbol is required");
                }
                if (!config.gridSize || (typeof config.gridSize === 'number' && config.gridSize < 2)) {
                    errors.push("Grid size must be at least 2");
                }
                if (!config.gridRange || (typeof config.gridRange === 'number' && config.gridRange <= 0)) {
                    errors.push("Grid range must be positive");
                }
                if (!config.orderQuantity || (typeof config.orderQuantity === 'number' && config.orderQuantity <= 0)) {
                    errors.push("Order quantity must be positive");
                }
                break;

            default:
                errors.push(`Strategy type ${type} validation not implemented`);
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    /**
     * Format strategy type for display
     */
    formatStrategyType(type: StrategyType): string {
        return type.replace("_", " ").toLowerCase();
    }

    /**
     * Get strategy type color
     */
    getStrategyTypeColor(type: StrategyType): string {
        switch (type) {
            case StrategyType.GRID:
                return "bg-blue-500/20 text-blue-400";
            default:
                return "bg-gray-500/20 text-gray-400";
        }
    }
}

export const strategyService = StrategyService.getInstance();
