/**
 * Bot Manager
 *
 * Manages the lifecycle of trading bots.
 * Coordinates command handling, strategy execution, and event publishing.
 *
 * @format
 */

import { BotActualState, EmergencyStopAction } from "@trade-bot/shared";
import { GridTradingStrategy } from "../strategies/grid";
import { createExchangeClient } from "../exchanges/factory";
import { isEngineCredentials } from "@trade-bot/shared";
import { RedisStreamOperations } from "../infrastructure/redis/streams";
import { logger } from "../utils/logger";
import { BotRuntime, EngineIdentity } from "../domain/bot-runtime";
import { ExchangeOpenOrder, ExchangePosition } from "../domain/exchange";
import {
  publishEvent,
  publishAccepted,
  publishFailed,
} from "../protocol/event-publisher";
import { fetchCredentials } from "../protocol/credential-fetcher";
import { CommandError } from "./command-error";
import { StrategyRunner } from "./strategy-runner";
import { LedgerTradeReporter } from "./trade-reporter";

const TICK_INTERVAL_MS = 5000;

/**
 * Marker the engine puts in the terminal STATE_CHANGED `reason` when a panic
 * stop could not finish its venue-side cleanup (an order cancel or the flatten
 * failed, so exposure may remain). The backend keys off it to keep the fact
 * visible after the row converges to STOPPED — the row itself cannot carry the
 * reason, and a clean-looking STOPPED is exactly the lie a panic button must
 * never tell. Wire contract: keep in sync with the backend's
 * `CLEANUP_INCOMPLETE_MARKER`.
 */
export const CLEANUP_INCOMPLETE_MARKER = "cleanup_incomplete";

/** How many cleanup problems are folded into the terminal reason. */
const MAX_CLEANUP_PROBLEMS_IN_REASON = 3;

