/**
 * Trade Reporter - ledger event emission for the trading path (Phase 4).
 *
 * The grid strategy and the order reconciliation service must not know about
 * Redis streams: they receive this interface (optional, for testability) and
 * report what happened. `LedgerTradeReporter` closes over the engine identity
 * (engineId + epoch, required by the backend's fail-closed authority check)
 * and the stream, and stamps every payload with it.
 *
 * Failure policy (deliberately asymmetric):
 * - `reportOrderIntent` resolves `false` when the event could not be
 *   published — the caller must NOT place the order (intent-before-create:
 *   no durable intent, no submission; a Redis outage means the engine is
 *   deaf, and not placing is the fail-closed answer, mirroring D1).
 * - `reportFill` REJECTS when no durable copy could be journaled (F1,
 *   fail-closed): without a journal entry a subsequent publish failure
 *   would leave the fill with no replay path, so the caller must treat
 *   the fill as undelivered (the grid logs loudly and keeps telemetry
 *   moving, but the ledger gap is explicit). A journaled-but-unpublished
 *   fill resolves normally — the entry stays for replay.
 * - `reportPosition` / `reportPerformance` never reject: they are latest-wins
 *   telemetry superseded by the next report, so a publish failure is logged
 *   (payload included) and dropped — never journaled.
 *
 * Session-start gate: `replayPendingFills` returns `{ replayed, remaining }`.
 * A session MUST NOT trade while `remaining > 0` — bot-manager aborts the
 * start (INIT_FAILED, retryable) so a quiet journal can never sit behind a
 * live strategy. A periodic retry loop (lifecycle-coordinator) keeps
 * re-attempting delivery while the engine is otherwise idle.
 *
 * @format
 */

import { randomUUID } from "crypto";
import { RedisStreamOperations } from "../infrastructure/redis/streams";
import {
  publishOrderIntent,
  publishPerformanceSnapshot,
  publishPositionUpdated,
  publishTradeExecuted,
} from "../protocol/event-publisher";
import { synthesizeFillId, FillSegment } from "../utils/fill-id";
import {
  clearPendingFill,
  journalPendingFill,
  readPendingFills,
} from "../infrastructure/state/pending-fill-journal";
import { logger } from "../utils/logger";

export interface OrderIntentReport {
  botId: string;
  /** D3 sessions: the run that placed the order (ledger `run_id`). */
  runId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  clientOrderId: string;
}

export interface FillReport {
  botId: string;
  /** D3 sessions: the run that booked the fill (ledger `run_id`). */
  runId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  /** Executed price of the fill (venue-reported, else the submitted limit). */
  price: number;
  quantity: number;
  /**
   * Fee booked as `notional × rate` (N6a). Omitted when the venue's rate could
   * not be sourced — absence means unknown, never fee-free.
   */
  fee?: number;
  /**
   * Fee-rate provenance (F5): true when `fee` is an upper-bound estimate —
   * the rate is inexact (unmapped tier / unapplied discount) OR the venue
   * does not report the fill's liquidity role and maker ≠ taker (the taker
   * rate then overstates a maker fill). Absent together with `fee`.
   */
  feeIsEstimate?: boolean;
  /**
   * Realised PnL this fill contributed (see `TradeExecutedEventPayload.pnl`).
   * Omitted together with `fee` when the rate is unknown.
   */
  pnl?: number;
  status: "FILLED" | "PARTIALLY_FILLED";
  clientOrderId: string;
  exchangeOrderId: string;
  /** ISO-8601 execution time as observed by the engine. */
  executedAt: string;
  /**
   * Cumulative-qty segment this row books (Phase 4, risk A1): `from` =
   * cumulative already booked for this order, `to` = cumulative after it,
   * `full` = the slot's configured `orderQuantity`. The reporter hashes it
   * into `fillId` so two segments of one order can never collapse onto a
   * single ledger row; `A1`'s whole-order exception keeps pre-Phase-4 ids
   * byte-identical. It is **not** part of the published payload (the event
   * contract carries only the resulting `fillId`).
   */
  segment?: FillSegment;
}

