/** @format */

import {
  ExchangeClient,
  ExchangeFeeRates,
  ExchangeOpenOrder,
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
 * class owns the grid geometry, the tick loop and the executed-price
 * accounting (realised PnL + fees, N6). Slot identity is written only through
 * `OrderManager`; a level's executed entry price is accounting state and is
 * written here.
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

        // Sell order: the exit of a filled level's long. Its price comes from
        // `sellTargetPrice` — the next grid line up, or the configured take
        // profit above the *executed* entry — never `level.price`, which is
        // the very price the buy just filled at (zero spread before fees: N6).
        if (
          this.currentPrice >= level.price &&
          !level.sellOrderId &&
          level.filled
        ) {
          const sellPrice = this.sellTargetPrice(i, level);
          if (sellPrice === undefined) {
            logger.warn(
              "No exit price above the executed entry - level left without a sell",
              {
                botId: this.botId,
                symbol: this.config.symbol,
                levelPrice: level.price,
                entryPrice: level.entryPrice ?? level.price,
              }
            );
          } else {
            const outcome = await this.reconcile.ensureSlotOrder(
              i,
              "SELL",
              sellPrice,
              this.config.orderQuantity
            );
            if (outcome.kind === "FILLED") {
              await this.recordTrade(i, level, "SELL", outcome);
            }
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
   * Record a fill and its executed-price accounting (N6), then emit the
   * durable ledger events (TRADE_EXECUTED + POSITION_UPDATED +
   * PERFORMANCE_SNAPSHOT). Reporting never throws — a tick must not die on a
   * publish failure (the reporter logs the payload for replay).
   *
   * Money rules, locked against the ledger invariant
   * (`bot_instances.total_pnl == SUM(bot_trade_fills.pnl)`):
   * - A BUY opens a long. Its spread is *unrealised* until the paired exit, so
   *   only the fee it incurred is booked (`0 - fee`).
   * - A SELL closes the level's long: `(sellExec - entryExec) × qty - fee` is
   *   realised and booked. The BUY leg's fee is already on its own row, so the
   *   sum over the round trip is `gross - both fees` exactly once.
   * - When the venue's fee rate cannot be sourced, the fee *and* the PnL are
   *   omitted (never `0`): booking an unknown fee as fee-free would silently
   *   overstate profit, so the row declares the money unknown and logs it.
   */
  private async recordTrade(
    levelIndex: number,
    level: GridLevel,
    side: "BUY" | "SELL",
    outcome: Extract<SlotOutcome, { kind: "FILLED" }>
  ): Promise<void> {
    const quantity = outcome.filledQty || this.config.orderQuantity;
    // Executed price: what the venue reported for this fill; else the limit
    // price this slot actually submitted (a resting maker fill executes at its
    // own price); else the level line as a last resort.
    const submitted = this.manager?.getBySlot(levelIndex, side);
    const executedPrice =
      outcome.executedPrice ?? submitted?.price ?? level.price;
    const fee = await this.resolveFee(executedPrice, quantity);

    let entryExec: number | undefined;
    let tradePnl: number | undefined;
    if (side === "BUY") {
      level.entryPrice = executedPrice;
      tradePnl = fee === undefined ? undefined : 0 - fee;
    } else {
      // The price this long was opened at — a level whose long predates
      // executed-price accounting falls back to its own limit line.
      entryExec = level.entryPrice ?? level.price;
      tradePnl =
        fee === undefined
          ? undefined
          : (executedPrice - entryExec) * quantity - fee;
      level.entryPrice = undefined;
    }

    this.totalTrades += 1;
    if (tradePnl !== undefined) this.totalPnl += tradePnl;
    // The id the fill actually happened under — NOT a fresh generation (the
    // slot's gen already bumped inside markFilled; deriving a new id here
    // would book a ledger identity the venue has never seen).
    const clientOrderId = outcome.clientOrderId;
    this.trades.push({
      orderId: clientOrderId,
      symbol: this.config.symbol,
      side,
      quantity,
      price: executedPrice,
      executedAt: new Date(),
      pnl: tradePnl,
    });

    logger.info(side === "BUY" ? "Buy order filled" : "Sell order filled", {
      executedPrice,
      entryPrice: entryExec,
      fee,
      realizedPnl: tradePnl,
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
        price: executedPrice,
        quantity,
        fee,
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
   *
   * N6 split: `pnl` is *realised* PnL net of fees — the number the fill ledger
   * sums to — while open inventory is marked to the last ticker price into
   * `unrealizedPnl`. Entry price is the executed entry of each open leg, not
   * the level's limit line.
   */
  private buildPositionReport(): PositionReport {
    const openLevels = this.levels.filter(l => l.filled);
    const quantity = openLevels.length
      ? Number((openLevels.length * this.config.orderQuantity).toFixed(8))
      : 0;
    const entryPrice = openLevels.length
      ? openLevels.reduce((sum, l) => sum + (l.entryPrice ?? l.price), 0) /
        openLevels.length
      : 0;
    const unrealizedPnl = openLevels.reduce(
      (sum, l) =>
        sum +
        (this.currentPrice - (l.entryPrice ?? l.price)) *
          this.config.orderQuantity,
      0
    );
    return {
      botId: this.botId,
      symbol: this.config.symbol,
      side: quantity > 0 ? "LONG" : "FLAT",
      quantity,
      entryPrice: Number(entryPrice.toFixed(8)),
      markPrice: this.currentPrice,
      pnl: this.totalPnl,
      unrealizedPnl: Number(unrealizedPnl.toFixed(8)),
    };
  }

  /**
   * Price for a filled level's exit (N6).
   *
   * The sell used to be placed at `level.price` — the very price the buy had
   * just filled at, i.e. zero spread before fees. The exit now sits one grid
   * step above the level, or `takeProfitPercent` above the *executed* entry
   * when the bot configures a take profit.
   *
   * Returns undefined when neither geometry yields a price strictly above the
   * entry (a degenerate grid — e.g. a spacing that rounds to zero at the
   * symbol's price scale). The caller then leaves the slot unarmed rather than
   * placing a guaranteed-loss exit.
   */
  private sellTargetPrice(
    levelIndex: number,
    level: GridLevel
  ): number | undefined {
    const entry = level.entryPrice ?? level.price;
    const stepPrice = this.priceAboveLevel(levelIndex, level);
    const takeProfit = this.config.takeProfitPercent;
    const target =
      takeProfit !== undefined && takeProfit > 0
        ? Number((entry * (1 + takeProfit / 100)).toFixed(2))
        : stepPrice;
    if (target === undefined) return undefined;
    if (target > entry) return target;
    // Take-profit rounding can land back on the entry at coarse price scales;
    // the grid step (strictly above the level line) is the safe fallback.
    if (stepPrice !== undefined && stepPrice > entry) return stepPrice;
    return undefined;
  }

  /** The next grid line up, or one spacing above the top line. */
  private priceAboveLevel(
    levelIndex: number,
    level: GridLevel
  ): number | undefined {
    const above = this.levels[levelIndex + 1];
    if (above) return above.price;
    const spacing = this.gridSpacing();
    if (!(spacing > 0)) return undefined;
    return Number((level.price + spacing).toFixed(2));
  }

  /** Distance between adjacent grid lines (0 when the grid degenerates). */
  private gridSpacing(): number {
    if (this.levels.length < 2) return 0;
    return this.levels[1].price - this.levels[0].price;
  }

  /**
   * Fee for one fill as `notional × rate`, from the venue's own account tier
   * (`ExchangeClient.getFeeRates`, N6a).
   *
   * The venue exposes no per-fill fee and never tells the engine whether a
   * fill was maker or taker, so the *taker* rate is used: it is the upper
   * bound of the two, and overstating a fee understates profit — the safe
   * direction for money the venue never confirmed. Resolves `undefined` (never
   * `0`) when the adapter has no fee source or the read fails: an unknown rate
   * must not be booked as fee-free.
   */
  private async resolveFee(
    executedPrice: number,
    quantity: number
  ): Promise<number | undefined> {
    const source = this.exchange.getFeeRates;
    if (!source) return undefined;
    let rates: ExchangeFeeRates;
    try {
      rates = await source.call(this.exchange);
    } catch (error) {
      logger.error("Fee rate unavailable - fill booked without fee/PnL (N6)", {
        botId: this.botId,
        symbol: this.config.symbol,
        executedPrice,
        quantity,
        error: messageOf(error),
      });
      return undefined;
    }
    return Number((executedPrice * quantity * rates.takerRate).toFixed(8));
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
          // Executed entry is only meaningful while the long is open.
          entryPrice: savedLevel.filled ? savedLevel.entryPrice : undefined,
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
        entryPrice: l.entryPrice,
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
