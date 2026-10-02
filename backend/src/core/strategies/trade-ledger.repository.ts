/**
 * Trade Ledger Repository - durable order/fill ledger writes (Phase 4 / N7)
 *
 * The write side of the durable financial state: `bot_trade_fills` (the
 * idempotent fill ledger), `bot_order_intents` (intent-before-create),
 * `bot_positions` and `bot_performance_snapshots` (engine-reported
 * projections). All reads for display keep going through the existing
 * `TradeRepositoryAdapter` / portfolio paths — this class is ingest-only.
 *
 * Invariants owned here:
 * - `recordFill` is idempotent on
 *   `(bot_id, client_order_id, exchange_order_id, fill_id)`: a redelivered or
 *   replayed event returns DUPLICATE and changes nothing.
 * - `bot_instances.total_trades` / `total_pnl` are incremented by `bot_id`
 *   ONLY in the same transaction as an actual ledger insert, so the totals
 *   always reconcile with `SUM(bot_trade_fills.pnl)` (Phase 4 exit criterion).
 * - The `trades` display row is written in the same transaction, so there is
 *   never a display row without a ledger row (or a double display row from a
 *   replay).
 * - Ownership (`user_id`, `strategy_id`) is resolved from `bot_instances`
 *   inside the transaction — never from the event payload.
 *
 * Persistence failures throw so the event stays unacked and is redelivered;
 * the DB unique key makes that redelivery safe.
 *
 * @format
 */

import { query, transaction } from "../../database/pool";
import { tradingLogger as logger } from "../logging/context-aware-logger.service";

/** Narrowed fill status as stored by both the ledger and `trades`. */
export type LedgerStatus = "FILLED" | "PARTIAL";

export interface LedgerFill {
  botId: string;
  clientOrderId: string;
  exchangeOrderId: string;
  fillId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number;
  pnl: number;
  status: LedgerStatus;
  /** ISO-8601 execution time as observed by the engine. */
  executedAt: string;
}

export interface LedgerIntent {
  botId: string;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
}

export interface LedgerPosition {
  botId: string;
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  /** Realised PnL net of fees (sums to `bot_trade_fills.pnl`, N6). */
  pnl: number;
  /** Mark-to-market PnL of the open inventory; 0 when the engine omits it. */
  unrealizedPnl?: number;
}

export interface LedgerPerformance {
  botId: string;
  totalTrades: number;
  totalPnl: number;
  winRate?: number;
  maxDrawdown?: number;
  profitFactor?: number;
  sharpeRatio?: number;
}

export type RecordFillResult = "INSERTED" | "DUPLICATE" | "UNKNOWN_BOT";

