/**
 * Trade Ledger Repository Adapter — durable order/fill ledger writes
 * (Phase 4 / N7), implementing the core `ITradeLedgerRepository` port.
 *
 * Moved here from `core/strategies/trade-ledger.repository.ts`
 * (dependency inversion — external review P1, 2026-10-15): every
 * ledger-related SQL statement lives in this infrastructure adapter.
 * Core consumes the port; `index.ts` wires this adapter at startup.
 *
 * @format
 */

import { query, transaction } from "../../../database/pool";
import { tradingLogger as logger } from "../../../core/logging";
import {
  ITradeLedgerRepository,
  LedgerFill,
  LedgerIntent,
  LedgerPerformance,
  LedgerPosition,
  RecordFillResult,
} from "../../../core/strategies/trade-ledger.repository.port";

export class TradeLedgerRepositoryAdapter implements ITradeLedgerRepository {
  /**
   * Idempotently append one fill to the ledger. One transaction:
   * resolve identity → ledger insert (ON CONFLICT DO NOTHING) → display row →
   * intent state → bot totals. DUPLICATE short-circuits after the conflict,
   * so no side effect runs twice.
   */
  async recordFill(fill: LedgerFill): Promise<RecordFillResult> {
    const result = await transaction(async client => {
      // Ownership + attribution (022 shim-drop): `user_id` from the session
      // row, `strategy_id` from its oldest run (NULL when the session has
      // no runs yet). Never from the event payload.
      const bot = await client.query<{
        user_id: string | null;
      }>("SELECT user_id FROM bot_instances WHERE id = $1", [fill.botId]);
      if (bot.rows.length === 0) {
        return "UNKNOWN_BOT" as const;
      }
      const { user_id } = bot.rows[0];
      const run = await client.query<{
        strategy_id: string | null;
      }>(
        `SELECT strategy_id FROM strategy_runs
          WHERE bot_id = $1
          ORDER BY created_at ASC, id ASC
          LIMIT 1`,
        [fill.botId]
      );
      const strategy_id = run.rows[0]?.strategy_id ?? null;

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bot_trade_fills (
           bot_id, user_id, strategy_id, client_order_id, exchange_order_id,
           fill_id, symbol, side, quantity, price, fee, fee_is_estimate,
           pnl, status, executed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
          // F2: unknown ≠ zero — undefined becomes NULL in both the ledger
          // and the display row (their columns are nullable since 023).
          fill.fee ?? null,
          // F5: absent provenance is treated as an estimate (upper bound) —
          // the conservative reading.
          fill.feeIsEstimate ?? true,
          fill.pnl ?? null,
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
          // F2: same NULL semantics as the ledger row above.
          fill.fee ?? null,
          fill.pnl ?? null,
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

      // Totals keyed by bot_id — NEVER strategy_id (N7). F2: an unknown pnl
      // adds nothing to total_pnl but bumps the incompleteness counter, so a
      // reader can tell "no profit" from "profit not fully accounted".
      await client.query(
        `UPDATE bot_instances
            SET total_trades = total_trades + 1,
                total_pnl = total_pnl + COALESCE($2, 0),
                total_pnl_incomplete_fills = total_pnl_incomplete_fills
                  + CASE WHEN $2::numeric IS NULL THEN 1 ELSE 0 END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [fill.botId, fill.pnl ?? null]
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
