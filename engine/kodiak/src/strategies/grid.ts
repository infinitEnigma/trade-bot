/** @format */

import { v4 as uuidv4 } from "uuid";
import { OrderlyClient } from "../services/orderly";
import {
  GridStrategyConfig,
  GridLevel,
  BotStatus,
  OrderRequest,
  Trade,
} from "../types/strategy";
import { logger } from "../utils/logger";

export class GridTradingStrategy {
  private config: GridStrategyConfig;
  private orderly: OrderlyClient;
  private levels: GridLevel[] = [];
  private botId: string;
  private running: boolean = false;
  private currentPrice: number = 0;
  private totalPnl: number = 0;
  private totalTrades: number = 0;
  private trades: Trade[] = [];
  private lastOrderCheck: Map<string, Date> = new Map();

  constructor(config: GridStrategyConfig, orderly: OrderlyClient) {
    this.config = config;
    this.orderly = orderly;
    this.botId = uuidv4();
  }

  async initialize(currentPrice: number): Promise<void> {
    this.currentPrice = currentPrice;
    const priceRange = currentPrice * (this.config.gridRangePercent / 100);
    const minPrice = currentPrice - priceRange / 2;
    const maxPrice = currentPrice + priceRange / 2;
    const gridSpacing = (maxPrice - minPrice) / this.config.gridSize;

    // Create grid levels
    this.levels = [];
    for (let i = 0; i <= this.config.gridSize; i++) {
      const price = minPrice + i * gridSpacing;
      this.levels.push({
        price: Number(price.toFixed(2)),
        filled: false,
      });
    }

    logger.info('Grid strategy initialized', {
      symbol: this.config.symbol,
      levels: this.levels.length,
      minPrice: minPrice.toFixed(2),
      maxPrice: maxPrice.toFixed(2),
      botId: this.botId
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info('Grid strategy bot started', { botId: this.botId, symbol: this.config.symbol });
  }

  async stop(): Promise<void> {
    this.running = false;
    // Cancel all pending orders
    for (const level of this.levels) {
      if (level.buyOrderId) {
        try {
          await this.orderly.cancelOrder(level.buyOrderId, this.config.symbol);
        } catch (e) {
          // Order may already be filled or cancelled
        }
      }
      if (level.sellOrderId) {
        try {
          await this.orderly.cancelOrder(level.sellOrderId, this.config.symbol);
        } catch (e) {
          // Order may already be filled or cancelled
        }
      }
    }
    logger.info('Grid strategy bot stopped', { botId: this.botId, symbol: this.config.symbol });
  }

  async tick(): Promise<void> {
    if (!this.running) return;

    try {
      // Get current price
      const ticker = await this.orderly.getTicker(this.config.symbol);
      this.currentPrice = Number(ticker.mark_price || ticker.price);

      // Check each grid level
      for (let i = 0; i < this.levels.length; i++) {
        const level = this.levels[i];

        // Buy order: place if price is at or below level and no order exists
        if (
          this.currentPrice <= level.price &&
          !level.buyOrderId &&
          !level.filled
        ) {
          await this.placeBuyOrder(level, i);
        }

        // Sell order: place if price is at or above level and we have a position
        if (
          this.currentPrice >= level.price &&
          !level.sellOrderId &&
          level.filled
        ) {
          await this.placeSellOrder(level, i);
        }
      }

      // Check order status
      await this.checkOrders();
    } catch (error) {
      logger.error('Grid strategy tick error', { error: error instanceof Error ? error.message : String(error), botId: this.botId, symbol: this.config.symbol });
    }
  }

  private async placeBuyOrder(level: GridLevel, index: number): Promise<void> {
    try {
      const clientOrderId = `grid_${this.botId}_buy_${index}_${Date.now()}`;
      const order: OrderRequest = {
        symbol: this.config.symbol,
        orderType: "LIMIT",
        side: "BUY",
        orderPrice: level.price,
        orderQuantity: this.config.orderQuantity,
        clientOrderId,
      };

      const result = await this.orderly.createOrder(order);
      level.buyOrderId = result.orderId;
      logger.info('Placed buy order', { price: level.price, orderId: result.orderId, botId: this.botId, symbol: this.config.symbol });
    } catch (error) {
      logger.error('Failed to place buy order', { price: level.price, error: error instanceof Error ? error.message : String(error), botId: this.botId, symbol: this.config.symbol });
    }
  }

  private async placeSellOrder(level: GridLevel, index: number): Promise<void> {
    try {
      const clientOrderId = `grid_${this.botId}_sell_${index}_${Date.now()}`;
      const order: OrderRequest = {
        symbol: this.config.symbol,
        orderType: "LIMIT",
        side: "SELL",
        orderPrice: level.price,
        orderQuantity: this.config.orderQuantity,
        clientOrderId,
      };

      const result = await this.orderly.createOrder(order);
      level.sellOrderId = result.orderId;
      logger.info('Placed sell order', { price: level.price, orderId: result.orderId, botId: this.botId, symbol: this.config.symbol });
    } catch (error) {
      logger.error('Failed to place sell order', { price: level.price, error: error instanceof Error ? error.message : String(error), botId: this.botId, symbol: this.config.symbol });
    }
  }

  private async checkOrders(): Promise<void> {
    for (const level of this.levels) {
      // Check buy orders
      if (level.buyOrderId) {
        const lastCheck = this.lastOrderCheck.get(level.buyOrderId);
        if (!lastCheck || Date.now() - lastCheck.getTime() > 5000) {
          try {
            const order = await this.orderly.getOrder(level.buyOrderId);
            if (order.status === "FILLED" || order.status === "FULLY_FILLED") {
              level.filled = true;
              level.buyOrderId = undefined;
              this.totalTrades++;

              // Calculate PnL (simplified)
              const tradePnl =
                (this.currentPrice - level.price) * this.config.orderQuantity;
              this.totalPnl += tradePnl;

              this.trades.push({
                orderId: order.orderId,
                symbol: this.config.symbol,
                side: "BUY",
                quantity: order.executedQuantity || this.config.orderQuantity,
                price: level.price,
                executedAt: new Date(),
                pnl: tradePnl,
              });

              logger.info('Buy order filled', { price: level.price, pnl: tradePnl.toFixed(2), botId: this.botId, symbol: this.config.symbol, orderId: order.orderId });
            } else if (
              order.status === "CANCELLED" ||
              order.status === "REJECTED"
            ) {
              level.buyOrderId = undefined;
            }
            if (level.buyOrderId) {
              this.lastOrderCheck.set(level.buyOrderId, new Date());
            }
          } catch (error) {
            // Order may not exist anymore
          }
        }
      }

      // Check sell orders
      if (level.sellOrderId) {
        const lastCheck = this.lastOrderCheck.get(level.sellOrderId);
        if (!lastCheck || Date.now() - lastCheck.getTime() > 5000) {
          try {
            const order = await this.orderly.getOrder(level.sellOrderId);
            if (order.status === "FILLED" || order.status === "FULLY_FILLED") {
              level.filled = false;
              level.sellOrderId = undefined;
              this.totalTrades++;

              // Calculate PnL
              const tradePnl =
                (level.price - this.currentPrice) * this.config.orderQuantity;
              this.totalPnl += tradePnl;

              this.trades.push({
                orderId: order.orderId,
                symbol: this.config.symbol,
                side: "SELL",
                quantity: order.executedQuantity || this.config.orderQuantity,
                price: level.price,
                executedAt: new Date(),
                pnl: tradePnl,
              });

              logger.info('Sell order filled', { price: level.price, pnl: tradePnl.toFixed(2), botId: this.botId, symbol: this.config.symbol, orderId: order.orderId });
            } else if (
              order.status === "CANCELLED" ||
              order.status === "REJECTED"
            ) {
              level.sellOrderId = undefined;
            }
            if (level.sellOrderId) {
              this.lastOrderCheck.set(level.sellOrderId, new Date());
            }
          } catch (error) {
            // Order may not exist anymore
          }
        }
      }
    }
  }

  getStatus(): BotStatus {
    return {
      botId: this.botId,
      strategyId: this.config.symbol,
      status: this.running ? "RUNNING" : "STOPPED",
      currentPrice: this.currentPrice,
      totalTrades: this.totalTrades,
      totalPnl: this.totalPnl,
      updatedAt: new Date(),
    };
  }

  getConfig(): GridStrategyConfig {
    return { ...this.config };
  }

  getTrades(): Trade[] {
    return [...this.trades];
  }

  isRunning(): boolean {
    return this.running;
  }
}
