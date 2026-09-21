/** @format */

// TODO

import { OrderlyClient } from "../exchanges/kodiak/client";
import {
  GridStrategyConfig,
  GridLevel,
  BotStatus,
  OrderRequest,
  Trade,
} from "../types/strategy";
import { logger } from "../utils/logger";
import { ClientOrderIdGenerator } from "../utils/client-order-id";
import {
  GridSnapshot,
  GridSnapshotLevel,
  GRID_SNAPSHOT_VERSION,
} from "../domain/grid-snapshot";
import {
  loadGridSnapshot,
  saveGridSnapshot,
} from "../infrastructure/state/grid-state";

export class GridTradingStrategy {
  private config: GridStrategyConfig;
  private orderly: OrderlyClient;
  private levels: GridLevel[] = [];
  private botId: string;
  private running: boolean = false;
  private currentPrice: number = 0;
  private baselinePrice: number = 0;
  private totalPnl: number = 0;
  private totalTrades: number = 0;
  private trades: Trade[] = [];
  private lastOrderCheck: Map<string, Date> = new Map();
  private clientOrderIdGenerator: ClientOrderIdGenerator;

  constructor(
    botId: string,
    config: GridStrategyConfig,
    orderly: OrderlyClient
  ) {
    this.botId = botId;
    this.config = config;
    this.orderly = orderly;
    this.clientOrderIdGenerator = new ClientOrderIdGenerator(botId);
  }

