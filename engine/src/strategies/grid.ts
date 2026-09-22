/** @format */

// TODO

import {
  ExchangeClient,
  ExchangeOrderRequest,
  OrderLookup,
} from "../domain/exchange";
import {
  GridStrategyConfig,
  GridLevel,
  BotStatus,
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

/**
 * How often a single slot's order is re-checked against the exchange (ms).
 * Bounds the reconciliation load on the venue while keeping fill detection
 * responsive enough for one grid tick interval.
 */
const ORDER_CHECK_INTERVAL_MS = 5000;

/**
 * Grid strategy over the exchange-agnostic `ExchangeClient` contract.
 *
 * The strategy used to take the concrete `OrderlyClient`. Workstream B4
 * decouples it: every exchange interaction goes through the interface
 * (`getTicker` / `createOrder` / `cancelOrder` / `queryOrderByClientOrderId` /
 * `listOpenOrders`), which is what makes a second venue possible at all.
 */
export class GridTradingStrategy {
  private config: GridStrategyConfig;
  private exchange: ExchangeClient;
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
    exchange: ExchangeClient
  ) {
    this.botId = botId;
    this.config = config;
    this.exchange = exchange;
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
          await this.exchange.cancelOrder(level.buyOrderId, this.config.symbol);
        } catch {
          /* Order may already be filled or cancelled */
        }
      }
      if (level.sellOrderId) {
        try {
          await this.exchange.cancelOrder(
            level.sellOrderId,
            this.config.symbol
          );
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
      const ticker = await this.exchange.getTicker(this.config.symbol);
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
    return this.placeSlotOrder(level, index, "BUY");
  }

  private async placeSellOrder(level: GridLevel, index: number): Promise<void> {
    return this.placeSlotOrder(level, index, "SELL");
  }

  /**
   * Idempotent slot placement, shared by both sides.
   *
   * Every branch is driven by the contract's `OrderLookup`, so the failure
   * semantics live in exactly one place instead of being re-implemented per
   * side:
   * - `FOUND_OPEN` — adopt the live order; a lost create response is never a
   *   reason to place a second one.
   * - `FOUND_FILLED` — the order already executed; record the fill.
   * - `FOUND_CANCELED` / `NOT_FOUND` — definitively not live; place.
   * - `UNREACHABLE` — the exchange could not be asked: leave the slot
   *   untouched rather than risk a duplicate order.
   */
  private async placeSlotOrder(
    level: GridLevel,
    index: number,
    side: "BUY" | "SELL"
  ): Promise<void> {
    // Deterministic clientOrderId: the same bot/level/side always derives the
    // same key, so a redelivered command or a restart reconciles against the
    // exchange instead of risking a duplicate submission.
    const clientOrderId = this.generateClientOrderId(index, side);

    // Get-before-create: adopt an already-live order (lost response) rather
    // than submitting a second one for the same slot.
    let lookup: OrderLookup;
    try {
      lookup = await this.exchange.queryOrderByClientOrderId(
        this.config.symbol,
        clientOrderId
      );
    } catch (error) {
      logger.warn("Order slot frozen (lookup failed)", {
        side,
        price: level.price,
        clientOrderId,
        error: error instanceof Error ? error.message : String(error),
        botId: this.botId,
        symbol: this.config.symbol,
      });
      return;
    }

    if (lookup.kind === "UNREACHABLE") {
      logger.warn("Order slot frozen (exchange unreachable)", {
        side,
        price: level.price,
        clientOrderId,
        reason: lookup.reason,
        botId: this.botId,
        symbol: this.config.symbol,
      });
      return;
    }
    if (lookup.kind === "FOUND_OPEN") {
      this.adoptSlotOrder(level, side, lookup.order.orderId);
      return;
    }
    if (lookup.kind === "FOUND_FILLED") {
      this.recordFill(level, side, lookup.order.orderId, lookup.order.quantity);
      return;
    }
    if (lookup.kind === "FOUND_CANCELED") {
      logger.info("Re-placing canceled order", {
        side,
        price: level.price,
        orderId: lookup.order.orderId,
        botId: this.botId,
        symbol: this.config.symbol,
      });
    }

    const request: ExchangeOrderRequest = {
      symbol: this.config.symbol,
      orderType: "LIMIT",
      side,
      orderPrice: level.price,
      orderQuantity: this.config.orderQuantity,
      clientOrderId,
    };

    try {
      const result = await this.exchange.createOrder(request);
      this.setSlotOrderId(level, side, result.orderId);
      logger.info("Placed order", {
        side,
        price: level.price,
        orderId: result.orderId,
        botId: this.botId,
        symbol: this.config.symbol,
      });
    } catch (error) {
      // The exchange may have accepted the order while the response was lost.
      // Reconcile before giving up so we never double-place the same slot.
      const recovered = await this.exchange
        .queryOrderByClientOrderId(this.config.symbol, clientOrderId)
        .catch(() => null);
      if (recovered && recovered.kind === "FOUND_OPEN") {
        this.adoptSlotOrder(level, side, recovered.order.orderId, true);
        return;
      }
      if (recovered && recovered.kind === "FOUND_FILLED") {
        this.recordFill(
          level,
          side,
          recovered.order.orderId,
          recovered.order.quantity
        );
        return;
      }
      logger.error("Failed to place order", {
        side,
        price: level.price,
        error: error instanceof Error ? error.message : String(error),
        botId: this.botId,
        symbol: this.config.symbol,
      });
    }
  }

  /**
   * Client-order-id lookup that never throws.
   *
   * The contract already reports "could not ask" as `UNREACHABLE`; a thrown
   * error (adapter bug, malformed row) is folded into the same bucket rather
   * than escaping into the tick, because the only safe reaction to an unknown
   * outcome is to leave the slot alone.
   */
  private async lookupSlot(
    index: number,
    side: "BUY" | "SELL"
  ): Promise<OrderLookup> {
    try {
      return await this.exchange.queryOrderByClientOrderId(
        this.config.symbol,
        this.generateClientOrderId(index, side)
      );
    } catch (error) {
      return {
        kind: "UNREACHABLE",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private slotOrderId(
    level: GridLevel,
    side: "BUY" | "SELL"
  ): string | undefined {
    return side === "BUY" ? level.buyOrderId : level.sellOrderId;
  }

  private setSlotOrderId(
    level: GridLevel,
    side: "BUY" | "SELL",
    orderId?: string
  ): void {
    if (side === "BUY") {
      level.buyOrderId = orderId;
    } else {
      level.sellOrderId = orderId;
    }
  }

  /**
   * Adopt an order the exchange already holds for this slot. A lost create
   * response must never turn into a second live order on the same level.
   */
  private adoptSlotOrder(
    level: GridLevel,
    side: "BUY" | "SELL",
    orderId: string,
    recovered = false
  ): void {
    this.setSlotOrderId(level, side, orderId);
    const meta = {
      price: level.price,
      orderId,
      botId: this.botId,
      symbol: this.config.symbol,
    };
    if (recovered) {
      logger.warn("Reconciled slot order after submission error", meta);
    } else {
      logger.info("Adopted existing slot order (idempotent reconcile)", meta);
    }
  }

  /**
   * Record a fill and flip the slot to the side that closes it: a filled BUY
   * arms the level's sell, a filled SELL re-arms its buy.
   *
   * PnL stays the simplified mark-to-market estimate it has always been —
   * executed-price accounting with fees is workstream row 5, not something to
   * change silently while decoupling the venue.
   */
  private recordFill(
    level: GridLevel,
    side: "BUY" | "SELL",
    orderId: string,
    executedQuantity?: number
  ): void {
    const quantity = executedQuantity || this.config.orderQuantity;
    let tradePnl: number;
    if (side === "BUY") {
      level.filled = true;
      tradePnl = (this.currentPrice - level.price) * this.config.orderQuantity;
    } else {
      level.filled = false;
      tradePnl = (level.price - this.currentPrice) * this.config.orderQuantity;
    }

    this.setSlotOrderId(level, side, undefined);
    this.lastOrderCheck.delete(orderId);
    this.totalTrades++;
    this.totalPnl += tradePnl;

    this.trades.push({
      orderId,
      symbol: this.config.symbol,
      side,
      quantity,
      price: level.price,
      executedAt: new Date(),
      pnl: tradePnl,
    });

    logger.info(side === "BUY" ? "Buy order filled" : "Sell order filled", {
      price: level.price,
      pnl: tradePnl.toFixed(2),
      botId: this.botId,
      symbol: this.config.symbol,
      orderId,
    });
  }

  private async checkOrders(): Promise<void> {
    for (const level of this.levels) {
      for (const side of ["BUY", "SELL"] as const) {
        const orderId = this.slotOrderId(level, side);
        if (!orderId) continue;

        const lastCheck = this.lastOrderCheck.get(orderId);
        if (
          lastCheck &&
          Date.now() - lastCheck.getTime() <= ORDER_CHECK_INTERVAL_MS
        ) {
          continue;
        }
        try {
          const order = await this.exchange.getOrder(orderId);
          if (order.status === "FILLED" || order.status === "FULLY_FILLED") {
            this.recordFill(level, side, order.orderId, order.executedQuantity);
          } else if (
            order.status === "CANCELLED" ||
            order.status === "REJECTED"
          ) {
            this.setSlotOrderId(level, side, undefined);
          }
          const currentId = this.slotOrderId(level, side);
          if (currentId) {
            this.lastOrderCheck.set(currentId, new Date());
          }
        } catch {
          // Order may not exist anymore
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
