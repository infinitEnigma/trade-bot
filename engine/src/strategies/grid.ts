/** @format */

import { ExchangeClient, ExchangeOpenOrder } from "../domain/exchange";
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
import { SlotOutcome } from "../domain/order-state";
import {
  loadGridSnapshotResult,
  SnapshotLoadResult,
  saveGridSnapshot,
} from "../infrastructure/state/grid-state";
import { CommandError } from "../application/command-error";
import { OrderManager } from "../application/order-manager";
import { OrderReconciliationService } from "../application/order-reconciliation.service";
import { PositionReport, TradeReporter } from "../application/trade-reporter";

/**
 * How often a single slot's order is re-checked against the exchange (ms).
 * Bounds the reconciliation load on the venue while keeping fill detection
 * responsive enough for one grid tick interval.
 */
const ORDER_CHECK_INTERVAL_MS = 5000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Grid strategy over the exchange-agnostic `ExchangeClient` contract.
 *
 * Exchange↔local failure semantics live in `OrderReconciliationService`; this
 * class owns the grid geometry, the tick loop and the (simplified, mark-to-
 * market) trade counters. Slot identity is written only through `OrderManager`.
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
  private manager: OrderManager | null = null;
  private reconcile: OrderReconciliationService | null = null;
  /**
   * Ledger event emission (Phase 4). Optional so strategy unit tests can run
   * without a stream; production always wires it (`BotManager.startBot`), and
   * while it is absent no ORDER_INTENT gating applies.
   */
  private reporter: TradeReporter | null;

  constructor(
    botId: string,
    config: GridStrategyConfig,
    exchange: ExchangeClient,
    reporter?: TradeReporter
  ) {
    this.botId = botId;
    this.config = config;
    this.exchange = exchange;
    this.reporter = reporter ?? null;
    this.clientOrderIdGenerator = new ClientOrderIdGenerator(botId);
  }

  async initialize(currentPrice: number): Promise<void> {
    this.currentPrice = currentPrice;

    const snapResult = loadGridSnapshotResult(this.botId);
    const snapshot = snapResult.status === "OK" ? snapResult.snapshot : null;
    const canRestore =
      snapshot !== null &&
      snapshot.version === GRID_SNAPSHOT_VERSION &&
      snapshot.symbol === this.config.symbol &&
      snapshot.gridSize === this.config.gridSize &&
      snapshot.gridRangePercent === this.config.gridRangePercent;

    if (canRestore && snapshot) {
      // Restore at the saved baseline so level prices (and the live order IDs
      // sitting at them on the exchange) stay stable across a restart.
      this.baselinePrice = snapshot.baselinePrice;
      this.levels = this.mergeRestoredLevels(
        this.buildLevels(snapshot.baselinePrice),
        snapshot.levels
      );
      logger.info("Grid strategy initialized (restored from snapshot)", {
        symbol: this.config.symbol,
        levels: this.levels.length,
        restoredCount: this.levels.filter(
          l => l.buyOrderId || l.sellOrderId || l.filled
        ).length,
        baselinePrice: this.baselinePrice,
        botId: this.botId,
      });
    } else {
      // No trustworthy snapshot: before rebuilding (which would re-place levels
      // whose orders may still be live) refuse when the venue holds orders we
      // cannot map, or when we cannot ask (D1 — fail closed).
      await this.requireEmptyBook(snapResult);
      this.levels = this.buildLevels(currentPrice);
      this.baselinePrice = currentPrice;
      logger.info("Grid strategy initialized", {
        symbol: this.config.symbol,
        levels: this.levels.length,
        baselinePrice: this.baselinePrice,
        botId: this.botId,
      });
    }

    // Wire order bookkeeping onto the (restored or fresh) levels.
    this.manager = new OrderManager(this.levels, this.clientOrderIdGenerator);
    this.reconcile = new OrderReconciliationService(
      this.botId,
      this.exchange,
      this.config.symbol,
      this.manager,
      this.reporter ?? undefined
    );

    if (canRestore) {
      const report = await this.reconcile.reconcileSymbol();
      if (!report.reachable) {
        throw new CommandError(
          false,
          `Grid startup reconciliation could not reach the exchange: ${report.reason}`
        );
      }
      if (report.orphans.length > 0) {
        logger.warn(
          "Startup reconcile: live orders not owned by the grid (reported, not cancelled)",
          {
            botId: this.botId,
            symbol: this.config.symbol,
            adopted: report.adopted,
            filled: report.filled,
            orphans: report.orphans.map(o => ({
              orderId: o.orderId,
              clientOrderId: o.clientOrderId,
              status: o.status,
            })),
          }
        );
      }
    }

    await this.persistSnapshot();
  }

  /**
   * Fail closed when there is no snapshot to trust. If the venue already holds
   * orders for the symbol (or cannot be asked), rebuilding the grid could place
   * a second order at a level that is already live — so refuse to start instead.
   */
  private async requireEmptyBook(
    snapResult: SnapshotLoadResult
  ): Promise<void> {
    let open: ExchangeOpenOrder[];
    try {
      open = await this.exchange.listOpenOrders(this.config.symbol);
    } catch (error) {
      throw new CommandError(
        false,
        `Refusing to start: cannot verify open orders for ${this.config.symbol} (${messageOf(error)})`
      );
    }
    if (open.length > 0) {
      const detail =
        snapResult.status === "CORRUPT"
          ? `corrupt snapshot (${snapResult.detail})`
          : snapResult.status === "MISSING"
            ? "no snapshot"
            : "snapshot does not match this config";
      throw new CommandError(
        false,
        `Refusing to start: ${detail} while ${open.length} live order(s) exist for ${this.config.symbol}`
      );
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("Grid strategy bot started", {
      botId: this.botId,
      symbol: this.config.symbol,
    });
  }

  /**
   * Stop the strategy and cancel its live orders. Returns one human-readable
   * problem per order whose cancellation could not be confirmed (N5): the
   * caller decides how to report it — a clean STOPPED must never hide live
   * orders.
   */
  async stop(): Promise<string[]> {
    this.running = false;
    const problems = await this.cancelAllOrders();
    logger.info("Grid strategy bot stopped", {
      botId: this.botId,
      symbol: this.config.symbol,
      unresolved: problems.length,
    });
    await this.persistSnapshot();
    return problems;
  }

  private async cancelAllOrders(): Promise<string[]> {
    const problems: string[] = [];
    for (let i = 0; i < this.levels.length; i++) {
      for (const side of ["BUY", "SELL"] as const) {
        const handle =
          side === "BUY"
            ? this.levels[i].buyOrderId
            : this.levels[i].sellOrderId;
        if (!handle) continue;
        try {
          // The adapter polls to confirmation; a thrown error means the cancel
          // is NOT confirmed, so the slot is reported rather than assumed clean.
          await this.exchange.cancelOrder(handle, this.config.symbol);
          this.manager?.markNotFound(this.generateClientOrderId(i, side));
        } catch (error) {
          problems.push(
            `${side}@${this.levels[i].price} not cancelled: ${messageOf(error)}`
          );
        }
      }
    }
    return problems;
  }

  async tick(): Promise<void> {
    if (!this.running || !this.reconcile) return;

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
          const outcome = await this.reconcile.ensureSlotOrder(
            i,
            "BUY",
            level.price,
            this.config.orderQuantity
          );
          if (outcome.kind === "FILLED") {
            await this.recordTrade(i, level, "BUY", outcome);
          }
        }

        // Sell order: place if price is at or above level and we have a position
        if (
          this.currentPrice >= level.price &&
          !level.sellOrderId &&
          level.filled
        ) {
          const outcome = await this.reconcile.ensureSlotOrder(
            i,
            "SELL",
            level.price,
            this.config.orderQuantity
          );
          if (outcome.kind === "FILLED") {
            await this.recordTrade(i, level, "SELL", outcome);
          }
        }
      }

      // Reconcile live slots against the exchange (fill / gone / unreachable).
      await this.reconcileOrders();

      // Persist slot state unconditionally so a restart picks up fills/orders.
      await this.persistSnapshot();
    } catch (error) {
      logger.error("Grid strategy tick error", {
        error: messageOf(error),
        botId: this.botId,
        symbol: this.config.symbol,
      });
    }
  }

  /**
   * Verify every live slot against the exchange (throttled per slot). A slot
   * whose order has vanished is cleared so it can be re-armed (N3); an
   * unreachable exchange freezes it (the handle is left untouched).
   */
  private async reconcileOrders(): Promise<void> {
    if (!this.reconcile) return;
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      for (const side of ["BUY", "SELL"] as const) {
        const handle = side === "BUY" ? level.buyOrderId : level.sellOrderId;
        if (!handle) continue;

        const clientOrderId = this.generateClientOrderId(i, side);
        const lastCheck = this.lastOrderCheck.get(clientOrderId);
        if (
          lastCheck &&
          Date.now() - lastCheck.getTime() <= ORDER_CHECK_INTERVAL_MS
        ) {
          continue;
        }

        const outcome = await this.reconcile.checkSlot(i, side);
        if (outcome.kind === "FILLED") {
          await this.recordTrade(i, level, side, outcome);
        }
        this.lastOrderCheck.set(clientOrderId, new Date());
      }
    }
  }

  /**
   * Record a fill and its simplified mark-to-market PnL, then emit the
   * durable ledger events (TRADE_EXECUTED + POSITION_UPDATED +
   * PERFORMANCE_SNAPSHOT). Executed-price accounting with fees is Phase 5,
   * not something to change here. Reporting never throws — a tick must not
   * die on a publish failure (the reporter logs the payload for replay).
   */
  private async recordTrade(
    levelIndex: number,
    level: GridLevel,
    side: "BUY" | "SELL",
    outcome: Extract<SlotOutcome, { kind: "FILLED" }>
  ): Promise<void> {
    const quantity = outcome.filledQty || this.config.orderQuantity;
    const tradePnl =
      side === "BUY"
        ? (this.currentPrice - level.price) * this.config.orderQuantity
        : (level.price - this.currentPrice) * this.config.orderQuantity;

    this.totalTrades += 1;
    this.totalPnl += tradePnl;
    // The id the fill actually happened under — NOT a fresh generation (the
    // slot's gen already bumped inside markFilled; deriving a new id here
    // would book a ledger identity the venue has never seen).
    const clientOrderId = outcome.clientOrderId;
    this.trades.push({
      orderId: clientOrderId,
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
    });

    if (!this.reporter) return;
    const executedAt = new Date().toISOString();
    try {
      await this.reporter.reportFill({
        botId: this.botId,
        symbol: this.config.symbol,
        side,
        price: level.price,
        quantity,
        pnl: tradePnl,
        status: "FILLED",
        clientOrderId,
        exchangeOrderId: outcome.orderId ?? clientOrderId,
        executedAt,
      });
      await this.reporter.reportPosition(this.buildPositionReport());
      await this.reporter.reportPerformance({
        botId: this.botId,
        totalTrades: this.totalTrades,
        totalPnl: this.totalPnl,
      });
    } catch (error) {
      logger.error("Failed to emit ledger events for fill", {
        error: messageOf(error),
        botId: this.botId,
        symbol: this.config.symbol,
        clientOrderId,
      });
    }
  }

  /**
   * The engine's aggregate position over the grid: every level with a filled
   * BUY holds `orderQuantity` long (a filled SELL clears the flag again via
   * `OrderManager.markFilled`). FLAT is reported explicitly so the backend
   * never has to guess what "absent" means.
   */
  private buildPositionReport(): PositionReport {
    const filledLevels = this.levels.filter(l => l.filled);
    const quantity =
      filledLevels.length > 0
        ? Number((filledLevels.length * this.config.orderQuantity).toFixed(8))
        : 0;
    const entryPrice =
      filledLevels.length > 0
        ? filledLevels.reduce((sum, l) => sum + l.price, 0) /
          filledLevels.length
        : 0;
    return {
      botId: this.botId,
      symbol: this.config.symbol,
      side: quantity > 0 ? "LONG" : "FLAT",
      quantity,
      entryPrice: Number(entryPrice.toFixed(8)),
      markPrice: this.currentPrice,
      pnl: this.totalPnl,
    };
  }

  /**
   * Generate the deterministic client order id for a slot's **current**
   * generation (G1): after a fill books, `OrderManager.markFilled` bumps the
   * side's generation, so this derives a fresh id whose venue history cannot
   * contain the spent cycle's terminal row.
   *
   * Delegates to `ClientOrderIdGenerator`, which packs the bot id, the level
   * index, the side and (when ≥ 1) the generation into the exchange's
   * `client_order_id` contract (max 36 chars, hyphen allowed but not first —
   * see `utils/client-order-id.ts`).
   */
  private generateClientOrderId(
    levelIndex: number,
    side: "BUY" | "SELL"
  ): string {
    const level = this.levels[levelIndex];
    const generation = (side === "BUY" ? level?.buyGen : level?.sellGen) ?? 0;
    return this.clientOrderIdGenerator.generate(levelIndex, side, generation);
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
   *
   * Slot id generations (G1): entries written by current builds always carry
   * both generations and are restored verbatim. A legacy (pre-G1) entry has
   * neither field — its generation-0 id may already carry a terminal history
   * row at the venue (that is exactly what G1 booked as a phantom fill), so a
   * handle-less side starts at generation 1: a side with a live handle keeps
   * generation 0 because that id must keep resolving the open order.
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
        const currentGen =
          savedLevel.buyGen !== undefined || savedLevel.sellGen !== undefined;
        const genFor = (
          current: number | undefined,
          handle: string | undefined
        ): number => {
          if (current !== undefined) return current;
          if (currentGen) return 0;
          return handle ? 0 : 1;
        };
        return {
          price: level.price,
          buyOrderId: savedLevel.buyOrderId,
          sellOrderId: savedLevel.sellOrderId,
          filled: savedLevel.filled,
          buyGen: genFor(savedLevel.buyGen, savedLevel.buyOrderId),
          sellGen: genFor(savedLevel.sellGen, savedLevel.sellOrderId),
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
        buyGen: l.buyGen ?? 0,
        sellGen: l.sellGen ?? 0,
      })),
      savedAt: new Date().toISOString(),
    };
  }

  private async persistSnapshot(): Promise<void> {
    await saveGridSnapshot(this.buildSnapshot());
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
