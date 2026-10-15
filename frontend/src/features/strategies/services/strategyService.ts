/** @format */

import { Strategy, StrategyType } from "../../../shared/types";
import { tradingApi } from "../../../infrastructure/api";
import {
  StrategyFormData,
  BotInstance,
  StrategyRun,
  getSessionForStrategy,
} from "../types/strategies.types";

/**
 * Strategy Service
 * Handles all strategy-related business logic and API calls
 */
export class StrategyService {
  private static instance: StrategyService;

  private constructor() {}

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
      const cfg = data.config as unknown as {
        config?: Record<string, unknown>;
      } & Record<string, unknown>;
      const geometry = (cfg.config ?? cfg) as Record<string, unknown>;
      const response = await tradingApi.createStrategy({
        name: data.name,
        type: data.type,
        exchange: data.exchange,
        environment: data.environment,
        config: geometry,
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
  async updateStrategy(
    id: string,
    data: Partial<StrategyFormData>
  ): Promise<Strategy | null> {
    try {
      const cfg = (data.config ?? {
        type: StrategyType.GRID,
        config: {
          symbol: "",
          leverage: 1,
          gridSize: 10,
          gridRange: 5,
          orderQuantity: 1,
        },
      }) as unknown as { config?: Record<string, unknown> } & Record<
        string,
        unknown
      >;
      const geometry = (cfg.config ?? cfg) as Record<string, unknown>;
      const updateData: {
        name: string;
        type: StrategyType;
        exchange: "kodiak" | "lighter";
        environment: "testnet" | "mainnet";
        config: Record<string, unknown>;
        active?: boolean;
      } = {
        name: data.name || "",
        type: data.type || StrategyType.GRID,
        exchange: data.exchange || "lighter",
        environment: data.environment || "testnet",
        config: geometry,
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
   * Get bot instance for a strategy (D4 sessions: via the session's runs).
   */
  async getBotForStrategy(strategyId: string): Promise<BotInstance | null> {
    try {
      const response = await tradingApi.getBotInstances();
      if (response.success && response.data) {
        const bot = getSessionForStrategy<
          BotInstance & {
            runs?: StrategyRun[];
            config?: BotInstance["config"];
          }
        >(response.data, strategyId);
        if (bot) {
          return {
            id: bot.id,
            status: bot.status,
            total_trades: bot.total_trades,
            total_pnl: bot.total_pnl,
            // F2: keep the incompleteness counter — dropping it here would
            // hide that total_pnl sums known fills only (incomplete).
            total_pnl_incomplete_fills: bot.total_pnl_incomplete_fills,
            last_updated: bot.last_updated,
            config: bot.config || {
              type: StrategyType.GRID,
              config: {
                symbol: "",
                leverage: 1,
                gridSize: 10,
                gridRange: 5,
                orderQuantity: 1,
              },
            },
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
        return response.data.map(
          (bot: {
            id: string;
            strategy_id?: string;
            status: string;
            total_trades: number;
            total_pnl: number;
            total_pnl_incomplete_fills?: number;
            last_updated: string;
            force_stop_reason?: string | null;
            config?: unknown;
          }) => ({
            // L19: the session id (what /management/stop expects), never a
            // strategy id (022 shim-drop).
            id: bot.id,
            status: bot.status as
              "RUNNING" | "STOPPED" | "ERROR" | "STARTING" | "STOPPING",
            total_trades: bot.total_trades,
            total_pnl: bot.total_pnl,
            // F2: incompleteness counter travels to the render surface.
            total_pnl_incomplete_fills: bot.total_pnl_incomplete_fills,
            last_updated: bot.last_updated,
            // P0.1: carry the stop's verified outcome (the `cleanup_incomplete`
            // residual) — both mappers feed the shared ["bot-instances"]
            // cache, and a dropped field would make the banner flicker
            // depending on which mapper wrote last.
            forceStopReason: bot.force_stop_reason ?? null,
            config: bot.config || {
              type: StrategyType.GRID,
              config: {
                symbol: "",
                leverage: 1,
                gridSize: 10,
                gridRange: 5,
                orderQuantity: 1,
              },
            },
          })
        );
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
  validateStrategyConfig(
    type: StrategyType,
    config: Record<string, unknown>
  ): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    switch (type) {
      case StrategyType.GRID: {
        if (!config.symbol || typeof config.symbol !== "string") {
          errors.push("Symbol is required");
        }
        if (
          typeof config.gridSize !== "number" ||
          !Number.isInteger(config.gridSize) ||
          config.gridSize < 2 ||
          config.gridSize > 100
        ) {
          errors.push("Grid size must be an integer between 2 and 100");
        }
        if (
          typeof config.gridRange !== "number" ||
          !Number.isFinite(config.gridRange) ||
          config.gridRange < 1 ||
          config.gridRange > 50
        ) {
          errors.push("Grid range must be a number between 1 and 50");
        }
        if (
          typeof config.orderQuantity !== "number" ||
          !Number.isFinite(config.orderQuantity) ||
          config.orderQuantity <= 0
        ) {
          errors.push("Order quantity must be a finite positive number");
        }
        if (
          config.takeProfit !== undefined &&
          (typeof config.takeProfit !== "number" ||
            !Number.isFinite(config.takeProfit) ||
            config.takeProfit <= 0)
        ) {
          errors.push("Take profit must be a finite positive number");
        }
        break;
      }

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