export interface PositionReport {
  botId: string;
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  /** Executed entry price of the open inventory (weighted by level). */
  entryPrice: number;
  markPrice: number;
  /**
   * Realised PnL net of fees — the sum of the fill rows this engine booked, so
   * the backend's `bot_instances.total_pnl` reconciles with the ledger (N6).
   */
  pnl: number;
  /**
   * Mark-to-market PnL of the *open* inventory at `markPrice`, net of fees
   * already booked on the entry legs. Kept separate from `pnl` so a viewer can
   * tell closed profit from profit on paper.
   */
  unrealizedPnl: number;
}

export interface PerformanceReport {
  botId: string;
  totalTrades: number;
  totalPnl: number;
}

export interface TradeReporter {
  /** Resolves false when the intent did not reach the stream (do not place). */
  reportOrderIntent(intent: OrderIntentReport): Promise<boolean>;
  /**
   * Report a fill. Rejects ONLY when no durable journal copy could be
   * written (the fill then has no replay path — fail-closed). A
   * journaled-but-unpublished fill resolves: the journal entry stays for
   * replay and the backend dedups the eventual redelivery.
   */
  reportFill(fill: FillReport): Promise<void>;
  reportPosition(position: PositionReport): Promise<void>;
  reportPerformance(perf: PerformanceReport): Promise<void>;
}

/** Outcome of a pending-fill replay pass. */
export interface PendingFillReplayResult {
  /** Entries the stream accepted (and cleared) on this pass. */
  replayed: number;
  /** Entries still journaled after this pass (0 = fully drained). */
  remaining: number;
  /**
   * Journal integrity could not be verified (files exist but no trustworthy
   * copy recovered). Gates MUST fail closed on this, never treat it as
   * "no pending fills".
   */
  unknown: boolean;
}

/**
 * A fill the engine observed on the venue but could not durably record.
 * The fill already happened — this cannot undo it. It signals the strategy
 * to HALT new order placement: without a journal entry a publish failure
 * leaves no replay path, so further exposure must not accrue behind an
 * unguaranteed accounting record. Cancels/flattening still proceed.
 */
export class UndurableFillError extends Error {
  readonly fillId: string;
  readonly botId: string;
  readonly clientOrderId: string;

  constructor(fillId: string, botId: string, clientOrderId: string) {
    super(
      `Fill ${fillId} could not be journaled; refusing to treat it as delivered`
    );
    this.name = "UndurableFillError";
    this.fillId = fillId;
    this.botId = botId;
    this.clientOrderId = clientOrderId;
  }
}

export class LedgerTradeReporter implements TradeReporter {
  constructor(
    private readonly streamOps: RedisStreamOperations,
    private readonly engineId: string,
    private readonly engineEpoch: number
  ) {}

  async reportOrderIntent(intent: OrderIntentReport): Promise<boolean> {
    // D3: `runId` is identity input only (backend resolves `run_id`) and
    // never travels in the payload, whose contract is fixed by shared.
    const { runId: _runId, ...payload } = intent;
    const result = await publishOrderIntent(
      this.streamOps,
      { ...payload, engineId: this.engineId, engineEpoch: this.engineEpoch },
      randomUUID()
    );
    if (!result.success) {
      logger.error("Order intent not published - not placing (fail-closed)", {
        ...intent,
        error: result.error,
      });
    }
    return result.success;
  }

  async reportFill(fill: FillReport): Promise<void> {
    // The segment is identity input only: it shapes the fill id (A1) and never
    // travels in the payload, whose contract is fixed by `@trade-bot/shared`.
    // D3: `runId` likewise stays engine-side (backend resolves `run_id`).
    const { segment, runId: _runId, ...payload } = fill;
    const fillId = synthesizeFillId(
      fill.botId,
      fill.clientOrderId,
      fill.exchangeOrderId,
      segment
    );

    // F1: the durable copy comes FIRST — journaled before the publish is
    // attempted, cleared only after the stream accepts it. The grid has
    // already booked this fill locally, and restart reconciliation will not
    // re-emit it (the snapshot projection holds the cumulative), so this
    // journal entry is the only replay path if the publish fails.
    const journalWritten = journalPendingFill({
      fillId,
      payload: { ...payload, fillId },
      queuedAt: new Date().toISOString(),
    });
    if (!journalWritten) {
      // No durable copy: fail CLOSED. If the publish below then also fails,
      // the fill would have no replay path at all — the caller must see a
      // rejection so the ledger gap is explicit rather than log-only.
      logger.error(
        "Fill journal write failed - rejecting fill as undelivered (F1 fail-closed)",
        {
          ...fill,
          fillId,
        }
      );
      throw new UndurableFillError(fillId, fill.botId, fill.clientOrderId);
    }

    const result = await publishTradeExecuted(
      this.streamOps,
      {
        ...payload,
        fillId,
        engineId: this.engineId,
        engineEpoch: this.engineEpoch,
      },
      randomUUID()
    );
    if (result.success) {
      clearPendingFill(fillId);
    } else {
      // Journaled, not lost: the entry stays until a replay is acknowledged.
      logger.error(
        "TRADE_EXECUTED not published - fill journaled for replay (F1)",
        {
          ...fill,
          fillId,
          error: result.error,
        }
      );
    }
  }

