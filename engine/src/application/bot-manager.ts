/**
 * Bot Manager
 *
 * Manages the lifecycle of trading bots.
 * Coordinates command handling, strategy execution, and event publishing.
 *
 * @format
 */

import {
  BotActualState,
  BotEventPayload,
  EmergencyStopAction,
  EstimateReadyEventPayload,
} from "@trade-bot/shared";
import { GridTradingStrategy } from "../strategies/grid";
import { createExchangeClient } from "../exchanges/factory";
import { isEngineCredentials } from "@trade-bot/shared";
import { RedisStreamOperations } from "../infrastructure/redis/streams";
import { logger } from "../utils/logger";
import {
  BotRuntime,
  EngineIdentity,
  StrategyRunState,
} from "../domain/bot-runtime";
import {
  ExchangeClient,
  ExchangeOpenOrder,
  ExchangePosition,
} from "../domain/exchange";
import {
  publishEvent,
  publishAccepted,
  publishFailed,
} from "../protocol/event-publisher";
import { fetchCredentials } from "../protocol/credential-fetcher";
import { CommandError } from "./command-error";
import {
  assertEngineResidualCapacity,
  sessionCapLeverage,
  sessionRequestedNotional,
  sumPositionExposure,
} from "./residual-capacity";
import { StrategyRunner } from "./strategy-runner";
import { LedgerTradeReporter } from "./trade-reporter";
import { symbolsMatch } from "../utils/symbol";
import { resolveGridConfig } from "../strategies/grid-config";

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

/**
 * Panic-flatten discipline (P0.1 — the 2026-10-14 incident): the old
 * single-shot full-size MARKET order left 2 BTC open on a thin testnet book
 * (the IOC filled the depth inside its band and cancelled the rest), while
 * the engine — one shot, no retry, no re-verification — reported "exposure
 * may remain" and stopped with the exposure (and the order's market impact)
 * still live at the venue. The loop in `emergencyClosePosition` re-reads the
 * POSITION (venue ground truth) before every slice, sizes slices to real
 * book depth where the adapter reports it, widens the crossing band only
 * when a slice made no progress, and reports the verified residual — never a
 * generic "failed", never a silent success.
 */
const FLATTEN_MAX_SLICES = 5;
/** Wall-clock bound across the whole flatten (each slice may poll ~6 s). */
const FLATTEN_TIME_BUDGET_MS = 45_000;
/**
 * Crossing-band ladder (bps off mark) — bounded by construction: exiting a
 * panic may cost basis points, but the ladder can never exceed the last rung
 * no matter how the loop behaves, and the Lighter adapter clamps the band
 * independently (its own 1–1000 bps fail-closed check).
 */
const FLATTEN_BAND_RUNGS_BPS = [100, 150, 225, 300] as const;
/** Consecutive non-shrinking position reads before the honest give-up. */
const FLATTEN_MAX_NO_PROGRESS = 4;

/** Error → message, for logs and the terminal stop reason. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Which ACCOUNT a runtime trades, when its adapter exposes one.
 *
 * `undefined` means unknown — never "no account". Callers must treat an
 * unknown identity conservatively (as possibly shared), because positions on
 * these venues belong to the account, not the bot: guessing "distinct" when
 * the truth is "shared" closes someone else's position.
 */
function accountIdentityOf(runtime: BotRuntime): string | undefined {
  const client = runtime.exchangeClient;
  if (typeof client.getAccountIdentity !== "function") return undefined;
  return client.getAccountIdentity();
}

/**
 * A grid strategy prepared for execution but awaiting authorization.
 *
 * No orders are placed and no tick loop runs while a run sits in this state —
 * only a matching BOT_AUTHORIZE (same runId + preparationVersion) may start
 * it. The engine reports the exposure figures; the backend is the authority
 * that decides whether the run may trade.
 */