/** Error → message, for logs and the terminal stop reason. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BotManager {
  private bots: Map<string, BotRuntime> = new Map();
  private initializing: Set<string> = new Set();
  private stopRequested: Set<string> = new Set();
  private engineId: string;
  private epoch: number;

  constructor(identity: EngineIdentity) {
    this.engineId = identity.engineId;
    this.epoch = identity.epoch;
    logger.info("BotManager initialized", {
      engineId: this.engineId,
      epoch: this.epoch,
    });
  }

  get activeBotIds(): string[] {
    return Array.from(this.bots.keys());
  }

  hasBot(botId: string): boolean {
    return this.bots.has(botId);
  }

  isInitializing(botId: string): boolean {
    return this.initializing.has(botId);
  }

  isStopRequested(botId: string): boolean {
    return this.stopRequested.has(botId);
  }

  /**
   * Request cancellation of a bot being initialized.
   */
  requestStop(botId: string): void {
    this.stopRequested.add(botId);
  }

  /**
   * Get all active bot runtimes.
   */
  getBotRuntimes(): Map<string, BotRuntime> {
    return this.bots;
  }

  /**
   * Publish a state change event for a bot.
   */
  async publishStateChanged(
    streamOps: RedisStreamOperations,
    botId: string,
    from: BotActualState,
    to: BotActualState,
    correlationId: string,
    reason?: string
  ): Promise<void> {
    await publishEvent(
      streamOps,
      "STATE_CHANGED",
      {
        botId,
        engineId: this.engineId,
        engineEpoch: this.epoch,
        from,
        to,
        reason: reason || "",
      },
      correlationId
    );
  }

  /**
   * Publish COMMAND_ACCEPTED.
   */
  async publishAccepted(
    streamOps: RedisStreamOperations,
    botId: string,
    commandType: string,
    correlationId: string
  ): Promise<void> {
    await publishAccepted(
      streamOps,
      botId,
      commandType,
      this.engineId,
      this.epoch,
      correlationId
    );
  }

  /**
   * Publish COMMAND_FAILED.
   */
  async publishFailed(
    streamOps: RedisStreamOperations,
    botId: string,
    commandType: string,
    errorCode: string,
    message: string,
    correlationId: string
  ): Promise<void> {
    await publishFailed(
      streamOps,
      botId,
      commandType,
      this.engineId,
      this.epoch,
      errorCode,
      message,
      correlationId
    );
  }

  /**
   * Handle BOT_START command.
   */
  async handleStart(
    streamOps: RedisStreamOperations,
    botId: string,
    userId: string,
    strategyId: string,
    config: Record<string, unknown>,
    correlationId: string
  ): Promise<void> {
    // Race guard
    if (this.initializing.has(botId) || this.bots.has(botId)) {
      logger.warn("Bot already initializing or running", { botId });
      await this.publishFailed(
        streamOps,
        botId,
        "BOT_START",
        "BOT_ALREADY_RUNNING",
        "Bot is already running",
        correlationId
      );
      return;
    }
    this.initializing.add(botId);
    try {
      await this.doStartBot(
        streamOps,
        botId,
        userId,
        strategyId,
        config,
        correlationId
      );
    } finally {
      this.initializing.delete(botId);
    }
  }

  /**
   * Handle BOT_STOP command.
   */
  async handleStop(
    streamOps: RedisStreamOperations,
    botId: string,
    correlationId: string
  ): Promise<void> {
    const existing = this.bots.get(botId);
    if (!existing) {
      logger.warn("Bot not found for stop", { botId });
      await this.publishFailed(
        streamOps,
        botId,
        "BOT_STOP",
        "BOT_NOT_FOUND",
        "Bot not found",
        correlationId
      );
      return;
    }
    await this.publishStateChanged(
      streamOps,
      botId,
      "RUNNING",
      "STOPPING",
      correlationId,
      "normal_stop"
    );
    try {
      const stopProblems = await existing.strategy.stop();
      existing.stopTick();
      this.bots.delete(botId);

      // A clean STOPPED must never hide orders a cancel could not confirm (N5):
      // carry the problems in the terminal reason, exactly like the panic path.
      const terminalReason = stopProblems.length
        ? `normal_stop; ${CLEANUP_INCOMPLETE_MARKER}: ${summarizeProblems(stopProblems)}`
        : "normal_stop";
      if (stopProblems.length) {
        logger.error("Normal stop: cancellation not confirmed", {
          botId,
          problems: stopProblems,
        });
      }
      await this.publishStateChanged(
        streamOps,
        botId,
        "STOPPING",
        "STOPPED",
        correlationId,
        terminalReason
      );
    } catch (error) {
      existing.stopTick();
      this.bots.delete(botId);
      logger.error("Strategy stop error", {
        botId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.publishStateChanged(
        streamOps,
        botId,
        "STOPPING",
        "STOPPED",
        correlationId,
        `normal_stop; ${CLEANUP_INCOMPLETE_MARKER}: stop failed`
      );
    }
  }

  /**
   * Handle EMERGENCY_STOP command (M1).
   *
   * Order of operations matters and is deliberate:
   * 1. Report RUNNING → STOPPING (the backend badges FORCE_STOPPING on it).
   * 2. Kill trading: `strategy.stop()` flips the grid's running flag and
   *    cancels the orders it tracks, then the tick runner is stopped and the
   *    bot is deregistered. Nothing can re-place afterwards.
   * 3. Venue-side cleanup for the selected action — orphan orders for the
   *    bot's symbol, then (unless CANCEL_ALL_ORDERS) a flattening order.
   * 4. Report STOPPING → STOPPED.
   *
   * Every cleanup step is best-effort: failures are logged loudly but never
   * block the terminal STATE_CHANGED, because the backend's FORCE_STOPPING
   * badge is only cleared by that report and a stuck badge hides the facts.
   */
  async handleEmergencyStop(
    streamOps: RedisStreamOperations,
    botId: string,
    action: EmergencyStopAction,
    correlationId: string
  ): Promise<void> {
    const existing = this.bots.get(botId);
    if (!existing) {
      logger.warn("Bot not found for emergency stop", { botId, action });
      await this.publishFailed(
        streamOps,
        botId,
        "EMERGENCY_STOP",
        "BOT_NOT_FOUND",
        "Bot not found",
        correlationId
      );
      return;
    }

    const reason = `emergency_stop:${action}`;
    logger.warn("Emergency stop started", { botId, action });
    await this.publishStateChanged(
      streamOps,
      botId,
      "RUNNING",
      "STOPPING",
      correlationId,
      reason
    );

    // 1. Kill trading first (strategy.stop cancels the orders it tracks).
    let problems: string[] = [];
    try {
      problems = await existing.strategy.stop();
    } catch (error) {
      problems = [messageOf(error)];
      logger.error("Emergency stop: strategy stop error", {
        botId,
        error: messageOf(error),
      });
    }
    existing.stopTick();
    this.bots.delete(botId);

    // 2. Venue-side cleanup (best-effort, never blocks the STOPPED report).
    problems.push(...(await this.emergencyCancelOpenOrders(existing)));
    if (action !== "CANCEL_ALL_ORDERS") {
      problems.push(...(await this.emergencyClosePosition(existing)));
    }

    // The STOPPED report is what clears the backend's FORCE_STOPPING badge, so
    // it must always go out — but a cleanup that could not finish has to travel
    // with it. Otherwise the row converges to a clean-looking STOPPED while the
    // venue still holds orders/position: exactly the lie a panic button must
    // never tell.
    const terminalReason = problems.length
      ? `${reason}; ${CLEANUP_INCOMPLETE_MARKER}: ${summarizeProblems(problems)}`
      : reason;

    await this.publishStateChanged(
      streamOps,
      botId,
      "STOPPING",
      "STOPPED",
      correlationId,
      terminalReason
    );
    if (problems.length) {
      logger.error("Emergency stop: cleanup incomplete", {
        botId,
        action,
        problems,
      });
    }
    logger.warn("Emergency stop complete", { botId, action });
  }

  /**
   * Cancel every order still open on the bot's symbol. `strategy.stop()` has
   * already cancelled the tracked grid orders and the runner is dead, so
   * whatever this lists is an orphan (e.g. a placement that landed after the
   * strategy's last bookkeeping). Per-order failures are logged and skipped,
   * but returned so the terminal report can say the cleanup was incomplete.
   *
   * @returns one human-readable problem per failed step (empty ⇒ clean).
   */
  private async emergencyCancelOpenOrders(
    runtime: BotRuntime
  ): Promise<string[]> {
    let open: ExchangeOpenOrder[];
    try {
      open = await runtime.exchangeClient.listOpenOrders(runtime.symbol);
    } catch (error) {
      const detail = messageOf(error);
      logger.error("Emergency stop: open-order listing failed", {
        botId: runtime.botId,
        symbol: runtime.symbol,
        error: detail,
      });
      return [`open-order listing failed: ${detail}`];
    }

    const problems: string[] = [];
    for (const order of open) {
      try {
        await runtime.exchangeClient.cancelOrder(
          order.orderId,
          order.symbol || runtime.symbol
        );
        logger.warn("Emergency stop: orphan order cancelled", {
          botId: runtime.botId,
          orderId: order.orderId,
          symbol: runtime.symbol,
        });
      } catch (error) {
        const detail = messageOf(error);
        logger.error("Emergency stop: orphan order cancel failed", {
          botId: runtime.botId,
          orderId: order.orderId,
          error: detail,
        });
        problems.push(`orphan order ${order.orderId} not cancelled: ${detail}`);
      }
    }
    return problems;
  }

  /**
   * Flatten the bot's position with an opposite MARKET order.
   *
   * Deliberately conservative — on this venue positions belong to the
   * *account*, not the bot:
   * - Skipped entirely when another engine bot trades the same symbol (that
   *   bot owns the same position; closing it would close someone else's
   *   exposure).
   * - When the venue reports no position for the symbol the step is a no-op.
   * - Sizing/precision is the adapter's job (it scales to the market's size
   *   decimals and rejects sub-minimum sizes); a rejected flatten is reported
   *   as an incomplete cleanup, never as a silent success.
   *
   * @returns the problems that left exposure open (empty ⇒ flat or nothing to do).
   */
  private async emergencyClosePosition(runtime: BotRuntime): Promise<string[]> {
    for (const [otherId, other] of this.bots) {
      if (otherId !== runtime.botId && other.symbol === runtime.symbol) {
        logger.warn(
          "Emergency stop: position flatten skipped - another bot trades this symbol",
          {
            botId: runtime.botId,
            otherBotId: otherId,
            symbol: runtime.symbol,
          }
        );
        return [];
      }
    }

    let positions: ExchangePosition[];
    try {
      positions = await runtime.exchangeClient.getPositions();
    } catch (error) {
      const detail = messageOf(error);
      logger.error("Emergency stop: position fetch failed", {
        botId: runtime.botId,
        symbol: runtime.symbol,
        error: detail,
      });
      return [`position fetch failed (exposure unknown): ${detail}`];
    }

    const position = positions.find(
      p =>
        symbolsMatch(p.symbol, runtime.symbol) &&
        Number.isFinite(Number(p.position_qty)) &&
        Number(p.position_qty) !== 0
    );
    if (!position) {
      logger.info("Emergency stop: no open position to close", {
        botId: runtime.botId,
        symbol: runtime.symbol,
      });
      return [];
    }

    const positionQty = Number(position.position_qty);
    const side: "BUY" | "SELL" = positionQty > 0 ? "SELL" : "BUY";
    try {
      const order = await runtime.exchangeClient.createOrder({
        symbol: runtime.symbol,
        side,
        orderType: "MARKET",
        orderQuantity: Math.abs(positionQty),
      });
      logger.warn("Emergency stop: position flatten order placed", {
        botId: runtime.botId,
        symbol: runtime.symbol,
        side,
        positionQty,
        orderId: order.orderId,
        status: order.status,
      });
      return [];
    } catch (error) {
      const detail = messageOf(error);
      logger.error(
        "Emergency stop: position flatten failed - exposure may remain",
        {
          botId: runtime.botId,
          symbol: runtime.symbol,
          side,
          positionQty,
          error: detail,
        }
      );
      return [
        `position ${positionQty} ${runtime.symbol} not flattened: ${detail}`,
      ];
    }
  }

  /**
   * Core bot initialization.
   */
  private async doStartBot(
    streamOps: RedisStreamOperations,
    botId: string,
    userId: string,
    strategyId: string,
    config: Record<string, unknown>,
    correlationId: string
  ): Promise<void> {
    let runner: StrategyRunner | null = null;
    const stopRunner = (): void => runner?.stop();

    try {
      await this.publishStateChanged(
        streamOps,
        botId,
        "STOPPED",
        "STARTING",
        correlationId
      );
      this.throwIfCancelled(botId);

      // 1. Fetch credentials
      const credentials = await fetchCredentials(botId, correlationId);
      this.throwIfCancelled(botId);

      // 2. Connect exchange client. The credential fetcher already validated
      // the envelope against the shared contract; the factory maps the
      // `exchange` discriminator onto the concrete client (`kodiak` →
      // Orderly-backed, `lighter` → REST + signer sidecar). An exchange
      // outside the union fails here with a non-retryable
      // UNSUPPORTED_EXCHANGE.
      if (!isEngineCredentials(credentials)) {
        throw new CommandError(
          false,
          "Malformed credential envelope (expected EngineCredentials)"
        );
      }
      const exchangeClient = createExchangeClient(credentials);

      // 3. Get market price
      const symbol = String(config.symbol || "");
      if (!symbol) {
        throw new CommandError(false, "Strategy config is missing symbol");
      }
      this.throwIfCancelled(botId);
      const ticker = await exchangeClient.getTicker(symbol);
      this.throwIfCancelled(botId);
      const currentPrice = Number(ticker.mark_price || ticker.price);
      if (!currentPrice) {
        throw new CommandError(
          false,
          `Could not resolve current price for ${symbol}`
        );
      }

      // 4. Create and start strategy. The ledger reporter closes over this
      // engine's identity (engineId + epoch — the backend's authority check
      // rejects payloads without them) and the events stream, so fills,
      // positions and order intents reach the durable ledger (Phase 4).
      const tradeReporter = new LedgerTradeReporter(
        streamOps,
        this.engineId,
        this.epoch
      );
      const gridStrategy = new GridTradingStrategy(
        botId,
        {
          symbol,
          gridSize: Number(config.gridSize) || 10,
          gridRangePercent: Number(config.gridRange) || 5,
          orderQuantity: Number(config.orderQuantity) || 1,
          // Optional take profit (the API validates it as `takeProfit`). When
          // set, exits price `takeProfitPercent` above the executed entry
          // instead of at the next grid line (N6).
          takeProfitPercent:
            Number(config.takeProfit) > 0
              ? Number(config.takeProfit)
              : undefined,
        },
        exchangeClient,
        tradeReporter
      );
      await gridStrategy.initialize(currentPrice);
      this.throwIfCancelled(botId);
      await gridStrategy.start();
      this.throwIfCancelled(botId);

      // 5. Non-overlapping strategy tick loop (single-flight guard inside StrategyRunner)
      runner = new StrategyRunner(
        botId,
        TICK_INTERVAL_MS,
        () => gridStrategy.tick(),
        {
          onError: error =>
            logger.error("Strategy tick error", {
              botId,
              error: error instanceof Error ? error.message : String(error),
            }),
          onSkip: () =>
            logger.warn("Previous tick still running, skipping", { botId }),
        }
      );
      runner.start();

      // Register bot
      this.bots.set(botId, {
        botId,
        strategyId,
        userId,
        symbol,
        state: "RUNNING",
        strategy: gridStrategy,
        stopTick: stopRunner,
        exchangeClient,
      });

      await this.publishStateChanged(
        streamOps,
        botId,
        "STARTING",
        "RUNNING",
        correlationId,
        "started"
      );
    } catch (error) {
      stopRunner();
      this.bots.delete(botId);
      const err = error instanceof Error ? error : new Error(String(error));
      await this.publishFailed(
        streamOps,
        botId,
        "BOT_START",
        "INIT_FAILED",
        err.message,
        correlationId
      );
      await this.publishStateChanged(
        streamOps,
        botId,
        "STARTING",
        "ERROR",
        correlationId,
        err.message
      );
      // L22: the outcome is already authoritative on the wire (COMMAND_FAILED
      // + STATE_CHANGED ERROR), so retrying this command can only re-run a
      // start the backend has failed. Rethrowing the original error left
      // plain errors (axios 4xx, unknown market, ...) classified as
      // retryable, and the consumer redelivered the same command forever
      // (42 deliveries in 3.2 h in the live log). Surface every post-report
      // failure as a non-retryable CommandError so the consumer ACKs it.
      const reported = new CommandError(false, err.message);
      reported.stack = err.stack ?? reported.stack;
      throw reported;
    }
  }

  private throwIfCancelled(botId: string): void {
    if (this.stopRequested.has(botId)) {
      this.stopRequested.delete(botId);
      throw new CommandError(false, "Bot initialization cancelled");
    }
  }
}

/**
 * Compare a venue-reported position symbol with the bot's configured symbol.
 * Case/whitespace-insensitive only — a mismatch (unknown symbol format) must
 * skip the flatten rather than close the wrong market.
 */
function symbolsMatch(venueSymbol: string, configSymbol: string): boolean {
  return (
    String(venueSymbol ?? "")
      .trim()
      .toUpperCase() ===
    String(configSymbol ?? "")
      .trim()
      .toUpperCase()
  );
}

/**
 * Fold cleanup problems into one bounded, log-line-safe reason: the first few
 * details plus a count of the rest. The reason is copied into the audit trail
 * and the operator's UI, so it must stay short and free of newlines.
 */
function summarizeProblems(problems: string[]): string {
  const shown = problems.slice(0, MAX_CLEANUP_PROBLEMS_IN_REASON);
  const rest = problems.length - shown.length;
  const text = shown.map(problem => problem.replace(/\s+/g, " ")).join("; ");
  return rest > 0 ? `${text}; +${rest} more` : text;
}
