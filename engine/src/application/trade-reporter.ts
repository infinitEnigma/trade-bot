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
 * - `reportFill` never rejects, and it is durable (F1): every fill is
 *   journaled to the on-disk pending-fill outbox BEFORE the publish is
 *   attempted and cleared only after the stream accepts it. A failed
 *   publish leaves the journal entry; `replayPendingFills` (bot-session
 *   start + engine startup) re-publishes it under the live engine identity,
 *   and the backend's unique fill key keeps the replay idempotent.
 * - `reportPosition` / `reportPerformance` never reject: they are latest-wins
 *   telemetry superseded by the next report, so a publish failure is logged
 *   (payload included) and dropped — never journaled.
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
  listPendingFills,
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
  reportFill(fill: FillReport): Promise<void>;
  reportPosition(position: PositionReport): Promise<void>;
  reportPerformance(perf: PerformanceReport): Promise<void>;
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
      // No durable copy: the loud log below is again the only trace. Disk
      // failure must not swallow a fill silently, so say so explicitly.
      logger.error(
        "Fill journal write failed - fill is undurable until replay",
        {
          ...fill,
          fillId,
        }
      );
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
   * Never rejects; returns the number of fills the stream accepted.
   */
  async replayPendingFills(): Promise<number> {
    const pending = listPendingFills();
    if (pending.length === 0) return 0;

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

    if (replayed > 0) {
      logger.info("Replayed journaled fills to the ledger stream", {
        replayed,
        remaining: pending.length - replayed,
        engineId: this.engineId,
        engineEpoch: this.engineEpoch,
      });
    }
    return replayed;
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
