/** @format */

import {
  ExchangeClient,
  ExchangeFeeRates,
  ExchangeOpenOrder,
  ExchangePosition,
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
import { OrderManager, QTY_EPSILON } from "../application/order-manager";
import { OrderReconciliationService } from "../application/order-reconciliation.service";
import {
  PositionReport,
  TradeReporter,
  UndurableFillError,
} from "../application/trade-reporter";
import { FillSegment } from "../utils/fill-id";
import { symbolsMatch } from "../utils/symbol";
import { assertValidGridConfig } from "./grid-config";
import { MarketRules, resolveMarketRules } from "../domain/market-rules";
import {
  isTickMultiple,
  numberToDecimalString,
  quantizePriceNumber,
} from "../utils/price-quantization";

/**
 * How often a single slot's order is re-checked against the exchange (ms).
 * Bounds the reconciliation load on the venue while keeping fill detection
 * responsive enough for one grid tick interval.
 */
const ORDER_CHECK_INTERVAL_MS = 5000;

/**
 * How often the grid-derived position is cross-checked against the venue's own
 * position view (N6). Deliberately far slower than the slot check: this is a
 * safety cross-check, not a fill-detection path, and the venue position read is
 * a portfolio call.
 */
const POSITION_RECONCILE_INTERVAL_MS = 60000;

/**
 * Drift tolerance for the venue position cross-check, as a multiple of one
 * order quantity. A difference up to half an order is treated as noise — an
 * execution the venue has booked but the engine has not yet detected between
 * slot checks (order-check cadence is 5s). Anything larger is real drift.
 */
const POSITION_DRIFT_TOLERANCE_FRACTION = 0.5;

/**
 * Does a submission refusal read as a **size** refusal (Phase 4, risk C2)?
 *
 * The engine has no typed venue-rejection vocabulary: a refused create reaches
 * the grid as an `UNAVAILABLE` string reason, so this is a deliberately narrow
 * text classifier rather than an invented contract. It matches the Lighter
 * minimum-size code pinned live in Gate 4 (`21706`, venue minimum 0.01) plus
 * the wording venues use for the same refusal; an unreachable/transport reason
 * (`lighter unreachable …`, timeouts) can never match, which keeps a freeze
 * from being mistaken for a size refusal. A miss degrades to exactly the
 * pre-Phase-4 behaviour — the remainder is retried and logged — so the cost of
 * being too narrow is a wedged level an operator sees, never a wrong snap.
 */
const SIZE_REFUSAL_PATTERN =
  /21706|minimum (order )?(size|amount|qty|quantity)|min(imum)? size|size (is )?(too )?(small|low|tiny)|below (the )?min(imum)?|less than (the )?min(imum)?/i;

/** See `SIZE_REFUSAL_PATTERN`. */
export function isSizeRefusal(reason: string): boolean {
  return SIZE_REFUSAL_PATTERN.test(reason);
}

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
  /**
   * D3 sessions: the run this strategy instance belongs to. Namespaces the
   * client-order ids and the snapshot path; undefined = legacy bot-scoped
   * behaviour (unit tests, pre-D call sites).
   */
  private runId?: string;
  private running: boolean = false;
  /**
   * Ledger halt (P1 trading-safety): set when a fill could not be durably
   * recorded (`UndurableFillError` — the fill happened on the venue but has
   * no journal entry, so a publish failure leaves no replay path). While
   * halted the strategy places NO new orders; `tick()` returns early and
   * `stop()`/cancels still proceed (a halt must never block flattening).
   * Sticky until an explicit operator Resume (which re-runs the
   * session-start replay gate) — never auto-cleared by a later tick.
   */
  private ledgerHalted: boolean = false;
  private ledgerHaltReason: string | null = null;
  private currentPrice: number = 0;
  private baselinePrice: number = 0;
  /**
   * Authoritative market rules for this strategy's market (Phase B/D).
   *
   * Resolved once in `initialize` before any level is built and pinned for
   * the strategy's life: every grid price is quantized against this tick,
   * snapshots fingerprint it, and a rules change never reprices live
   * levels — new placements freeze instead (Phase E).
   */
  private marketRules: MarketRules | null = null;
  private totalPnl: number = 0;
  private totalTrades: number = 0;
  private trades: Trade[] = [];
  private lastOrderCheck: Map<string, Date> = new Map();
  /**
   * Last venue position cross-check (epoch ms). Seeded at `start()` so the first
   * reconcile runs one full interval later — never on the first tick.
   */
  private lastPositionReconcile: number = 0;
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
    reporter?: TradeReporter,
    runId?: string
  ) {
    // Phase 4: engine-side safety invariant. BotManager resolves through
    // resolveGridConfig, but direct construction must not smuggle an invalid
    // geometry past the boundary — a bad config here builds a nonsensical
    // or empty grid.
    assertValidGridConfig(config);
    this.botId = botId;
    this.config = config;
    this.exchange = exchange;
    this.reporter = reporter ?? null;
    this.runId = runId;
    this.clientOrderIdGenerator = new ClientOrderIdGenerator(botId, runId);
  }

  async initialize(currentPrice: number): Promise<void> {
    this.currentPrice = currentPrice;

    // Phase B/D: market rules are authoritative and required before any
    // level is built or any order placed. A missing method, a fetch
    // failure, or an invalid tick fails closed — never a 2-dp fallback.
    const rules = await resolveMarketRules(
      this.exchange,
      this.config.symbol,
      "grid"
    );
    this.marketRules = rules;
    logger.info("Grid market rules resolved", {
      botId: this.botId,
      symbol: this.config.symbol,
      priceTickSize: rules.priceTickSize,
    });

    const snapResult = loadGridSnapshotResult(this.botId, this.runId);
    const snapshot = snapResult.status === "OK" ? snapResult.snapshot : null;
    // Restore is only authorized for a fully-compatible version-2 snapshot.
    // The compatibility set is every parameter that gives restored orders /
    // inventory their meaning: symbol, grid geometry, and the per-order slot
    // size. A legacy (v1) snapshot, an unknown version, a config mismatch, or a
    // missing/corrupt file all fall through to the untrusted path, which the
    // Phase-2 recovery gate protects (empty book + flat, or refuse).
    // Phase B/D: the market-rules fingerprint joins the set. A snapshot
    // built under a different tick (or a v2 snapshot that predates the
    // fingerprint) cannot authorize a restore — quantized levels would map
    // onto the wrong prices.
    const tickMatches =
      snapshot?.priceTickSize === undefined
        ? false
        : snapshot.priceTickSize === rules.priceTickSize;
    if (snapshot !== null && snapshot.priceTickSize === undefined) {
      logger.warn(
        "Grid snapshot predates market-rules fingerprint; treating as untrusted",
        {
          botId: this.botId,
          symbol: this.config.symbol,
          snapshotVersion: snapshot.version,
        }
      );
    } else if (snapshot !== null && !tickMatches) {
      logger.warn(
        "Grid snapshot market rules mismatch; treating as untrusted",
        {
          botId: this.botId,
          symbol: this.config.symbol,
          snapshotTick: snapshot.priceTickSize,
          currentTick: rules.priceTickSize,
        }
      );
    }
    const canRestore =
      snapshot !== null &&
      snapshot.version === GRID_SNAPSHOT_VERSION &&
      snapshot.symbol === this.config.symbol &&
      snapshot.gridSize === this.config.gridSize &&
      snapshot.gridRangePercent === this.config.gridRangePercent &&
      snapshot.orderQuantity === this.config.orderQuantity &&
      tickMatches;

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
      // whose orders may still be live, and re-arm entries that ignore an
      // existing position) refuse when the venue holds orders we cannot map,
      // holds exposure we cannot explain, or when we cannot ask (D1 — fail
      // closed; recovery requires explicit operator reconciliation).
      await this.requireSafeToInitialize(snapResult);
      this.levels = this.buildLevels(currentPrice);
      this.baselinePrice = currentPrice;
      logger.info("Grid strategy initialized", {
        symbol: this.config.symbol,
        levels: this.levels.length,
        baselinePrice: this.baselinePrice,
        botId: this.botId,
      });
    }

    // Wire order bookkeeping onto the (restored or fresh) levels. The
    // configured slot size is what the manager's `filled` projection and
    // the arming rules compare quantities against (Phase 4).
    this.manager = new OrderManager(
      this.levels,
      this.clientOrderIdGenerator,
      this.config.orderQuantity
    );
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
      // Executions the pass resolved (an order that filled or partly filled
      // while the engine was down) moved the quantity projection; the ledger
      // owes the same segments, or the fill exists in the position and nowhere
      // in the money trail (A2/A3).
      for (const resolved of report.fills) {
        await this.bookOutcome(
          resolved.levelIndex,
          this.levels[resolved.levelIndex],
          resolved.side,
          resolved.outcome
        );
      }
    }

    await this.persistSnapshot();
  }

  /**
   * Fail closed when there is no snapshot to trust — before a fresh grid is
   * built (which would re-place levels and re-arm entries that ignore whatever
   * the account already holds).
   *
   * Both venue reads are mandatory and must resolve to *known, benign* state:
   *
   *  - **Open orders.** If the venue already holds orders for the symbol (or
   *    cannot be asked), rebuilding could place a second order at a level that
   *    is already live.
   *  - **Position.** If the account already holds exposure for the symbol, a
   *    fresh grid would begin placing new entries without representing that
   *    exposure in its per-level inventory — the strategy would grow a position
   *    it never accounted for. We do **not** silently flatten: recovery requires
   *    explicit operator reconciliation, so we refuse.
   *
   * A read that cannot be completed (throws), a position row that is malformed
   * or non-finite, or a symbol we cannot confidently match all fail closed —
   * "unknown" is never treated as "absent/flat". The two reads are not an atomic
   * exchange-wide snapshot (a position can appear between them); that is
   * acceptable because the bot remains unable to trade until both checks pass,
   * and the running position cross-check continues to guard afterwards.
   */
  private async requireSafeToInitialize(
    snapResult: SnapshotLoadResult
  ): Promise<void> {
    const detail =
      snapResult.status === "CORRUPT"
        ? `corrupt snapshot (${snapResult.detail})`
        : snapResult.status === "MISSING"
          ? "no snapshot"
          : "snapshot does not match this config";

    // 1) No unmapped live orders for this symbol.
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
      throw new CommandError(
        false,
        `Refusing to start: ${detail} while ${open.length} live order(s) exist for ${this.config.symbol}`
      );
    }

    // 2) No existing position for this symbol. A non-zero position the fresh
    //    grid cannot explain must block the build (never auto-flattened).
    let positions: ExchangePosition[];
    try {
      positions = await this.exchange.getPositions();
    } catch (error) {
      throw new CommandError(
        false,
        `Refusing to start: cannot verify positions for ${this.config.symbol} (${messageOf(error)})`
      );
    }
    const venuePosition = positions.find(p =>
      symbolsMatch(p.symbol, this.config.symbol)
    );
    if (venuePosition !== undefined) {
      // A successful response is not necessarily a valid position: a missing or
      // non-finite quantity cannot be read as "flat" — fail closed instead.
      const raw = venuePosition.position_qty;
      const qty = Number(raw);
      if (!Number.isFinite(qty)) {
        throw new CommandError(
          false,
          `Refusing to start: ${detail} but the ${this.config.symbol} position quantity is not a finite number (${String(raw)}); reconcile exposure before trading resumes`
        );
      }
      if (qty !== 0) {
        throw new CommandError(
          false,
          `Refusing to start: ${detail} while the account holds a non-zero ${this.config.symbol} position (${qty}); reconcile the existing exposure before trading resumes`
        );
      }
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // A Resume after a ledger halt re-runs the session-start replay gate in
    // bot-manager (which refuses to trade on UNKNOWN/remaining) — but the
    // sticky halt itself clears only here, on explicit (re)start, never on a
    // passing tick. A fresh start is never halted.
    this.ledgerHalted = false;
    this.ledgerHaltReason = null;
    // First venue position cross-check runs one interval after start.
    this.lastPositionReconcile = Date.now();
    logger.info("Grid strategy bot started", {
      botId: this.botId,
      symbol: this.config.symbol,
    });
  }

  /**
   * Whether new order placement is halted after an undurable fill (P1).
   * The runner/backend read this to surface "ledger degraded" instead of a
   * healthy RUNNING.
   */
  isLedgerHalted(): boolean {
    return this.ledgerHalted;
  }

  /** Why placement halted (null when not halted). Operator-facing. */
  ledgerHaltReasonText(): string | null {
    return this.ledgerHaltReason;
  }

  /**
   * Stop the strategy and cancel its live orders. Returns one human-readable
   * problem per order whose cancellation could not be confirmed (N5): the
   * caller decides how to report it — a clean STOPPED must never hide live
   * orders. A ledger halt never blocks stopping: cancels proceed normally.
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
          await this.reconcileCancelledSlot(i, side);
        } catch (error) {
          problems.push(
            `${side}@${this.levels[i].price} not cancelled: ${messageOf(error)}`
          );
        }
      }
    }
    return problems;
  }

  /**
   * Close out a slot whose cancel the venue confirmed (Phase 4, risk A3).
   *
   * A cancel is a terminal state too: a fill can land between the last poll and
   * the cancel, and those executions must reach the ledger and the position
   * before the slot clears — the same rule `checkSlot`'s DEAD branch and
   * `FOUND_CANCELED` follow for a venue-side cancel. The order is terminal by
   * now (the adapter waited for confirmation), so one read resolves it.
   *
   * A venue that disagrees with its own confirmation (still live, or
   * unreachable so nothing can be resolved) frees the slot anyway: the
   * confirmation is the authority here, and a leftover handle would otherwise
   * wedge the level across a restart. Without a reconciler (strategy unit
   * tests) the slot is simply cleared, exactly as before.
   */
  private async reconcileCancelledSlot(
    levelIndex: number,
    side: "BUY" | "SELL"
  ): Promise<void> {
    const clientOrderId = this.generateClientOrderId(levelIndex, side);
    if (!this.reconcile) {
      this.manager?.markNotFound(clientOrderId);
      return;
    }
    const outcome = await this.reconcile.checkSlot(levelIndex, side);
    // Books the remainder of a dead row (A3) or the terminal segment, exactly
    // as the tick would; a no-op for a live/frozen outcome.
    await this.bookOutcome(levelIndex, this.levels[levelIndex], side, outcome);
    // FILLED and SAFE_TO_RECREATE both left the slot free already (the manager
    // cleared the handle on the way through).
    if (outcome.kind === "FILLED" || outcome.kind === "SAFE_TO_RECREATE") {
      return;
    }
    // Venue still reports it live, or could not be read: trust the confirmed
    // cancel and free the slot (the confirmation is the authority).
    logger.warn("Cancel confirmed but the venue still reports the order", {
      botId: this.botId,
      symbol: this.config.symbol,
      side,
      levelPrice: this.levels[levelIndex]?.price,
      outcome: outcome.kind,
    });
    this.manager?.markNotFound(clientOrderId);
  }

  async tick(): Promise<void> {
    if (!this.running || !this.reconcile) return;
    if (this.ledgerHalted) {
      // No new exposure while the accounting record is unguaranteed. The
      // tick loop keeps running (so stop()/cancels still work) but places
      // nothing — recovery is an explicit operator Resume, never a tick.
      logger.warn("Grid tick skipped - ledger halted (undurable fill)", {
        botId: this.botId,
        symbol: this.config.symbol,
        reason: this.ledgerHaltReason,
      });
      return;
    }

    try {
      // Get current price
      const ticker = await this.exchange.getTicker(this.config.symbol);
      this.currentPrice = Number(ticker.mark_price || ticker.price);

      // Check each grid level
      for (let i = 0; i < this.levels.length; i++) {
        const level = this.levels[i];

        // Buy order: place if price is at or below level and no order exists.
        // Arming (C1) is explicit about quantity, not the derived `filled`
        // flag: buy while the level still holds less than a full slot, but
        // never while either side has an order live — a resting exit means the
        // level already holds what it can, and arming an entry beside it would
        // open a second long. An exit-only level (C2) never buys again: it
        // holds real inventory it must exit, and re-entering would grow a
        // position the slot can no longer represent (Phase 3).
        if (
          this.currentPrice <= level.price &&
          !level.buyOrderId &&
          !level.sellOrderId &&
          !this.isFullyLong(level) &&
          !this.isExitOnly(level)
        ) {
          // Only the shortfall is bought: a level that already booked a partial
          // segment tops up to one slot instead of buying a second (C2).
          // Defense in depth: the level price was quantized at build, but the
          // final price is validated again here — never trust, always verify.
          const quantity = this.buyRemainder(level);
          let outcome;
          try {
            outcome = await this.reconcile.ensureSlotOrder(
              i,
              "BUY",
              this.requireTickValid(level.price, "BUY"),
              quantity
            );
          } catch (error) {
            logger.error(
              "Refusing BUY placement: final price failed tick validation",
              {
                botId: this.botId,
                symbol: this.config.symbol,
                levelPrice: level.price,
                error: messageOf(error),
              }
            );
            continue;
          }
          if (
            outcome.kind === "UNAVAILABLE" &&
            quantity < this.config.orderQuantity - QTY_EPSILON &&
            isSizeRefusal(outcome.reason)
          ) {
            // The venue can never fill this remainder (C2): mark the level
            // exit-only so it stops trying to top up and instead exits its real
            // inventory. heldQty stays at the confirmed quantity — no phantom
            // inventory is invented for the un-executed remainder (Phase 3).
            logger.warn(
              "Remainder BUY refused on size - marking the level exit-only (C2)",
              {
                botId: this.botId,
                symbol: this.config.symbol,
                levelPrice: level.price,
                remainder: quantity,
                heldQty: this.heldQtyOf(level),
                orderQuantity: this.config.orderQuantity,
                reason: outcome.reason,
              }
            );
            this.manager?.markExitOnly(i);
          } else {
            await this.bookOutcome(i, level, "BUY", outcome);
          }
        }

        // Sell order: the exit of a filled level's long. Its price comes from
        // `sellTargetPrice` — the next grid line up, or the configured take
        // profit above the *executed* entry — never `level.price`, which is
        // the very price the buy just filled at (zero spread before fees: N6).
        // Sell order: the exit of a level's long. Its price comes from
        // `sellTargetPrice` — the next grid line up, or the configured take
        // profit above the *executed* entry — never `level.price`, which is
        // the very price the buy just filled at (zero spread before fees: N6).
        //
        // Two ways to arm (Phase 3): a fully-long level (held ≥ slot − ε) exits
        // a full slot; an exit-only level (C2 — a below-minimum remainder it can
        // never top up) exits exactly its *verified remaining* inventory, never
        // the configured slot size (that quantity was never filled).
        const fullyLong = this.isFullyLong(level);
        const exitOnlyWithInventory =
          this.isExitOnly(level) && this.heldQtyOf(level) > QTY_EPSILON;
        if (
          this.currentPrice >= level.price &&
          !level.sellOrderId &&
          (fullyLong || exitOnlyWithInventory)
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
            // Size the exit to what the level actually holds: a full slot when
            // fully long, otherwise the verified remaining quantity. The exit
            // is reduce-only (N6), so the venue caps it to the true position
            // regardless — its only job is to close this level's long, never to
            // open a short.
            const exitQty = fullyLong
              ? this.config.orderQuantity
              : this.heldQtyOf(level);
            // Defense in depth: `sellTargetPrice` already quantizes up, but
            // the final price is validated again — an off-tick exit never
            // reaches the venue.
            let validatedSell: number;
            try {
              validatedSell = this.requireTickValid(sellPrice, "SELL");
            } catch (error) {
              logger.error(
                "Refusing SELL placement: final price failed tick validation",
                {
                  botId: this.botId,
                  symbol: this.config.symbol,
                  levelPrice: level.price,
                  sellPrice,
                  error: messageOf(error),
                }
              );
              continue;
            }
            const outcome = await this.reconcile.ensureSlotOrder(
              i,
              "SELL",
              validatedSell,
              exitQty,
              true
            );
            await this.bookOutcome(i, level, "SELL", outcome);
          }
        }
      }

      // Reconcile live slots against the exchange (fill / gone / unreachable).
      await this.reconcileOrders();

      // Cross-check the grid-derived position against the venue (N6).
      await this.reconcilePosition();

      // Persist slot state unconditionally so a restart picks up fills/orders.
      await this.persistSnapshot();
    } catch (error) {
      logger.error("Grid strategy tick error", {
        error: messageOf(error),
        botId: this.botId,
        symbol: this.config.symbol,
      });
      if (error instanceof UndurableFillError) {
        // The fill is now ledger-halted (bookSegment set the sticky flag).
        // Still persist the snapshot so the undurable fill survives a restart
        // (it must not be re-detected as brand-new after the halt clears), then
        // rethrow so the runner's onError surfaces the halt to the backend —
        // a halt confined to a log line is not risk containment.
        await this.persistSnapshot();
        throw error;
      }
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
        await this.bookOutcome(i, level, side, outcome);
        this.lastOrderCheck.set(clientOrderId, new Date());
      }
    }
  }

  /**
   * Book every observation that carries executions (Phase 4).
   *
   * `FILLED`, a still-live `PARTIALLY_FILLED` and a dead row's `pendingFill`
   * (risk A3: the fill that landed between the last poll and the cancel) are
   * one thing to the ledger — "the venue admitted to N more quantity under this
   * handle" — so all three collapse onto `bookSegment`. Everything else
   * (`OPEN`, `UNAVAILABLE`, a plain vanish) carries no execution: no-op.
   */
  private async bookOutcome(
    levelIndex: number,
    level: GridLevel,
    side: "BUY" | "SELL",
    outcome: SlotOutcome
  ): Promise<void> {
    if (outcome.kind === "FILLED") {
      await this.bookSegment(levelIndex, level, side, {
        delta: outcome.delta,
        cumQty: outcome.filledQty,
        status: "FILLED",
        executedPrice: outcome.executedPrice,
        clientOrderId: outcome.clientOrderId,
        orderId: outcome.orderId,
      });
      return;
    }
    if (outcome.kind === "PARTIALLY_FILLED") {
      await this.bookSegment(levelIndex, level, side, {
        delta: outcome.delta,
        cumQty: outcome.cumQty,
        status: "PARTIALLY_FILLED",
        executedPrice: outcome.executedPrice,
        clientOrderId: outcome.clientOrderId,
        orderId: outcome.orderId,
      });
      return;
    }
    if (outcome.kind === "SAFE_TO_RECREATE" && outcome.pendingFill) {
      const pending = outcome.pendingFill;
      await this.bookSegment(levelIndex, level, side, {
        delta: pending.delta,
        cumQty: pending.cumQty,
        status: "PARTIALLY_FILLED",
        executedPrice: pending.executedPrice,
        clientOrderId: pending.clientOrderId,
        orderId: pending.orderId,
      });
    }
  }

  /**
   * Book one fill **segment** and its executed-price accounting (N6), then emit
   * the durable ledger events (TRADE_EXECUTED + POSITION_UPDATED +
   * PERFORMANCE_SNAPSHOT). A journaled-but-unpublished fill resolves normally
   * (replay path intact); a fill that could not be JOURNALED throws
   * `UndurableFillError` and HALTS new order placement (P1 trading-safety) —
   * the fill already happened on the venue, so the halt contains further
   * exposure rather than undoing anything. Publish failures must never kill
   * the tick; journal failures must never be silent.
   *
   * Phase 4: the ledger books `delta` only — the quantity *this* observation
   * added — never the order and never the venue's cumulative (risk A2: a prior
   * `PARTIALLY_FILLED` row already booked its share of the same order). The
   * manager applied exactly that delta to the level before this call, so the
   * level's held quantity here is already post-fill.
   *
   * Money rules, locked against the ledger invariant
   * (`bot_instances.total_pnl == SUM(bot_trade_fills.pnl)`):
   * - A BUY opens a long. Its spread is *unrealised* until the paired exit, so
   *   only the fee it incurred is booked (`0 - fee`). Segments of one order
   *   weighted-average the level's executed entry (risk C3), so the exit prices
   *   itself from what the long was really acquired at.
   * - A SELL closes (part of) the level's long: `(sellExec - entryExec) × qty -
   *   fee` is realised and booked. The BUY leg's fee is already on its own row,
   *   so the sum over the round trip is `gross - both fees` exactly once.
   * - When the venue's fee rate cannot be sourced, the fee *and* the PnL are
   *   omitted (never `0`): booking an unknown fee as fee-free would silently
   *   overstate profit, so the row declares the money unknown and logs it.
   */
  private async bookSegment(
    levelIndex: number,
    level: GridLevel,
    side: "BUY" | "SELL",
    segment: {
      /** Quantity this observation newly booked. */
      delta: number;
      /** Venue cumulative as observed; absent when the venue reported none. */
      cumQty?: number;
      status: "FILLED" | "PARTIALLY_FILLED";
      executedPrice?: number;
      clientOrderId: string;
      orderId?: string;
    }
  ): Promise<void> {
    // The venue's cumulative arithmetic is float subtraction (`0.6 − 0.4` is
    // `0.19999999999999996`), so the booked quantity is quantized to the 8 dp
    // quantities are modeled at — the same quantization the fill-id bounds use
    // (risk A5), which keeps one segment's quantity identical however the venue
    // reports its cumulative and keeps the ledger free of float dust.
    const quantity = Number(segment.delta.toFixed(8));
    if (!(quantity > QTY_EPSILON)) {
      // Nothing new: a re-detection of an already-booked fill (a redelivery, a
      // history lookup after a restart, G1's stale-id row). The venue row is
      // real but the ledger already holds it and the level must not move — the
      // pre-Phase-4 code booked the whole slot again here (A2).
      logger.debug("Fill observation booked nothing - already in the ledger", {
        botId: this.botId,
        symbol: this.config.symbol,
        side,
        clientOrderId: segment.clientOrderId,
        cumQty: segment.cumQty,
      });
      return;
    }
    // Executed price: what the venue reported for this fill; else the limit
    // price this slot actually submitted (a resting maker fill executes at its
    // own price); else the level line as a last resort.
    const submitted = this.manager?.getBySlot(levelIndex, side);
    const executedPrice =
      segment.executedPrice ?? submitted?.price ?? level.price;
    const resolvedFee = await this.resolveFee(executedPrice, quantity);
    const fee = resolvedFee?.fee;

    // Segment bounds (A1): the cumulative before this fill is the cumulative
    // after it minus what it booked. When a venue reports no cumulative at all
    // (legacy adapter, risk D1) the manager's record carries the cumulative it
    // assumed, so the identity stays deterministic. These bounds key the
    // ledger's `fill_id`, so two segments of one order can never collapse onto
    // one row; a segment spanning the whole order keeps the pre-Phase-4 id (A6).
    const to = segment.cumQty ?? submitted?.filledQty ?? quantity;
    const fillSegment: FillSegment = {
      // Bounds are quantized here as well as inside `synthesizeFillId` (A5):
      // `0.6 − 0.2` must read as the `0.4` the ledger already booked, not as
      // `0.39999999999999997`, whichever way the observation was produced.
      from: Number(Math.max(0, to - quantity).toFixed(8)),
      to: Number(to.toFixed(8)),
      full: this.config.orderQuantity,
    };

    const heldAfter = this.heldQtyOf(level);
    const heldBefore =
      side === "BUY"
        ? Math.max(0, heldAfter - quantity)
        : Math.max(0, heldAfter + quantity);

    let entryExec: number | undefined;
    let tradePnl: number | undefined;
    if (side === "BUY") {
      // Weighted average (C3): a level assembled from several segments must
      // exit at the price its long was really acquired at, not the last one's.
      const prior = level.entryPrice;
      level.entryPrice =
        prior !== undefined && heldBefore > QTY_EPSILON
          ? Number(
              (
                (prior * heldBefore + executedPrice * quantity) /
                (heldBefore + quantity)
              ).toFixed(8)
            )
          : executedPrice;
      tradePnl = fee === undefined ? undefined : 0 - fee;
    } else {
      // The price this long was opened at — a level whose long predates
      // executed-price accounting falls back to its own limit line.
      entryExec = level.entryPrice ?? level.price;
      tradePnl =
        fee === undefined
          ? undefined
          : (executedPrice - entryExec) * quantity - fee;
      // Only clear the entry once the long is really gone: a partial exit
      // leaves the remaining inventory priced from the same entry.
      if (heldAfter <= QTY_EPSILON) level.entryPrice = undefined;
    }

    this.totalTrades += 1;
    if (tradePnl !== undefined) this.totalPnl += tradePnl;
    // The id the fill actually happened under — NOT a fresh generation (the
    // slot's gen already bumped inside the manager; deriving a new id here
    // would book a ledger identity the venue has never seen).
    const clientOrderId = segment.clientOrderId;
    this.trades.push({
      orderId: clientOrderId,
      symbol: this.config.symbol,
      side,
      quantity,
      price: executedPrice,
      executedAt: new Date(),
      pnl: tradePnl,
    });

    logger.info(
      side === "BUY"
        ? segment.status === "FILLED"
          ? "Buy order filled"
          : "Buy order partially filled"
        : segment.status === "FILLED"
          ? "Sell order filled"
          : "Sell order partially filled",
      {
        executedPrice,
        entryPrice: entryExec,
        quantity,
        cumulative: to,
        fee,
        realizedPnl: tradePnl,
        botId: this.botId,
        symbol: this.config.symbol,
      }
    );

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
        feeIsEstimate: resolvedFee?.feeIsEstimate,
        pnl: tradePnl,
        status: segment.status,
        clientOrderId,
        exchangeOrderId: segment.orderId ?? clientOrderId,
        executedAt,
        segment: fillSegment,
      });
      await this.reporter.reportPosition(this.buildPositionReport());
      await this.reporter.reportPerformance({
        botId: this.botId,
        totalTrades: this.totalTrades,
        totalPnl: this.totalPnl,
      });
    } catch (error) {
      if (error instanceof UndurableFillError) {
        // Fail closed: the venue fill exists but has no durable record. Halt
        // NEW placements (sticky; tick() early-returns) while still allowing
        // cancels/flattening. Escalate loudly — a log line alone is not risk
        // containment. Recovery is an explicit operator Resume.
        this.ledgerHalted = true;
        this.ledgerHaltReason = error.message;
        logger.error("Ledger halted - fill undurable, no new orders", {
          error: error.message,
          fillId: error.fillId,
          botId: this.botId,
          symbol: this.config.symbol,
          clientOrderId,
        });
        throw error;
      }
      logger.error("Failed to emit ledger events for fill", {
        error: messageOf(error),
        botId: this.botId,
        symbol: this.config.symbol,
        clientOrderId,
      });
    }
  }

  /**
   * Long quantity a level currently holds (Phase 4). `heldQty` is the
   * authoritative projection written by `OrderManager`; a level that has never
   * been booked (and a legacy snapshot, which `OrderManager` seeds) falls back
   * to the boolean `filled` meaning one full slot.
   */
  private heldQtyOf(level: GridLevel): number {
    if (level.heldQty !== undefined) return level.heldQty;
    return level.filled ? this.config.orderQuantity : 0;
  }

  /** Level holds a full slot (the projection behind the boolean `filled`). */
  private isFullyLong(level: GridLevel): boolean {
    return this.heldQtyOf(level) >= this.config.orderQuantity - QTY_EPSILON;
  }

  /**
   * Whether a level is in the exit-only state (Phase 3, risk C2): it holds real
   * inventory a below-minimum remainder means it can never top up, so it must
   * exit rather than re-enter. Read straight off the level so it survives a
   * restart with the same meaning as its confirmed `heldQty`.
   */
  private isExitOnly(level: GridLevel): boolean {
    return level.exitOnly === true;
  }

  /**
   * Size of the BUY that would complete this level: `orderQuantity − held`
   * (Phase 4). A level that already booked a partial segment tops up instead of
   * buying a second slot, and every quantity the venue sees is a plain 8-dp
   * value it can echo back as a cumulative.
   */
  private buyRemainder(level: GridLevel): number {
    const remainder = this.config.orderQuantity - this.heldQtyOf(level);
    return Math.max(0, Number(remainder.toFixed(8)));
  }

  /**
   * The engine's aggregate position over the grid: `Σ heldQty` long, weighted
   * by each level's held quantity (Phase 4 — a level can hold a partial slot,
   * so neither the count of levels nor one configured size describes it).
   * FLAT is reported explicitly so the backend never has to guess what
   * "absent" means.
   *
   * N6 split: `pnl` is *realised* PnL net of fees — the number the fill ledger
   * sums to — while open inventory is marked to the last ticker price into
   * `unrealizedPnl`. Entry price is the executed entry of each open leg, not
   * the level's limit line.
   */
  private buildPositionReport(): PositionReport {
    let quantity = 0;
    let weightedEntry = 0;
    let unrealizedPnl = 0;
    for (const level of this.levels) {
      const held = this.heldQtyOf(level);
      if (held <= 0) continue;
      const entry = level.entryPrice ?? level.price;
      quantity += held;
      weightedEntry += entry * held;
      unrealizedPnl += (this.currentPrice - entry) * held;
    }
    quantity = Number(quantity.toFixed(8));
    return {
      botId: this.botId,
      symbol: this.config.symbol,
      side: quantity > 0 ? "LONG" : "FLAT",
      quantity,
      entryPrice:
        quantity > 0 ? Number((weightedEntry / quantity).toFixed(8)) : 0,
      markPrice: this.currentPrice,
      pnl: this.totalPnl,
      unrealizedPnl: Number(unrealizedPnl.toFixed(8)),
    };
  }

  /**
   * Cross-check the grid-derived position against the venue's own view (N6).
   *
   * The level flags / snapshot are a *projection*; `exchange.getPositions()` is
   * the venue's authority for what the account actually holds. On drift beyond
   * tolerance the venue wins for the emitted `POSITION_UPDATED` (and the
   * mismatch is logged), but the local levels are deliberately **not** rewritten
   * — a single portfolio read is not a basis for silently mutating grid state,
   * and the next detected fill re-syncs the projection anyway.
   *
   * Throttled, and a failed read is logged and skipped: a portfolio read must
   * never take down the trading tick.
   */
  private async reconcilePosition(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPositionReconcile < POSITION_RECONCILE_INTERVAL_MS) {
      return;
    }
    this.lastPositionReconcile = now;

    let positions: ExchangePosition[];
    try {
      positions = await this.exchange.getPositions();
    } catch (error) {
      logger.warn("Position reconciliation skipped - getPositions failed", {
        botId: this.botId,
        symbol: this.config.symbol,
        error: messageOf(error),
      });
      return;
    }

    const venue = positions.find(p => p.symbol === this.config.symbol);
    const venueQty = Number(venue?.position_qty ?? 0);
    const local = this.buildPositionReport();
    const tolerance = Math.max(
      this.config.orderQuantity * POSITION_DRIFT_TOLERANCE_FRACTION,
      1e-8
    );
    const drift = Math.abs(local.quantity - venueQty);
    if (drift <= tolerance) return;

    logger.warn("Position drift vs venue - reporting venue truth (N6)", {
      botId: this.botId,
      symbol: this.config.symbol,
      localQuantity: local.quantity,
      venueQuantity: venueQty,
      drift,
    });

    if (!this.reporter) return;
    const entryPrice =
      venueQty === 0 ? 0 : (this.venueEntryPrice(venue) ?? local.entryPrice);
    const side: "LONG" | "SHORT" | "FLAT" =
      venueQty === 0 ? "FLAT" : venueQty > 0 ? "LONG" : "SHORT";
    await this.reporter.reportPosition({
      botId: this.botId,
      symbol: this.config.symbol,
      side,
      quantity: Math.abs(venueQty),
      entryPrice,
      markPrice: this.currentPrice,
      // Realised PnL stays the ledger-derived local number (the venue does not
      // report it); only the quantity/entry come from the venue here.
      pnl: this.totalPnl,
      unrealizedPnl: Number(
        ((this.currentPrice - entryPrice) * venueQty).toFixed(8)
      ),
    });
  }

  /**
   * Venue-reported entry price when the adapter's position row carries one
   * (Orderly/Lighter both expose extras beyond the contract's `position_qty` /
   * `mark_price`); `undefined` when absent so the local weighted entry is used.
   */
  private venueEntryPrice(
    position: ExchangePosition | undefined
  ): number | undefined {
    if (!position) return undefined;
    const raw = position.entry_price ?? position.average_open_price;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  /**
   * Price for a filled level's exit (N6).
   *
   * The sell used to be placed at `level.price` — the very price the buy had
   * just filled at, i.e. zero spread before fees. The exit now sits one grid
   * step above the level, or `takeProfitPercent` above the *executed* entry
   * when the bot configures a take profit. SELL limits round up (never sell
   * below the calculated target), then the result is re-validated against
   * the executed entry — a target at or below entry leaves the slot unarmed.
   *
   * Returns undefined when neither geometry yields a price strictly above the
   * entry. The caller then leaves the slot unarmed rather than placing a
   * guaranteed-loss exit.
   */
  private sellTargetPrice(
    levelIndex: number,
    level: GridLevel
  ): number | undefined {
    const tick = this.requireTick();
    const entry = level.entryPrice ?? level.price;
    const stepPrice = this.priceAboveLevel(levelIndex, level);
    const takeProfit = this.config.takeProfitPercent;
    let target: number | undefined;
    if (takeProfit !== undefined && takeProfit > 0) {
      target = quantizePriceNumber(entry * (1 + takeProfit / 100), tick, "up");
    } else {
      target = stepPrice;
    }
    if (target === undefined) return undefined;
    // Defense in depth: the quantized price must still be tick-valid.
    if (!isTickMultiple(target, tick)) return undefined;
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
    const tick = this.requireTick();
    const above = this.levels[levelIndex + 1];
    if (above) return above.price;
    const spacing = this.gridSpacing();
    if (!(spacing > 0)) return undefined;
    const quantized = quantizePriceNumber(level.price + spacing, tick, "up");
    // The top-line projection must stay tick-valid and strictly above the
    // level; otherwise the exit cannot be priced and stays unarmed.
    if (!isTickMultiple(quantized, tick)) return undefined;
    if (!(quantized > level.price)) return undefined;
    return quantized;
  }

  /** Distance between adjacent grid lines (0 when the grid degenerates). */
  private gridSpacing(): number {
    if (this.levels.length < 2) return 0;
    return this.levels[1].price - this.levels[0].price;
  }

  /**
   * Pinned tick for this strategy's market. Every price the grid builds or
   * submits is quantized against it. Throws when rules were never resolved
   * (a programming error — `initialize` resolves them first).
   */
  private requireTick(): string {
    const tick = this.marketRules?.priceTickSize;
    if (typeof tick !== "string" || tick.trim() === "") {
      throw new CommandError(
        false,
        `Grid market rules missing for ${this.config.symbol} (refusing to price without a tick)`
      );
    }
    return tick;
  }

  /**
   * Validate one final price immediately before submission (defense in
   * depth): it must be finite, positive, and an exact tick multiple. The
   * strategy already quantizes, so a failure here is a bug — fail closed.
   */
  private requireTickValid(price: number, side: "BUY" | "SELL"): number {
    const tick = this.requireTick();
    if (!Number.isFinite(price) || price <= 0) {
      throw new CommandError(
        false,
        `Refusing to place ${side}: non-finite/non-positive price ${String(price)} for ${this.config.symbol}`
      );
    }
    if (!isTickMultiple(numberToDecimalString(price), tick)) {
      throw new CommandError(
        false,
        `Refusing to place ${side}: price ${price} is not a multiple of tick ${tick} for ${this.config.symbol}`
      );
    }
    return price;
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
   *
   * F5: the result also carries `feeIsEstimate` — true unless the rate was
   * both exact AND role-agnostic (maker == taker) — so the ledger can tell a
   * conservative upper-bound estimate from the venue's own number.
   */
  private async resolveFee(
    executedPrice: number,
    quantity: number
  ): Promise<{ fee: number; feeIsEstimate: boolean } | undefined> {
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
    return {
      fee: Number((executedPrice * quantity * rates.takerRate).toFixed(8)),
      // Exact only when the published rate itself is exact AND maker == taker
      // (the venue's silence on liquidity role then cannot change the number).
      feeIsEstimate:
        rates.exact === false || rates.makerRate !== rates.takerRate,
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
   *
   * Every level is quantized against the pinned market tick: BUY limits
   * round down (never pay more than the calculated target). A grid whose
   * quantized levels collapse (duplicates), leave the configured range, or
   * degenerate to zero spacing fails init — levels are never silently
   * merged and user parameters are never altered.
   */
  private buildLevels(centerPrice: number): GridLevel[] {
    const tick = this.requireTick();
    const priceRange = centerPrice * (this.config.gridRangePercent / 100);
    const minPrice = centerPrice - priceRange / 2;
    const maxPrice = centerPrice + priceRange / 2;
    const gridSpacing = (maxPrice - minPrice) / this.config.gridSize;

    const levels: GridLevel[] = [];
    const seen = new Set<string>();
    for (let i = 0; i <= this.config.gridSize; i++) {
      const raw = minPrice + i * gridSpacing;
      const price = quantizePriceNumber(raw, tick, "down");
      const key = numberToDecimalString(price);
      if (seen.has(key)) {
        throw new CommandError(
          false,
          `Grid construction failed: quantized levels collapse to duplicate price ${key} at tick ${tick} (gridSize ${this.config.gridSize}, range ${this.config.gridRangePercent}%). Refusing to merge levels.`
        );
      }
      seen.add(key);
      levels.push({ price, filled: false });
    }
    // Post-quantize range guard: rounding down may pull the bottom level
    // below the configured band. Fail closed rather than trade a level the
    // user did not configure.
    const bandMin = minPrice;
    const bandMax = maxPrice;
    for (const level of levels) {
      if (level.price < bandMin || level.price > bandMax) {
        throw new CommandError(
          false,
          `Grid construction failed: quantized price ${level.price} left the configured range [${bandMin}, ${bandMax}] at tick ${tick}. Refusing to trade outside the band.`
        );
      }
    }
    const spacing =
      levels.length >= 2 ? levels[1]!.price - levels[0]!.price : 0;
    if (this.config.gridSize >= 1 && !(spacing > 0)) {
      throw new CommandError(
        false,
        `Grid construction failed: quantized spacing collapsed to ${spacing} at tick ${tick}. Refusing a degenerate grid.`
      );
    }
    return levels;
  }

  /**
   * Merge saved slot state onto freshly-built levels by exact price match.
   * Saved buyOrderId/sellOrderId/filled are carried over only when the level
   * price still exists in the rebuilt grid (guards against config changes).
   *
   * Phase B/D: matching is on the canonical decimal string, never raw
   * float identity — `"100.5"` and `"100.50"` are the same level even if
   * the JSON round-trip changed their binary form. A tick change rebuilds
   * different prices and must miss here (the restore gate already refused
   * the snapshot), never silently adopt a level at the wrong price.
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
    const byPrice = new Map<string, GridSnapshotLevel>();
    for (const entry of saved) {
      byPrice.set(numberToDecimalString(entry.price), entry);
    }

    return base.map(level => {
      const savedLevel = byPrice.get(numberToDecimalString(level.price));
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
        const stillLong =
          savedLevel.heldQty !== undefined
            ? savedLevel.heldQty > 0
            : savedLevel.filled;
        return {
          price: level.price,
          buyOrderId: savedLevel.buyOrderId,
          sellOrderId: savedLevel.sellOrderId,
          filled: savedLevel.filled,
          // Phase 4 quantity state: restored verbatim so the manager can seed
          // its instance cumulatives from it (risk A4) instead of re-booking a
          // cumulative it already booked before the restart. `undefined` on a
          // legacy snapshot, where the manager derives `heldQty` from `filled`.
          heldQty: savedLevel.heldQty,
          buyFilledQty: savedLevel.buyFilledQty,
          sellFilledQty: savedLevel.sellFilledQty,
          // The executed entry still matters while the level holds *any*
          // quantity (risk C3): a partial long whose entry was dropped would
          // re-price its exit from the level line and can force a loss.
          entryPrice: stillLong ? savedLevel.entryPrice : undefined,
          buyGen: genFor(savedLevel.buyGen, savedLevel.buyOrderId),
          sellGen: genFor(savedLevel.sellGen, savedLevel.sellOrderId),
          // Exit-only (Phase 3): restored verbatim so a level that could not
          // top up a below-minimum remainder keeps exiting its real inventory
          // across a restart — `heldQty` still means confirmed fills only.
          exitOnly: savedLevel.exitOnly,
        };
      }
      return { ...level };
    });
  }

  private buildSnapshot(): GridSnapshot {
    return {
      version: GRID_SNAPSHOT_VERSION,
      botId: this.botId,
      // D3: stamp the run so the per-run path validates ownership. Undefined
      // keeps legacy unit-test snapshots byte-identical.
      ...(this.runId ? { runId: this.runId } : {}),
      symbol: this.config.symbol,
      gridSize: this.config.gridSize,
      gridRangePercent: this.config.gridRangePercent,
      // Execution-config compatibility set (Phase 1): restored inventory and
      // fill cumulatives are only meaningful under this slot size, so it is
      // recorded and compared on restore.
      orderQuantity: this.config.orderQuantity,
      // Phase B/D market-rules fingerprint: the tick every level was
      // quantized against. Restore compares it — a mismatch (or a v2
      // snapshot that predates it) routes to the untrusted path instead of
      // silently adopting levels built under different rules.
      priceTickSize: this.marketRules?.priceTickSize,
      baselinePrice: this.baselinePrice,
      levels: this.levels.map((l): GridSnapshotLevel => ({
        price: l.price,
        buyOrderId: l.buyOrderId,
        sellOrderId: l.sellOrderId,
        filled: l.filled,
        entryPrice: l.entryPrice,
        buyGen: l.buyGen ?? 0,
        sellGen: l.sellGen ?? 0,
        // Phase 4 quantity state (E3, additive — no version bump): the level's
        // held quantity and each resting instance's booked cumulative, so a
        // restart resumes deltas exactly where this process left them (A4).
        // Left `undefined` (and so absent from the JSON) on a level the manager
        // never touched, which keeps a never-booked snapshot byte-identical.
        heldQty: l.heldQty,
        buyFilledQty: l.buyFilledQty,
        sellFilledQty: l.sellFilledQty,
        // Exit-only state (Phase 3): persisted so the "cannot top up, must exit
        // real inventory" decision survives a restart. Left `undefined` (absent
        // from the JSON) on a normal level, keeping a never-touched snapshot
        // byte-identical.
        exitOnly: l.exitOnly,
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
