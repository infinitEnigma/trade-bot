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
 * - `reportFill` / `reportPosition` / `reportPerformance` never reject:
 *   publish failures are logged with the full payload so the row can be
 *   replayed; the at-least-once stream + backend idempotency handle the rest.
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
import { synthesizeFillId } from "../utils/fill-id";
import { logger } from "../utils/logger";

export interface OrderIntentReport {
  botId: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  clientOrderId: string;
}

export interface FillReport {
  botId: string;
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
   * Realised PnL this fill contributed (see `TradeExecutedEventPayload.pnl`).
   * Omitted together with `fee` when the rate is unknown.
   */
  pnl?: number;
  status: "FILLED" | "PARTIALLY_FILLED";
  clientOrderId: string;
  exchangeOrderId: string;
  /** ISO-8601 execution time as observed by the engine. */
  executedAt: string;
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
    const result = await publishOrderIntent(
      this.streamOps,
      { ...intent, engineId: this.engineId, engineEpoch: this.engineEpoch },
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
    const fillId = synthesizeFillId(
      fill.botId,
      fill.clientOrderId,
      fill.exchangeOrderId
    );
    const result = await publishTradeExecuted(
      this.streamOps,
      {
        ...fill,
        fillId,
        engineId: this.engineId,
        engineEpoch: this.engineEpoch,
      },
      randomUUID()
    );
    if (!result.success) {
      // Loud, with the full payload: this is the only copy of the fill until
      // a replay; the backend ledger is the authority once it arrives.
      logger.error("TRADE_EXECUTED not published - ledger row missing", {
        ...fill,
        fillId,
        error: result.error,
      });
    }
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
