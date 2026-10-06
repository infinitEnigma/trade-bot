/**
 * Position Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IPositionRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for position data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { IPositionRepository, Position } from "@trade-bot/shared";
import { query } from "../../../database/pool";
import { databaseLogger as logger } from "../../../core/logging/context-aware-logger.service";

/**
 * Position Repository Adapter
 *
 * Implements the IPositionRepository interface using PostgreSQL database operations.
 * Provides position data access with proper error handling and type safety.
 */
export class PositionRepositoryAdapter implements IPositionRepository {
  /**
   * Get all positions for a user (C3b: rows live in `exchange_positions`,
   * keyed per account — ownership resolves through the account join, so two
   * accounts of the same user holding the same symbol both come back).
   */
  async getPositions(userId: string): Promise<Position[]> {
    try {
      const result = await query<PositionRow>(
        `SELECT
                    ep.symbol,
                    ep.position_qty as quantity,
                    ep.average_open_price as entryPrice,
                    ep.mark_price as markPrice,
                    ep.leverage,
                    ep.imr,
                    ep.mmr,
                    ep.est_liq_price as liquidationPrice
                FROM exchange_positions ep
                JOIN exchange_accounts ea ON ea.id = ep.exchange_account_id
                WHERE ea.user_id = $1
                ORDER BY ep.updated_at DESC`,
        [userId]
      );

      return result.rows
        .map(row => this.mapRowToPosition(row))
        .filter(Boolean) as Position[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get positions: ${errorMessage}`);
    }
  }

  /**
   * Get the position one exchange account holds for a symbol.
   *
   * R2: keyed by `exchange_account_id` — `UNIQUE(exchange_account_id, symbol)`
   * (migration 013) makes the answer exactly one row, so the old userId-only
   * "most recently updated row wins" heuristic is gone. Ownership of the
   * accountId is the caller's contract; user-level reads go through
   * `getPositions(userId)` + explicit aggregation.
   */
  async getPosition(
    exchangeAccountId: string,
    symbol: string
  ): Promise<Position | null> {
    try {
      const result = await query<PositionRow>(
        `SELECT
                    ep.symbol,
                    ep.position_qty as quantity,
                    ep.average_open_price as entryPrice,
                    ep.mark_price as markPrice,
                    ep.leverage,
                    ep.imr,
                    ep.mmr,
                    ep.est_liq_price as liquidationPrice
                FROM exchange_positions ep
                WHERE ep.exchange_account_id = $1 AND ep.symbol = $2`,
        [exchangeAccountId, symbol]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToPosition(result.rows[0]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get position: ${errorMessage}`);
    }
  }

  /**
   * Update position data.
   *
   * Deliberately a logged no-op (unchanged from before C3b): this interface
   * is keyed by userId only, and guessing which of a user's accounts a write
   * belongs to would be wrong with 2+ accounts. The account-keyed writer is
   * `exchange-snapshot.adapter.replacePositions`, fed by the venue reads in
   * `external/kodiak/private-data.ts` (the C3b venue sync).
   */
  async updatePosition(userId: string, position: Position): Promise<void> {
    try {
      logger.info(
        `Position update for user ${userId}, symbol ${position.symbol}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update position: ${errorMessage}`);
    }
  }

  /**
   * Close position for a user — logged no-op, same reasoning as
   * `updatePosition` (the venue snapshot is the source of truth).
   */
  async closePosition(userId: string, symbol: string): Promise<void> {
    try {
      logger.info(`Position close for user ${userId}, symbol ${symbol}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to close position: ${errorMessage}`);
    }
  }

  /**
   * Map database row to Position domain object
   */
  private mapRowToPosition(row: PositionRow): Position | null {
    try {
      const symbol = row.symbol;
      const quantity = parseFloat(row.quantity || "0");
      const entryPrice = parseFloat(row.entryPrice || "0");
      const markPrice = parseFloat(row.markPrice || "0");
      const leverage = parseInt(row.leverage || "1");

      if (!symbol || quantity === 0 || entryPrice === 0) {
        return null;
      }

      // Determine side based on quantity (positive = LONG, negative = SHORT)
      const side = quantity > 0 ? "LONG" : "SHORT";

      return new Position(
        symbol,
        side,
        Math.abs(quantity),
        entryPrice,
        markPrice,
        leverage,
        parseFloat(row.imr || "0"), // margin ratio
        row.liquidationPrice ? parseFloat(row.liquidationPrice) : undefined
      );
    } catch (error) {
      logger.error(
        `Failed to map position row to domain object: ${error}`,
        error as Error
      );
      return null;
    }
  }
}

/**
 * Database row interface for position data
 */
interface PositionRow {
  symbol: string;
  quantity: string;
  entryPrice: string;
  markPrice: string;
  leverage: string;
  imr: string;
  liquidationPrice?: string;
}
// Export singleton instance
export const positionRepositoryAdapter = new PositionRepositoryAdapter();