export class TradeLedgerRepository {
  /**
   * Idempotently append one fill to the ledger. One transaction:
   * resolve identity → ledger insert (ON CONFLICT DO NOTHING) → display row →
   * intent state → bot totals. DUPLICATE short-circuits after the conflict,
   * so no side effect runs twice.
   */
  async recordFill(fill: LedgerFill): Promise<RecordFillResult> {
    const result = await transaction(async client => {
      const bot = await client.query<{
        user_id: string | null;
        strategy_id: string | null;
      }>("SELECT user_id, strategy_id FROM bot_instances WHERE id = $1", [
        fill.botId,
      ]);
      if (bot.rows.length === 0) {
        return "UNKNOWN_BOT" as const;
      }
      const { user_id, strategy_id } = bot.rows[0];

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bot_trade_fills (
           bot_id, user_id, strategy_id, client_order_id, exchange_order_id,
           fill_id, symbol, side, quantity, price, fee, pnl, status, executed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (bot_id, client_order_id, exchange_order_id, fill_id)
           DO NOTHING
         RETURNING id`,
        [
          fill.botId,
          user_id,
          strategy_id,
          fill.clientOrderId,
          fill.exchangeOrderId,
          fill.fillId,
          fill.symbol,
          fill.side,
          fill.quantity,
          fill.price,
          fill.fee,
          fill.pnl,
          fill.status,
          fill.executedAt,
        ]
      );
      if ((inserted.rowCount ?? 0) === 0) {
        return "DUPLICATE" as const;
      }

      // Display projection (legacy `trades` row) — only alongside a fresh
      // ledger row, so a replay can never double it. `order_id` carries the
      // exchange handle the venue would show.
      await client.query(
        `INSERT INTO trades (
           user_id, strategy_id, bot_id, order_id, symbol, side,
           quantity, price, fee, pnl, status, executed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          user_id,
          strategy_id,
          fill.botId,
          fill.exchangeOrderId,
          fill.symbol,
          fill.side,
          fill.quantity,
          fill.price,
          fill.fee,
          fill.pnl,
          fill.status,
          fill.executedAt,
        ]
      );

      // Advisory: close the intent this fill settles. No-op when no intent
      // row exists (e.g. adoption of a pre-Phase-4 order).
      await client.query(
        `UPDATE bot_order_intents
            SET state = 'FILLED', last_seen_at = CURRENT_TIMESTAMP
          WHERE bot_id = $1 AND client_order_id = $2`,
        [fill.botId, fill.clientOrderId]
      );

      // Totals keyed by bot_id — NEVER strategy_id (N7).
      await client.query(
        `UPDATE bot_instances
            SET total_trades = total_trades + 1,
                total_pnl = total_pnl + $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [fill.botId, fill.pnl]
      );

      return "INSERTED" as const;
    });

    logger.debug("Ledger fill recorded", {
      botId: fill.botId,
      clientOrderId: fill.clientOrderId,
      fillId: fill.fillId,
      result,
    });
    return result;
  }

  /**
   * Upsert order intent (written BEFORE `createOrder`). Returns false when the
   * bot is unknown (the `SELECT ... FROM bot_instances WHERE id` picked no
   * row, so nothing was inserted). Slots reuse deterministic client-order ids
   * across cycles, so an existing row's price/quantity refresh and `state`
   * only rolls back to INTENDED when it was not already FILLED (see migration
   * 016 header).
   */
  async upsertIntent(intent: LedgerIntent): Promise<boolean> {
    const result = await query(
      `INSERT INTO bot_order_intents (
         bot_id, client_order_id, symbol, side, price, quantity
       )
       SELECT bi.id, $2, $3, $4, $5, $6
       FROM bot_instances bi WHERE bi.id = $1
       ON CONFLICT (bot_id, client_order_id) DO UPDATE SET
         symbol = EXCLUDED.symbol,
         side = EXCLUDED.side,
         price = EXCLUDED.price,
         quantity = EXCLUDED.quantity,
         state = CASE
           WHEN bot_order_intents.state = 'FILLED' THEN 'FILLED'
           ELSE 'INTENDED'
         END,
         last_seen_at = CURRENT_TIMESTAMP`,
      [
        intent.botId,
        intent.clientOrderId,
        intent.symbol,
        intent.side,
        intent.price,
        intent.quantity,
      ]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Upsert the engine-reported position for (bot_id, symbol). */
  async upsertPosition(position: LedgerPosition): Promise<boolean> {
    const result = await query(
      `INSERT INTO bot_positions (
         bot_id, symbol, side, quantity, entry_price, mark_price, pnl,
         unrealized_pnl
       )
       SELECT bi.id, $2, $3, $4, $5, $6, $7, $8
       FROM bot_instances bi WHERE bi.id = $1
       ON CONFLICT (bot_id, symbol) DO UPDATE SET
         side = EXCLUDED.side,
         quantity = EXCLUDED.quantity,
         entry_price = EXCLUDED.entry_price,
         mark_price = EXCLUDED.mark_price,
         pnl = EXCLUDED.pnl,
         unrealized_pnl = EXCLUDED.unrealized_pnl,
         updated_at = CURRENT_TIMESTAMP`,
      [
        position.botId,
        position.symbol,
        position.side,
        position.quantity,
        position.entryPrice,
        position.markPrice,
        position.pnl,
        position.unrealizedPnl ?? 0,
      ]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Upsert the latest engine-reported performance counters (telemetry). */
  async upsertPerformance(perf: LedgerPerformance): Promise<boolean> {
    const result = await query(
      `INSERT INTO bot_performance_snapshots (
         bot_id, total_trades, total_pnl,
         win_rate, max_drawdown, profit_factor, sharpe_ratio, captured_at
       )
       SELECT bi.id, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
       FROM bot_instances bi WHERE bi.id = $1
       ON CONFLICT (bot_id) DO UPDATE SET
         total_trades = EXCLUDED.total_trades,
         total_pnl = EXCLUDED.total_pnl,
         win_rate = EXCLUDED.win_rate,
         max_drawdown = EXCLUDED.max_drawdown,
         profit_factor = EXCLUDED.profit_factor,
         sharpe_ratio = EXCLUDED.sharpe_ratio,
         captured_at = CURRENT_TIMESTAMP`,
      [
        perf.botId,
        perf.totalTrades,
        perf.totalPnl,
        perf.winRate ?? null,
        perf.maxDrawdown ?? null,
        perf.profitFactor ?? null,
        perf.sharpeRatio ?? null,
      ]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
