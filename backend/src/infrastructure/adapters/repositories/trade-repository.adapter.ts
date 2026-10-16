/**
 * Trade Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements ITradeRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for trade data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
  ITradeRepository,
  Trade,
  OrderStatus,
  OrderSide,
} from "@trade-bot/shared";
import { query } from "../../../database/pool";
import { databaseLogger as logger } from "../../../core/logging/context-aware-logger.service";
import { FilteredTrade } from "../../../core/types/filtered-trade";

/**
 * Re-export (review P1): the DTO moved to core so the trades use case and
 * route can speak the row shape without importing this adapter.
 */
export type { FilteredTrade };

/** Raw joined row from the `trades ⋈ strategies ⋈ bot_instances` query. */
interface FilteredTradeRow {
  id: string;
  strategy_id: string | null;
  strategy_name: string | null;
  bot_id: string | null;
  exchange_account_id: string | null;
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  fee: string | null;
  pnl: string | null;
  status: string;
  executed_at: string;
}

/**
 * Trade Repository Adapter
 *
 * Implements the ITradeRepository interface using PostgreSQL database operations.
 * Provides trade data access with proper error handling and type safety.
 */
export class TradeRepositoryAdapter implements ITradeRepository {
  /**
   * Get trades for a user
   */
  async getTrades(userId: string, limit: number = 50): Promise<Trade[]> {
    try {
      const result = await query<TradeRow>(
        `SELECT
                    id,
                    user_id,
                    strategy_id,
                    order_id,
                    symbol,
                    side,
                    quantity,
                    price,
                    fee,
                    pnl,
                    executed_at
                FROM trades
                WHERE user_id = $1
                ORDER BY executed_at DESC
                LIMIT $2`,
        [userId, limit]
      );

      return result.rows
        .map(row => this.mapRowToTrade(row))
        .filter(Boolean) as Trade[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get trades", error as Error);
      throw new Error(`Failed to get trades: ${errorMessage}`);
    }
  }

  /**
   * Get trades for a specific strategy
   */
  async getTradesByStrategy(
    userId: string,
    strategyId: string,
    limit: number = 50
  ): Promise<Trade[]> {
    try {
      const result = await query<TradeRow>(
        `SELECT
                    id,
                    user_id,
                    strategy_id,
                    order_id,
                    symbol,
                    side,
                    quantity,
                    price,
                    fee,
                    pnl,
                    executed_at
                FROM trades
                WHERE user_id = $1 AND strategy_id = $2
                ORDER BY executed_at DESC
                LIMIT $3`,
        [userId, strategyId, limit]
      );

      return result.rows
        .map(row => this.mapRowToTrade(row))
        .filter(Boolean) as Trade[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get trades by strategy: ${errorMessage}`);
    }
  }

  /**
   * Filtered read for the Dashboard / strategy-card Recent-Trades surfaces
   * (Batch 1 of the multi-account trades plan).
   *
   * Reads the local `trades` display rows — written in the same transaction
   * as the durable ledger — so every row carries its `strategy_id` attribution
   * and resolves to an exchange account through `bot_id → bot_instances`.
   * Joins `strategies` (display name) and `bot_instances` (account) with
   * LEFT JOINs: a row whose session had no runs (NULL strategy) or whose bot
   * was deleted (NULL bot) still shows up in the unfiltered view, labelled
   * honestly as absent, and is simply excluded when the matching filter is on.
   *
   * Ownership is `user_id = $1` — a foreign strategyId/accountId can only
   * ever match the caller's own rows (it narrows, never widens), so no
   * separate ownership pre-check is needed and a foreign id is
   * indistinguishable from "no trades" (no existence leak).
   *
   * NULL fee/pnl (unknown at fill time, F2) are preserved as NULL — never
   * collapsed to a made-up zero, never dropped (the legacy `mapRowToTrade`
   * drops such rows; this DTO keeps them and lets the UI say "unknown").
   */
  async getTradesFiltered(
    userId: string,
    filters: {
      exchangeAccountId?: string;
      strategyId?: string;
      limit?: number;
    } = {}
  ): Promise<FilteredTrade[]> {
    try {
      const conditions: string[] = ["t.user_id = $1"];
      const params: unknown[] = [userId];
      if (filters.strategyId) {
        params.push(filters.strategyId);
        conditions.push(`t.strategy_id = $${params.length}`);
      }
      if (filters.exchangeAccountId) {
        params.push(filters.exchangeAccountId);
        conditions.push(`bi.exchange_account_id = $${params.length}`);
      }
      params.push(filters.limit ?? 50);

      const result = await query<FilteredTradeRow>(
        `SELECT
            t.id,
            t.strategy_id,
            t.bot_id,
            t.order_id,
            t.symbol,
            t.side,
            t.quantity,
            t.price,
            t.fee,
            t.pnl,
            t.status,
            t.executed_at,
            s.name AS strategy_name,
            bi.exchange_account_id
          FROM trades t
          LEFT JOIN strategies s ON s.id = t.strategy_id
          LEFT JOIN bot_instances bi ON bi.id = t.bot_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY t.executed_at DESC
          LIMIT $${params.length}`,
        params
      );

      return result.rows.map(row => ({
        id: row.id,
        strategyId: row.strategy_id ?? null,
        strategyName: row.strategy_name ?? null,
        botId: row.bot_id ?? null,
        exchangeAccountId: row.exchange_account_id ?? null,
        orderId: row.order_id,
        symbol: row.symbol,
        side: row.side,
        quantity: parseFloat(row.quantity),
        price: parseFloat(row.price),
        fee: row.fee === null ? null : parseFloat(row.fee),
        pnl: row.pnl === null ? null : parseFloat(row.pnl),
        status: row.status,
        executedAt: new Date(row.executed_at),
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get filtered trades", error as Error);
      throw new Error(`Failed to get trades: ${errorMessage}`);
    }
  }

  /**
   * Create a new trade record
   */
  async createTrade(trade: Omit<Trade, "id" | "executedAt">): Promise<Trade> {
    try {
      const result = await query<{ id: string; executed_at: string }>(
        `
                INSERT INTO trades (
                    user_id,
                    strategy_id,
                    order_id,
                    symbol,
                    side,
                    quantity,
                    price,
                    fee,
                    pnl,
                    executed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                RETURNING id, executed_at`,
        [
          trade.userId,
          trade.strategyId,
          trade.orderId,
          trade.symbol,
          trade.side,
          trade.quantity,
          trade.price,
          trade.fee,
          trade.pnl,
        ]
      );

      if (result.rows.length === 0) {
        throw new Error("Trade creation failed - no rows returned");
      }

      const row = result.rows[0];
      // Return plain object matching Trade interface
      return {
        id: row.id,
        userId: trade.userId,
        strategyId: trade.strategyId,
        orderId: trade.orderId,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee,
        pnl: trade.pnl,
        status: OrderStatus.FILLED,
        executedAt: new Date(row.executed_at),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create trade: ${errorMessage}`);
    }
  }

  /**
   * Update trade status
   */
  async updateTradeStatus(tradeId: string, status: OrderStatus): Promise<void> {
    try {
      // This would update trade status in the database
      logger.info(`Trade status update for trade ${tradeId}: ${status}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update trade status: ${errorMessage}`);
    }
  }

  /**
   * Map database row to Trade interface object
   */
  private mapRowToTrade(row: TradeRow & { user_id?: string }): Trade | null {
    try {
      // Validate required fields
      if (
        !row.id ||
        !row.order_id ||
        !row.symbol ||
        !row.side ||
        !row.quantity ||
        !row.price ||
        !row.fee ||
        !row.executed_at
      ) {
        logger.warn("Invalid trade row - missing required fields");
        return null;
      }

      // Validate numeric fields
      const quantity = parseFloat(row.quantity);
      const price = parseFloat(row.price);
      const fee = parseFloat(row.fee);
      const pnl = row.pnl ? parseFloat(row.pnl) : undefined;

      if (
        isNaN(quantity) ||
        isNaN(price) ||
        isNaN(fee) ||
        (pnl !== undefined && isNaN(pnl))
      ) {
        logger.warn(
          "Invalid trade row - numeric fields contain non-numeric values"
        );
        return null;
      }

      // Validate side is valid
      if (!["BUY", "SELL"].includes(row.side)) {
        logger.warn(`Invalid trade side: ${row.side}`);
        return null;
      }

      // Validate positive values
      if (quantity <= 0 || price <= 0 || fee < 0) {
        logger.warn("Invalid trade row - negative or zero values");
        return null;
      }

      // Return plain object matching Trade interface
      return {
        id: row.id,
        userId: row.user_id || "unknown",
        strategyId: row.strategy_id,
        orderId: row.order_id,
        symbol: row.symbol,
        side: row.side,
        quantity,
        price,
        fee,
        pnl,
        status: OrderStatus.FILLED,
        executedAt: new Date(row.executed_at),
      };
    } catch (error) {
      logger.error(
        `Failed to map trade row to domain object: ${error}`,
        error as Error
      );
      return null;
    }
  }
}

/**
 * Database row interface for trade data
 */
interface TradeRow {
  id: string;
  strategy_id?: string;
  order_id: string;
  symbol: string;
  side: OrderSide;
  quantity: string;
  price: string;
  fee: string;
  pnl?: string;
  executed_at: string;
}
// Export singleton instance
export const tradeRepositoryAdapter = new TradeRepositoryAdapter();