interface PreparedRun {
  runId: string;
  preparationVersion: number;
  strategy: GridTradingStrategy;
  exchangeClient: ExchangeClient;
  tradeReporter: LedgerTradeReporter;
  symbol: string;
  gridSize: number;
  orderQuantity: number;
  priceUsed: number;
  estimatedRestingNotional: number;
  perOrderNotional: number;
}

export class BotManager {
  private bots: Map<string, BotRuntime> = new Map();
  private initializing: Set<string> = new Set();
  private stopRequested: Set<string> = new Set();
  /**
   * Prepared runs awaiting BOT_AUTHORIZE, keyed by botId. A run in this map
   * has been initialized (grid built, exposure estimated) but NOT started: no
   * orders placed, no tick runner armed. Execution begins only after a
   * matching BOT_AUTHORIZE validates this exact preparation.
   */
  private prepared: Map<string, Map<string, PreparedRun>> = new Map();
  /**
   * Monotonic preparation version per bot. A BOT_AUTHORIZE carrying a stale
   * version is rejected, so a valid authorization can never execute a
   * superseded preparation.
   */
  private preparationVersions: Map<string, number> = new Map();
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
   * Handle BOT_START command. D3 sessions: the payload carries `runs[]`
   * (backend dispatcher); one credential fetch + one exchange client serve
   * all runs. Legacy single-strategy payloads (no `runs`) start exactly one
   * run mirroring the old behaviour.
   */
  async handleStart(
    streamOps: RedisStreamOperations,
    botId: string,
    userId: string,
    strategyId: string,
    config: Record<string, unknown>,
    correlationId: string,
    runs?: Array<{
      runId: string;
      strategyId: string;
      configVersion: number;
      config: Record<string, unknown>;
      notionalAmount: number;
    }>
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
      // Session fan-out: one entry per run, else the legacy single run. A
      // legacy payload declares no notional (fabricated 0 below) — the
      // residual-capacity backstop then gates on live venue exposure only
      // ("no declared intent"), never on a made-up size.
      const declaredRuns = runs && runs.length > 0 ? runs : null;
      const runSpecs = declaredRuns ?? [
        {
          runId: undefined as unknown as string,
          strategyId,
          configVersion: 1,
          config,
          notionalAmount: 0,
        },
      ];
      // Preparation only: the engine resolves the config, prices the grid and
      // reports the estimate (ESTIMATE_READY). It places NO orders and arms
      // NO tick runner — execution waits for a matching BOT_AUTHORIZE.
      await this.doPrepareSession(
        streamOps,
        botId,
        userId,
        strategyId,
        config,
        correlationId,
        runSpecs,
        declaredRuns !== null
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
      // D3 sessions: stop every run's strategy + runner, not just the
      // primary. Legacy single-run sessions carry one entry, so this is a
      // no-op for them.
      if (existing.runs) {
        for (const [, run] of existing.runs) {
          if (run.strategy !== existing.strategy) {
            try {
              const extra = await run.strategy.stop();
              stopProblems.push(...extra);
            } catch (error) {
              stopProblems.push(messageOf(error));
            }
          }
          if (run.stopTick !== existing.stopTick) run.stopTick();
        }
      }
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
      if (existing.runs) {
        for (const [, run] of existing.runs) {
          if (run.stopTick !== existing.stopTick) run.stopTick();
        }
      }
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

    // 1. Kill trading first (every run's strategy.stop cancels the orders it
    // tracks).
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
    if (existing.runs) {
      for (const [, run] of existing.runs) {
        if (run.strategy === existing.strategy) continue;
        try {
          problems.push(...(await run.strategy.stop()));
        } catch (error) {
          problems.push(messageOf(error));
          logger.error("Emergency stop: run strategy stop error", {
            botId,
            runId: run.runId,
            error: messageOf(error),
          });
        }
      }
    }
    existing.stopTick();
    if (existing.runs) {
      for (const [, run] of existing.runs) {
        if (run.stopTick !== existing.stopTick) run.stopTick();
      }
    }
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
   * Flatten the bot's position with opposite reduce-only MARKET orders,
   * slice by slice, verified against the venue's own position read (P0.1).
   *
   * Deliberately conservative — on this venue positions belong to the
   * *account*, not the bot:
   * - Skipped when a sibling engine bot shares this bot's ACCOUNT and symbol
   *   (that bot owns the same position; closing it would close someone else's
   *   exposure). Keyed on account identity, NOT symbol alone — two accounts
   *   trading the same symbol hold independent positions, and skipping there
   *   would strand one bot's exposure. An identity neither side can report is
   *   treated as shared.
   * - A skip still READS the position and reports it: never a silent success.
   * - When the venue reports no position for the symbol the step is a no-op.
   * - The POSITION read is the ground truth: it is re-fetched before every
   *   slice, so an order that failed to confirm but filled late is adopted
   *   by the next read (the engine never blind-fails a submitted flatten),
   *   and the loop terminates on "the venue says flat", not on order status
   *   (a partial-fill-then-cancel IOC reads as CANCELED but moved the book).
   * - When the adapter reports book depth (`getMarketDepth`), each slice is
   *   clipped to the depth inside the current crossing band — a thin book
   *   absorbs a clip instead of cancelling a whale (the 2026-10-14 incident).
   *   Depth is sizing guidance only: absent/failing depth degrades to a
   *   full-size slice, never to a skip.
   * - The crossing band widens only after a slice that made no progress,
   *   capped at the last ladder rung; the last rung always attempts the FULL
   *   remaining size (a clip below the venue minimum would be refused
   *   outright). Every order is reduce-only (N6) — a flatten can never grow
   *   a position, even if the book moves underneath it.
   * - Every exit reports the *verified* venue state: flat ⇒ clean; residual
   *   ⇒ its exact quantity and why the loop stopped. Sizing/precision at
   *   the submission boundary stays the adapter's job (it scales to the
   *   market's decimals and rejects sub-minimum sizes).
   *
   * @returns the problems that left exposure open (empty ⇒ flat or nothing to do).
   */
  private async emergencyClosePosition(runtime: BotRuntime): Promise<string[]> {
    const client = runtime.exchangeClient;
    const symbol = runtime.symbol;

    /** The account's non-zero position on the bot's symbol; undefined = flat. */
    const livePosition = async (): Promise<ExchangePosition | undefined> => {
      const positions = await client.getPositions();
      return positions.find(
        p =>
          symbolsMatch(p.symbol, symbol) &&
          Number.isFinite(Number(p.position_qty)) &&
          Number(p.position_qty) !== 0
      );
    };

    // Co-tenant guard. Positions on these venues belong to the ACCOUNT, not
    // the bot, so a bot that shares its account with a sibling trading the
    // same symbol must not close the sibling's exposure.
    //
    // Keyed on ACCOUNT identity + symbol — never symbol alone. Two accounts
    // trading the same symbol hold INDEPENDENT positions, and skipping there
    // left one bot's exposure open while reporting a clean stop (a silent
    // success, which is exactly what this method's contract forbids).
    //
    // An identity either side cannot report is treated as SHARED: unproven
    // distinct is not distinct, and the failure mode of guessing wrong is
    // closing someone else's position.
    const myIdentity = accountIdentityOf(runtime);
    let sharedWith: string | null = null;
    for (const [otherId, other] of this.bots) {
      if (otherId === runtime.botId || other.symbol !== runtime.symbol)
        continue;
      const otherIdentity = accountIdentityOf(other);
      const sharesPosition =
        myIdentity === undefined ||
        otherIdentity === undefined ||
        myIdentity === otherIdentity;
      if (sharesPosition) {
        sharedWith = otherId;
        break;
      }
    }

    if (sharedWith !== null) {
      logger.warn(
        "Emergency stop: position flatten skipped - a sibling bot shares this account and symbol",
        { botId: runtime.botId, otherBotId: sharedWith, symbol }
      );
      // A skip is never a silent success: the venue's own position read
      // decides what is reported. The position is left to the sibling's stop,
      // but the operator is told exactly how much is still open and who owns
      // closing it.
      let position: ExchangePosition | undefined;
      try {
        position = await livePosition();
      } catch (error) {
        return [
          `position on ${symbol} not verified after emergency stop (flatten skipped: sibling bot ${sharedWith} trades this symbol): ${messageOf(error)}`,
        ];
      }
      if (!position) return [];
      const sharedQty = Math.abs(Number(position.position_qty));
      return [
        `position ${sharedQty} ${symbol} still open after emergency stop: flatten skipped because bot ${sharedWith} shares this account and symbol (that bot's stop owns the position)`,
      ];
    }

    const startedAt = Date.now();
    /** Last VERIFIED position magnitude — the loop's progress baseline. */
    let previousQty: number | null = null;
    let noProgress = 0;
    let lastSliceError: string | null = null;
    let stopReason = `slice budget exhausted (${FLATTEN_MAX_SLICES} slices)`;

    for (let slice = 1; slice <= FLATTEN_MAX_SLICES; slice++) {
      if (Date.now() - startedAt >= FLATTEN_TIME_BUDGET_MS) {
        stopReason = `time budget exhausted (${FLATTEN_TIME_BUDGET_MS} ms)`;
        break;
      }
      let position: ExchangePosition | undefined;
      try {
        position = await livePosition();
      } catch (error) {
        const detail = messageOf(error);
        logger.error("Emergency stop: position fetch failed", {
          botId: runtime.botId,
          symbol,
          slice,
          error: detail,
        });
        // A re-read failure AFTER slices were sent must not pretend the
        // exposure story starts from scratch — carry what was last verified.
        return previousQty === null
          ? [`position fetch failed (exposure unknown): ${detail}`]
          : [
              `position re-read failed after flatten slices (last seen ${previousQty} ${symbol}): ${detail}`,
            ];
      }
      const liveQty = position ? Number(position.position_qty) : 0;
      if (liveQty === 0) {
        // The venue says flat — verified, whether the last slice confirmed
        // outright or filled late after an UNRESOLVED submit.
        logger.info(
          previousQty === null
            ? "Emergency stop: no open position to close"
            : "Emergency stop: flatten verified flat on the venue",
          { botId: runtime.botId, symbol }
        );
        return [];
      }
      const qty = Math.abs(liveQty);
      if (previousQty !== null) {
        if (qty < previousQty) noProgress = 0;
        else noProgress += 1;
      }
      previousQty = qty;
      if (noProgress >= FLATTEN_MAX_NO_PROGRESS) {
        stopReason = `venue stopped absorbing slices (no position reduction across ${FLATTEN_MAX_NO_PROGRESS} reads; thin book)`;
        break;
      }

      const side: "BUY" | "SELL" = liveQty > 0 ? "SELL" : "BUY";
      const bandBps =
        FLATTEN_BAND_RUNGS_BPS[
          Math.min(noProgress, FLATTEN_BAND_RUNGS_BPS.length - 1)
        ];
      const isLastRung =
        bandBps === FLATTEN_BAND_RUNGS_BPS[FLATTEN_BAND_RUNGS_BPS.length - 1];

      // Size the slice to the book when the adapter can report it. An order
      // larger than the resting depth does not fill more — it fills the book
      // and CANCELS the remainder (the incident) — so match the depth when
      // it binds. An empty band keeps the full size: widening the band on
      // the next no-progress read is the escalation, and the last rung
      // always tries the full remaining size.
      let sliceQty = qty;
      if (!isLastRung && typeof client.getMarketDepth === "function") {
        try {
          const depth = await client.getMarketDepth(symbol);
          const mark = Number(position?.mark_price);
          if (Number.isFinite(mark) && mark > 0) {
            const band = bandBps / 10_000;
            const edge =
              side === "SELL" ? mark * (1 - band) : mark * (1 + band);
            const book = side === "SELL" ? depth.bids : depth.asks;
            let fillable = 0;
            for (const level of book) {
              const inBand =
                side === "SELL" ? level.price >= edge : level.price <= edge;
              if (
                inBand &&
                Number.isFinite(level.quantity) &&
                level.quantity > 0
              ) {
                fillable += level.quantity;
              }
            }
            if (fillable > 0 && fillable < sliceQty) {
              sliceQty = fillable;
            }
          }
        } catch (error) {
          logger.warn("Emergency stop: depth unavailable, sizing full slice", {
            botId: runtime.botId,
            symbol,
            error: messageOf(error),
          });
        }
      }

      try {
        const order = await client.createOrder({
          symbol,
          side,
          orderType: "MARKET",
          orderQuantity: sliceQty,
          // Shrink-only: a flatten can never open or grow a position (N6,
          // honored by both adapters through the venue's reduce_only).
          reduceOnly: true,
          // Ladder-bounded band — never an unbounded willingness to cross.
          maxSlippageBps: bandBps,
        });
        logger.warn("Emergency stop: flatten slice submitted", {
          botId: runtime.botId,
          symbol,
          side,
          slice,
          sliceQty,
          remainingAtRead: qty,
          bandBps,
          orderId: order.orderId,
          status: order.status,
        });
      } catch (error) {
        // Not fatal: the next position read decides — a submitted-but-
        // unconfirmed slice that filled is adopted by the position delta.
        lastSliceError = messageOf(error);
        logger.error("Emergency stop: flatten slice failed", {
          botId: runtime.botId,
          symbol,
          slice,
          sliceQty,
          bandBps,
          error: lastSliceError,
        });
      }
      // Loop back: the next read IS this slice's verification.
    }

    // Final verification — report the venue's actual state, never a guess.
    let residual: number;
    try {
      const position = await livePosition();
      residual = position ? Math.abs(Number(position.position_qty)) : 0;
    } catch (error) {
      return [
        `position ${
          previousQty ?? "unknown"
        } ${symbol} not verified after flatten: ${messageOf(error)}`,
      ];
    }
    if (residual === 0) {
      logger.warn(
        "Emergency stop: flatten verified flat after the last slice",
        { botId: runtime.botId, symbol }
      );
      return [];
    }
    return [
      `position ${residual} ${symbol} not flattened (still open after flatten: ${stopReason}${
        lastSliceError ? `; last slice error: ${lastSliceError}` : ""
      })`,
    ];
  }

  /**
   * Prepare a session: ONE credential fetch + ONE exchange client, then one
   * grid initialization per run. NO orders are placed and NO tick runner is
   * armed — execution only begins after BOT_AUTHORIZE.
   *
   * The returned figures are a REPORT, not a decision: the engine knows the
   * resolved grid geometry and the live venue price, so it can price the
   * worst-case resting exposure. The backend validates that report (provenance,
   * freshness, config consistency) and is the authority that admits the run.
   */
  private async doPrepareSession(
    streamOps: RedisStreamOperations,
    botId: string,
    userId: string,
    strategyId: string,
    config: Record<string, unknown>,
    correlationId: string,
    runSpecs: Array<{
      runId?: string;
      strategyId: string;
      configVersion: number;
      config: Record<string, unknown>;
      notionalAmount: number;
    }>,
    /** False only for legacy payloads (no runs[]) → no declared notional. */
    hasDeclaredNotional: boolean
  ): Promise<PreparedRun[]> {
    const preparedRuns: PreparedRun[] = [];

    try {
      await this.publishStateChanged(
        streamOps,
        botId,
        "STOPPED",
        "STARTING",
        correlationId
      );
      this.throwIfCancelled(botId);

      // 1. Fetch credentials (once per session, not per strategy).
      const credentials = await fetchCredentials(botId, correlationId);
      this.throwIfCancelled(botId);

      // 2. Connect exchange client (once per session).
      if (!isEngineCredentials(credentials)) {
        throw new CommandError(
          false,
          "Malformed credential envelope (expected EngineCredentials)"
        );
      }
      const exchangeClient = createExchangeClient(credentials);
      this.throwIfCancelled(botId);

      // 3. Residual-capacity backstop (defense in depth, Model A spirit):
      // refuse to prepare ANY run when the venue account has no residual room
      // left for this session. Fail-closed by design.
      await this.assertResidualCapacity(
        botId,
        exchangeClient,
        runSpecs,
        hasDeclaredNotional
      );
      this.throwIfCancelled(botId);

      // 4. One strategy per run, sharing the session client. The grid is
      //    built but NOT started — no orders placed, no tick runner armed.
      const tradeReporter = new LedgerTradeReporter(
        streamOps,
        this.engineId,
        this.epoch
      );
      // F1: fills journaled during a Redis outage must be re-delivered before
      // this session trades on.
      const replay = await tradeReporter.replayPendingFills();
      if (replay.unknown) {
        throw new CommandError(
          true,
          "Refusing to start: fill-journal integrity unknown (quarantine retained); reconcile from venue history before trading resumes"
        );
      }
      if (replay.remaining > 0) {
        throw new CommandError(
          true,
          `Refusing to start: ${replay.remaining} fill(s) still pending ledger delivery (replayed ${replay.replayed}); retry after Redis recovers`
        );
      }

      // Bump the preparation version so a stale BOT_AUTHORIZE cannot execute
      // a superseded preparation.
      const preparationVersion = (this.preparationVersions.get(botId) ?? 0) + 1;
      this.preparationVersions.set(botId, preparationVersion);

      for (const spec of runSpecs) {
        const runConfig = spec.config ?? config;
        // Phase 4: one boundary resolver — missing numerics keep historical
        // defaults, but any explicitly invalid field refuses the start.
        const gridConfig = resolveGridConfig(
          runConfig as Record<string, unknown>
        );
        const symbol = gridConfig.symbol;
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

        const gridStrategy = new GridTradingStrategy(
          botId,
          gridConfig,
          exchangeClient,
          tradeReporter,
          spec.runId
        );
        // Co-tenancy: the venue position is account × symbol, not bot-scoped.
        const symbolShared = Array.from(this.bots.values()).some(
          other => other.botId !== botId && other.symbol === symbol
        );
        gridStrategy.setSymbolShared?.(symbolShared);
        await gridStrategy.initialize(currentPrice);
        this.throwIfCancelled(botId);

        const runKey = spec.runId ?? strategyId;
        preparedRuns.push({
          runId: runKey,
          preparationVersion,
          strategy: gridStrategy,
          exchangeClient,
          tradeReporter,
          symbol,
          gridSize: gridConfig.gridSize,
          orderQuantity: gridConfig.orderQuantity,
          priceUsed: currentPrice,
          // Report-only figures — the backend enforces.
          estimatedRestingNotional: gridStrategy.estimatedRestingNotional,
          perOrderNotional: gridConfig.orderQuantity * currentPrice,
        });
      }

      if (preparedRuns.length === 0) {
        throw new CommandError(false, "Session has no runs to start");
      }

      // Remember the primary preparation so BOT_AUTHORIZE can find it.
      this.prepared.set(
        botId,
        new Map(preparedRuns.map(prepared => [prepared.runId, prepared]))
      );

      // STARTING → PREPARED. Execution is NOT authorized yet.
      await this.publishStateChanged(
        streamOps,
        botId,
        "STARTING",
        "PREPARED",
        correlationId,
        `prepared (${preparedRuns.length} run${preparedRuns.length === 1 ? "" : "s"})`
      );

      // Report the estimate to the backend for admission validation.
      for (const pr of preparedRuns) {
        const payload: BotEventPayload = {
          botId,
          engineId: this.engineId,
          engineEpoch: this.epoch,
          runId: pr.runId,
          preparationVersion: pr.preparationVersion,
          symbol: pr.symbol,
          gridSize: pr.gridSize,
          orderQuantity: pr.orderQuantity,
          priceUsed: pr.priceUsed,
          estimatedRestingNotional: pr.estimatedRestingNotional,
          perOrderNotional: pr.perOrderNotional,
        };
        await publishEvent(
          streamOps,
          "ESTIMATE_READY",
          payload as EstimateReadyEventPayload,
          correlationId
        );
      }

      return preparedRuns;
    } catch (error) {
      this.bots.delete(botId);
      this.prepared.delete(botId);
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
      const reported = new CommandError(false, err.message);
      reported.stack = err.stack ?? reported.stack;
      throw reported;
    }
  }

  /**
   * Authorize a prepared run to begin execution (BOT_AUTHORIZE).
   *
   * Fails closed unless a preparation exists that matches BOTH the runId and
   * the preparationVersion — so an authorization can never execute a
   * different strategy configuration than the one that was admitted, and a
   * stale authorization can never execute a newer preparation.
   */
  async authorizeStart(
    streamOps: RedisStreamOperations,
    botId: string,
    userId: string,
    strategyId: string,
    runId: string,
    preparationVersion: number,
    correlationId: string
  ): Promise<void> {
    const preparedRuns = this.prepared.get(botId);
    const prepared = preparedRuns?.get(runId);
    if (!prepared) {
      logger.warn("BOT_AUTHORIZE with no matching prepared run", { botId, runId });
      await this.publishFailed(
        streamOps,
        botId,
        "BOT_AUTHORIZE",
        "NOT_PREPARED",
        `No prepared run ${runId} for bot ${botId}`,
        correlationId
      );
      return;
    }

    if (prepared.preparationVersion !== preparationVersion) {
      logger.warn("BOT_AUTHORIZE does not match the prepared run", {
        botId,
        requestedRunId: runId,
        preparedRunId: prepared.runId,
        requestedVersion: preparationVersion,
        preparedVersion: prepared.preparationVersion,
      });
      await this.publishFailed(
        streamOps,
        botId,
        "BOT_AUTHORIZE",
        "STALE_PREPARATION",
        "Authorization does not match the current preparation",
        correlationId
      );
      return;
    }

    // Consume only this run's preparation. Other runs in the same session
    // remain independently authorizable.
    preparedRuns!.delete(runId);
    if (preparedRuns!.size === 0) this.prepared.delete(botId);

    const existingRuntime = this.bots.get(botId);
    const startedRunners: StrategyRunner[] = [];
    try {
      await prepared.strategy.start();

      const runner = new StrategyRunner(
        prepared.runId,
        TICK_INTERVAL_MS,
        () => prepared.strategy.tick(),
        {
          onError: error =>
            logger.error("Strategy tick error", {
              botId,
              runId: prepared.runId,
              ledgerHalted: prepared.strategy.isLedgerHalted(),
              ledgerHaltReason: prepared.strategy.ledgerHaltReasonText(),
              error: error instanceof Error ? error.message : String(error),
            }),
          onSkip: () =>
            logger.warn("Previous tick still running, skipping", {
              botId,
              runId: prepared.runId,
            }),
        }
      );
      runner.start();
      startedRunners.push(runner);

      const stopRunner = (): void => runner.stop();
      const runState: StrategyRunState = {
        runId: prepared.runId,
        strategyId,
        strategy: prepared.strategy,
        stopTick: stopRunner,
      };

      if (existingRuntime) {
        existingRuntime.runs ??= new Map([
          [
            existingRuntime.runs?.values().next().value?.runId ??
              existingRuntime.strategyId,
            {
              runId:
                existingRuntime.runs?.values().next().value?.runId ??
                existingRuntime.strategyId,
              strategyId: existingRuntime.strategyId,
              strategy: existingRuntime.strategy,
              stopTick: existingRuntime.stopTick,
            },
          ],
        ]);
        existingRuntime.runs.set(prepared.runId, runState);
      } else {
        const runs = new Map<string, StrategyRunState>();
        runs.set(prepared.runId, runState);
        this.bots.set(botId, {
          botId,
          strategyId,
          userId,
          symbol: prepared.symbol,
          state: "RUNNING",
          strategy: prepared.strategy,
          stopTick: stopRunner,
          exchangeClient: prepared.exchangeClient,
          runs,
        });

        // Only the first authorized run changes the session state. Further
        // authorizations add runners to the already-running session.
        await this.publishStateChanged(
          streamOps,
          botId,
          "PREPARED",
          "RUNNING",
          correlationId,
          "authorized and started (session run)"
        );
      }
    } catch (error) {
      for (const runner of startedRunners) runner.stop();

      // Any run failing after another run has started invalidates the session:
      // stop every already-active runner and strategy before reporting ERROR.
      const activeRuntime = this.bots.get(botId);
      if (activeRuntime) {
        const activeRuns = activeRuntime.runs?.values() ?? [];
        for (const activeRun of activeRuns) {
          activeRun.stopTick();
          try {
            await activeRun.strategy.stop();
          } catch (stopError) {
            logger.error("Failed to stop a run after authorization failure", stopError as Error, {
              botId,
              runId: activeRun.runId,
            });
          }
        }
      }
      this.bots.delete(botId);
      this.prepared.delete(botId);
      const err = error instanceof Error ? error : new Error(String(error));
      await this.publishFailed(
        streamOps,
        botId,
        "BOT_AUTHORIZE",
        "EXECUTION_FAILED",
        err.message,
        correlationId
      );
      await this.publishStateChanged(
        streamOps,
        botId,
        "PREPARED",
        "ERROR",
        correlationId,
        err.message
      );
      throw err;
    }
  }

  /**
   * One fail-closed Model A re-check per session start: live venue exposure
   * plus the session's declared notionals must fit `total_value ×
   * SESSION_CAP_LEVERAGE`. Uses only the session's own `ExchangeClient`
   * (`getAccountInfo`/`getPositions` — both already on the interface, so no
   * venue API additions). Throws on every failure mode so the
   * {@link doStartSession} catch converts it into the existing INIT_FAILED
   * control-plane path (COMMAND_FAILED + STARTING→ERROR, non-retryable) with
   * zero runners started. Not a per-order gate — the grid sizes from base-unit
   * `orderQuantity`, a different unit than USD `notionalAmount`.
   */
  private async assertResidualCapacity(
    botId: string,
    exchangeClient: ExchangeClient,
    runSpecs: ReadonlyArray<{ runId?: string; notionalAmount: number }>,
    hasDeclaredNotional: boolean
  ): Promise<void> {
    // Resolve pure inputs first so an invalid SESSION_CAP_LEVERAGE or a
    // malformed notional refuses before any venue round-trip.
    const leverage = sessionCapLeverage();
    // Legacy payloads (no runs[]) declare no notional — treat as "no
    // declared intent" (requested 0). The exposure half still applies, so an
    // account already over cap refuses to start anything.
    const requested = hasDeclaredNotional
      ? sessionRequestedNotional(runSpecs)
      : 0;

    if (
      typeof exchangeClient.getAccountInfo !== "function" ||
      typeof exchangeClient.getPositions !== "function"
    ) {
      throw new Error(
        "Exchange client does not expose getAccountInfo/getPositions; cannot verify engine residual capacity (fail-closed)"
      );
    }
    const [accountInfo, positions] = await Promise.all([
      exchangeClient.getAccountInfo(),
      exchangeClient.getPositions(),
    ]);
    if (!Array.isArray(positions)) {
      throw new Error(
        `Positions payload is not an array (${typeof positions}); cannot compute engine exposure (fail-closed)`
      );
    }
    const exposure = sumPositionExposure(
      positions.map(p => ({
        qty: p.position_qty,
        mark: p.mark_price,
        symbol: p.symbol,
      }))
    );
    const totalValue = Number(
      accountInfo === null || accountInfo === undefined
        ? Number.NaN
        : (accountInfo as { total_value?: unknown }).total_value
    );
    try {
      assertEngineResidualCapacity({
        exposure,
        requested,
        totalValue,
        leverage,
      });
    } catch (error) {
      logger.warn("Engine residual-capacity backstop refused the start", {
        botId,
        exposure,
        requested,
        totalValue,
        leverage,
        error: messageOf(error),
      });
      throw error;
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
