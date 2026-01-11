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

    console.log(
      `[GridStrategy] Initialized ${this.config.symbol} with ${
        this.levels.length
      } levels, range: ${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)}`
    );
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log(`[GridStrategy] Bot ${this.botId} started`);
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
    console.log(`[GridStrategy] Bot ${this.botId} stopped`);
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
      console.error(`[GridStrategy] Tick error:`, error);
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
      console.log(
        `[GridStrategy] Placed buy order at ${level.price}, orderId: ${result.orderId}`
      );
    } catch (error) {
      console.error(
        `[GridStrategy] Failed to place buy order at ${level.price}:`,
        error
      );
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
      console.log(
        `[GridStrategy] Placed sell order at ${level.price}, orderId: ${result.orderId}`
      );
    } catch (error) {
      console.error(
        `[GridStrategy] Failed to place sell order at ${level.price}:`,
        error
      );
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

              console.log(
                `[GridStrategy] Buy order filled at ${
                  level.price
                }, PnL: ${tradePnl.toFixed(2)}`
              );
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

              console.log(
                `[GridStrategy] Sell order filled at ${
                  level.price
                }, PnL: ${tradePnl.toFixed(2)}`
              );
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