  /**
   * Re-publish every journaled fill under the CURRENT engine identity and
   * clear each entry the stream accepts (F1). Called at engine startup and
   * bot-session start — a fill journaled during a Redis outage lands as soon
   * as connectivity returns, without waiting for a new fill to trigger it.
   *
   * Restamping the identity is required, not cosmetic: the backend's
   * fail-closed authority check rejects a superseded epoch, and every restart
   * bumps it. The fill identity (fillId …) is untouched, so a replay that
   * actually landed before the crash dedups to a no-op downstream.
   *
   * Never rejects; returns `{ replayed, remaining, unknown }` so the
   * session-start gate can refuse to trade while `remaining > 0` OR
   * `unknown` (unverifiable integrity is never "no pending fills").
   */
  async replayPendingFills(): Promise<PendingFillReplayResult> {
    const read = readPendingFills();
    if (read.status === "UNKNOWN") {
      // Nothing iterable to replay, but the gate must fail closed: report
      // unknown loudly rather than a clean {0, 0}.
      logger.error(
        "Pending-fill journal integrity unknown - refusing to treat as drained",
        { engineId: this.engineId, engineEpoch: this.engineEpoch }
      );
      return { replayed: 0, remaining: 0, unknown: true };
    }
    const pending = read.entries;
    if (pending.length === 0)
      return { replayed: 0, remaining: 0, unknown: false };

    let replayed = 0;
    for (const entry of pending) {
      const result = await publishTradeExecuted(
        this.streamOps,
        {
          ...entry.payload,
          engineId: this.engineId,
          engineEpoch: this.engineEpoch,
        },
        randomUUID()
      );
      if (!result.success) {
        // Stop at the first failure: if Redis is down for one entry it is
        // down for all of them — the journal stays intact for the next call.
        logger.error("Pending fill replay failed - journal kept", {
          fillId: entry.fillId,
          botId: entry.payload.botId,
          error: result.error,
        });
        break;
      }
      clearPendingFill(entry.fillId);
      replayed++;
    }

    const remaining = pending.length - replayed;
    if (replayed > 0) {
      logger.info("Replayed journaled fills to the ledger stream", {
        replayed,
        remaining,
        engineId: this.engineId,
        engineEpoch: this.engineEpoch,
      });
    }
    if (remaining > 0) {
      // Loud by design: a non-zero remainder is the condition the
      // session-start gate refuses to trade behind.
      logger.error(
        "Pending fills remain after replay - session start must wait",
        {
          replayed,
          remaining,
          engineId: this.engineId,
          engineEpoch: this.engineEpoch,
        }
      );
    }
    return { replayed, remaining, unknown: false };
  }

  async reportPosition(position: PositionReport): Promise<void> {
    const result = await publishPositionUpdated(
      this.streamOps,
      { ...position, engineId: this.engineId, engineEpoch: this.engineEpoch },
      randomUUID()
    );
    if (!result.success) {
      logger.warn("POSITION_UPDATED not published", {
        ...position,
        error: result.error,
      });
    }
  }

  async reportPerformance(perf: PerformanceReport): Promise<void> {
    const result = await publishPerformanceSnapshot(
      this.streamOps,
      {
        botId: perf.botId,
        metrics: { totalTrades: perf.totalTrades, totalPnl: perf.totalPnl },
        engineId: this.engineId,
        engineEpoch: this.engineEpoch,
      },
      randomUUID()
    );
    if (!result.success) {
      logger.warn("PERFORMANCE_SNAPSHOT not published", {
        ...perf,
        error: result.error,
      });
    }
  }
}