  async initialize(currentPrice: number): Promise<void> {
    this.currentPrice = currentPrice;

    const snapshot = loadGridSnapshot(this.botId);
    const canRestore =
      snapshot !== null &&
      snapshot.version === GRID_SNAPSHOT_VERSION &&
      snapshot.symbol === this.config.symbol &&
      snapshot.gridSize === this.config.gridSize &&
      snapshot.gridRangePercent === this.config.gridRangePercent;

    if (canRestore) {
      // Restore at the saved baseline so level prices (and the live order IDs
      // sitting at them on the exchange) stay stable across a restart.
      this.baselinePrice = snapshot.baselinePrice;
      const restored = this.mergeRestoredLevels(
        this.buildLevels(snapshot.baselinePrice),
        snapshot.levels
      );
      if (restored.length > 0) {
        this.levels = restored;
        const restoredCount = this.levels.filter(
          l => l.buyOrderId || l.sellOrderId || l.filled
        ).length;
        logger.info("Grid strategy initialized (restored from snapshot)", {
          symbol: this.config.symbol,
          levels: this.levels.length,
          restoredCount,
          baselinePrice: this.baselinePrice,
          botId: this.botId,
        });
      } else {
        this.levels = this.buildLevels(currentPrice);
        this.baselinePrice = currentPrice;
        logger.info("Grid strategy initialized", {
          symbol: this.config.symbol,
          levels: this.levels.length,
          baselinePrice: this.baselinePrice,
          botId: this.botId,
        });
      }
    } else {
      this.levels = this.buildLevels(currentPrice);
      this.baselinePrice = currentPrice;
      logger.info("Grid strategy initialized", {
        symbol: this.config.symbol,
        levels: this.levels.length,
        baselinePrice: this.baselinePrice,
        botId: this.botId,
      });
    }

    await this.persistSnapshot();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("Grid strategy bot started", {
      botId: this.botId,
      symbol: this.config.symbol,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    // Cancel all pending orders
    for (const level of this.levels) {
      if (level.buyOrderId) {
        try {
          await this.orderly.cancelOrder(level.buyOrderId, this.config.symbol);
        } catch {
          /* Order may already be filled or cancelled */
        }
      }
      if (level.sellOrderId) {
        try {
          await this.orderly.cancelOrder(level.sellOrderId, this.config.symbol);
        } catch {
          /* Order may already be filled or cancelled */
        }
      }
    }
    logger.info("Grid strategy bot stopped", {
      botId: this.botId,
      symbol: this.config.symbol,
    });

    await this.persistSnapshot();
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

      // Persist slot state unconditionally so a restart picks up fills/orders.
      await this.persistSnapshot();
    } catch (error) {
      logger.error("Grid strategy tick error", {
        error: error instanceof Error ? error.message : String(error),
        botId: this.botId,
        symbol: this.config.symbol,
      });
    }
  }

  /**
   * Generate a deterministic client order id for idempotency.
   *
   * Delegates to `ClientOrderIdGenerator`, which packs the bot id, the level
   * index and the side into the exchange's `client_order_id` contract (max 36
   * chars, hyphen allowed but not first — see `utils/client-order-id.ts`).
   * The same bot/level/side always yields the same id, so a redelivered
   * command or a restart regenerates the key the exchange can match/reject.
   */
  private generateClientOrderId(
    levelIndex: number,
    side: "BUY" | "SELL"
  ): string {
    return this.clientOrderIdGenerator.generate(levelIndex, side);
  }

  /**
   * Build a fresh set of empty grid levels around a center price.
   */
  private buildLevels(centerPrice: number): GridLevel[] {
    const priceRange = centerPrice * (this.config.gridRangePercent / 100);
    const minPrice = centerPrice - priceRange / 2;
    const maxPrice = centerPrice + priceRange / 2;
    const gridSpacing = (maxPrice - minPrice) / this.config.gridSize;

    const levels: GridLevel[] = [];
    for (let i = 0; i <= this.config.gridSize; i++) {
      const price = minPrice + i * gridSpacing;
      levels.push({
        price: Number(price.toFixed(2)),
        filled: false,
      });
    }
    return levels;
  }

  /**
   * Merge saved slot state onto freshly-built levels by exact price match.
   * Saved buyOrderId/sellOrderId/filled are carried over only when the level
   * price still exists in the rebuilt grid (guards against config changes).
   */
  private mergeRestoredLevels(
    base: GridLevel[],
    saved: GridSnapshotLevel[]
  ): GridLevel[] {
    const byPrice = new Map<number, GridSnapshotLevel>();
    for (const entry of saved) {
      byPrice.set(entry.price, entry);
    }

    return base.map(level => {
      const savedLevel = byPrice.get(level.price);
      if (savedLevel) {
        return {
          price: level.price,
          buyOrderId: savedLevel.buyOrderId,
          sellOrderId: savedLevel.sellOrderId,
          filled: savedLevel.filled,
        };
      }
      return { ...level };
    });
  }

  private buildSnapshot(): GridSnapshot {
    return {
      version: GRID_SNAPSHOT_VERSION,
      botId: this.botId,
      symbol: this.config.symbol,
      gridSize: this.config.gridSize,
      gridRangePercent: this.config.gridRangePercent,
      baselinePrice: this.baselinePrice,
      levels: this.levels.map((l): GridSnapshotLevel => ({
        price: l.price,
        buyOrderId: l.buyOrderId,
        sellOrderId: l.sellOrderId,
        filled: l.filled,
      })),
      savedAt: new Date().toISOString(),
    };
  }

  private async persistSnapshot(): Promise<void> {
    await saveGridSnapshot(this.buildSnapshot());
  }

  private async placeBuyOrder(level: GridLevel, index: number): Promise<void> {
    // Use deterministic clientOrderId for idempotency - same bot/level/side
    // always produces the same ID, so the exchange can reject a duplicate.
    const clientOrderId = this.generateClientOrderId(index, "BUY");
    try {
      // Get-before-create: adopt an already-live order (lost response) with the
      // same clientOrderId instead of submitting a second buy order.
      const existing = await this.orderly.findOrderByClientOrderId(
        this.config.symbol,
        clientOrderId
      );
      if (existing && existing.orderId) {
        level.buyOrderId = existing.orderId;
        logger.info("Adopted existing buy order (idempotent reconcile)", {
          price: level.price,
          orderId: existing.orderId,
          botId: this.botId,
          symbol: this.config.symbol,
        });
        return;
      }

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
      logger.info("Placed buy order", {
        price: level.price,
        orderId: result.orderId,
        botId: this.botId,
        symbol: this.config.symbol,
      });
    } catch (error) {
      // The exchange may have accepted the order while the response was lost.
      // Reconcile before giving up so we never double-place the same slot.
      try {
        const recovered = await this.orderly.findOrderByClientOrderId(
          this.config.symbol,
          clientOrderId
        );
        if (recovered && recovered.orderId) {
          level.buyOrderId = recovered.orderId;
          logger.warn("Reconciled buy order after submission error", {
            price: level.price,
            orderId: recovered.orderId,
            botId: this.botId,
            symbol: this.config.symbol,
          });
          return;
        }
      } catch {
        /* reconcile lookup itself failed - fall through to error logging */
      }
      logger.error("Failed to place buy order", {
        price: level.price,
        error: error instanceof Error ? error.message : String(error),
        botId: this.botId,
        symbol: this.config.symbol,
      });
    }
  }

  private async placeSellOrder(level: GridLevel, index: number): Promise<void> {
    // Use deterministic clientOrderId for idempotency - same bot/level/side
    // always produces the same ID, so the exchange can reject a duplicate.
    const clientOrderId = this.generateClientOrderId(index, "SELL");
    try {
      // Get-before-create: adopt an already-live order (lost response) with the
      // same clientOrderId instead of submitting a second sell order.
      const existing = await this.orderly.findOrderByClientOrderId(
        this.config.symbol,
        clientOrderId
      );
      if (existing && existing.orderId) {
        level.sellOrderId = existing.orderId;
        logger.info("Adopted existing sell order (idempotent reconcile)", {
          price: level.price,
          orderId: existing.orderId,
          botId: this.botId,
          symbol: this.config.symbol,
        });
        return;
      }

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
      logger.info("Placed sell order", {
        price: level.price,
        orderId: result.orderId,
        botId: this.botId,
        symbol: this.config.symbol,
      });
    } catch (error) {
      // The exchange may have accepted the order while the response was lost.
      // Reconcile before giving up so we never double-place the same slot.
      try {
        const recovered = await this.orderly.findOrderByClientOrderId(
          this.config.symbol,
          clientOrderId
        );
        if (recovered && recovered.orderId) {
          level.sellOrderId = recovered.orderId;
          logger.warn("Reconciled sell order after submission error", {
            price: level.price,
            orderId: recovered.orderId,
            botId: this.botId,
            symbol: this.config.symbol,
          });
          return;
        }
      } catch {
        /* reconcile lookup itself failed - fall through to error logging */
      }
      logger.error("Failed to place sell order", {
        price: level.price,
        error: error instanceof Error ? error.message : String(error),
        botId: this.botId,
        symbol: this.config.symbol,
      });
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

              logger.info("Buy order filled", {
                price: level.price,
                pnl: tradePnl.toFixed(2),
                botId: this.botId,
                symbol: this.config.symbol,
                orderId: order.orderId,
              });
            } else if (
              order.status === "CANCELLED" ||
              order.status === "REJECTED"
            ) {
              level.buyOrderId = undefined;
            }
            if (level.buyOrderId) {
              this.lastOrderCheck.set(level.buyOrderId, new Date());
            }
          } catch {
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

              logger.info("Sell order filled", {
                price: level.price,
                pnl: tradePnl.toFixed(2),
                botId: this.botId,
                symbol: this.config.symbol,
                orderId: order.orderId,
              });
            } else if (
              order.status === "CANCELLED" ||
              order.status === "REJECTED"
            ) {
              level.sellOrderId = undefined;
            }
            if (level.sellOrderId) {
              this.lastOrderCheck.set(level.sellOrderId, new Date());
            }
          } catch {
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
