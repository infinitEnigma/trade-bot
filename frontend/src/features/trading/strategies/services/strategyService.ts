/** @format */

import { Strategy, StrategyType } from "@trade-bot/shared";
import { tradingApi } from "../../../../infrastructure/api";
import { StrategyFormData } from "../../types/trading.types";

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
            const updateData: any = {};
            if (data.name !== undefined) updateData.name = data.name;
            if (data.type !== undefined) updateData.type = data.type;
            if (data.config !== undefined) updateData.config = data.config;
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
    async getBotForStrategy(strategyId: string): Promise<any | null> {
        try {
            const response = await tradingApi.getBotInstances();
            if (response.success && response.data) {
                return response.data.find((bot: any) => bot.strategy_id === strategyId) || null;
            }
            return null;
        } catch (error) {
            console.error("Strategy service getBotForStrategy error:", error);
            return null;
        }
    }

    /**
     * Validate strategy configuration
     */
    validateStrategyConfig(type: StrategyType, config: Record<string, any>): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];

        switch (type) {
            case StrategyType.GRID:
                if (!config.symbol || typeof config.symbol !== 'string') {
                    errors.push("Symbol is required");
                }
                if (!config.gridSize || config.gridSize < 2) {
                    errors.push("Grid size must be at least 2");
                }
                if (!config.gridRange || config.gridRange <= 0) {
                    errors.push("Grid range must be positive");
                }
                if (!config.orderQuantity || config.orderQuantity <= 0) {
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
