/**
 * Strategy Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IStrategyRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for strategy data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
  IStrategyRepository,
  Strategy,
  StrategyConfig,
  StrategyFillTotals,
  StrategyType,
  StrategyVenue,
} from "@trade-bot/shared";
import { query } from "../../../database/pool";
import { databaseLogger as logger } from "../../../core/logging/context-aware-logger.service";

/**
 * Strategy Repository Adapter
 *
 * Implements the IStrategyRepository interface using PostgreSQL database operations.
 * Provides strategy data access with proper error handling and type safety.
 */
export class StrategyRepositoryAdapter implements IStrategyRepository {
  /**
   * Get all strategies for a user
   */
  async getStrategies(userId: string): Promise<Strategy[]> {
    try {
      const result = await query<StrategyRow>(
        "SELECT id, user_id, name, type, exchange, environment, config, active, created_at, updated_at FROM strategies WHERE user_id = $1 ORDER BY created_at DESC",
        [userId]
      );

      return result.rows
        .map(row => this.mapRowToStrategy(row))
        .filter(Boolean) as Strategy[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get strategies: ${errorMessage}`);
    }
  }

  /**
   * Get strategy by ID
   */
  async getStrategy(id: string): Promise<Strategy | null> {
    try {
      const result = await query<StrategyRow>(
        "SELECT id, user_id, name, type, exchange, environment, config, active, created_at, updated_at FROM strategies WHERE id = $1",
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToStrategy(result.rows[0]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get strategy: ${errorMessage}`);
    }
  }

  /**
   * Ownership check for filtered reads (trades route): does this strategy
   * exist AND belong to `userId`? Answers with a bare existence boolean —
   * a foreign id is indistinguishable from a missing one (no leak).
   */
  async strategyExistsForUser(strategyId: string, userId: string) {
    try {
      const result = await query<{ id: string }>(
        "SELECT id FROM strategies WHERE id = $1 AND user_id = $2",
        [strategyId, userId]
      );
      return result.rows.length > 0;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to check strategy ownership: ${errorMessage}`);
    }
  }

  /**
   * Create a new strategy
   */
  async createStrategy(
    strategy: Omit<Strategy, "id" | "createdAt" | "updatedAt">
  ): Promise<Strategy> {
    try {
      // `active` is a lifecycle-derived badge, never a caller input: the CREATE
      // route's Joi schema has no `active` field, so callers leave it undefined.
      // Passing that straight into the INSERT stores NULL and bypasses the
      // column's DEFAULT FALSE, while the shared `Strategy.active` contract is a
      // non-nullable boolean (and `WHERE active = false` would miss the row).
      // Resolving it here keeps "created" meaning "inactive" in one place.
      const active = strategy.active ?? false;

      // Venue is top-level only (migration 026). Strip any venue keys a
      // caller smuggled inside config so geometry stays geometry.
      const cleanConfig = {
        ...(strategy.config as unknown as object),
      } as Record<string, unknown>;
      delete cleanConfig.exchange;
      delete cleanConfig.environment;

      const result = await query<{
        id: string;
        created_at: string;
        updated_at: string;
      }>(
        "INSERT INTO strategies (user_id, name, type, exchange, environment, config, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id, created_at, updated_at",
        [
          strategy.userId,
          strategy.name,
          strategy.type,
          strategy.exchange ?? null,
          strategy.environment ?? null,
          JSON.stringify(cleanConfig),
          active,
        ]
      );

      if (result.rows.length === 0) {
        throw new Error("Strategy creation failed - no rows returned");
      }

      const row = result.rows[0];
      return this.mapRowToStrategy({
        id: row.id,
        user_id: strategy.userId,
        name: strategy.name,
        type: strategy.type,
        exchange: strategy.exchange ?? null,
        environment: strategy.environment ?? null,
        config: strategy.config,
        // Resolved above, so the returned strategy matches the persisted flag
        // rather than echoing back the caller's omitted `undefined`.
        active,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }) as Strategy;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create strategy: ${errorMessage}`);
    }
  }

  /**
   * Full-replacement edit (migration 026). Replaces the log-only stub that
   * never wrote. `config` is the complete StrategyConfig — never partial.
   * Venue changes atomically as a pair; the DB pair-constraint is the last
   * resort, not the normal validation path.
   */
  async updateStrategy(
    id: string,
    updates: {
      name: string;
      type: StrategyType;
      config: StrategyConfig;
      exchange: StrategyVenue["exchange"];
      environment: StrategyVenue["environment"];
    }
  ): Promise<void> {
    try {
      if (!updates.exchange || !updates.environment) {
        const error = new Error(
          "exchange and environment must change together"
        );
        (error as Error & { statusCode?: number }).statusCode = 400;
        throw error;
      }
      const cleanConfig = {
        ...(updates.config as unknown as object),
      } as Record<string, unknown>;
      delete cleanConfig.exchange;
      delete cleanConfig.environment;
      const result = await query(
        "UPDATE strategies SET name = $1, type = $2, exchange = $3, environment = $4, config = $5, updated_at = NOW() WHERE id = $6",
        [
          updates.name,
          updates.type,
          updates.exchange,
          updates.environment,
          JSON.stringify(cleanConfig),
          id,
        ]
      );
      if (result.rowCount === 0) {
        const notFound = new Error("Strategy not found");
        (notFound as Error & { statusCode?: number }).statusCode = 404;
        throw notFound;
      }
      logger.info(`Strategy updated for strategy ${id}`);
    } catch (error) {
      if ((error as Error & { statusCode?: number }).statusCode) throw error;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update strategy: ${errorMessage}`);
    }
  }

  /**
   * Same full-replacement write on the caller's tx client (026 locking
   * protocol). Shares validation with `updateStrategy`.
   */
  async updateStrategyTx(
    id: string,
    updates: {
      name: string;
      type: StrategyType;
      config: StrategyConfig;
      exchange: StrategyVenue["exchange"];
      environment: StrategyVenue["environment"];
    },
    client: {
      query: (
        sql: string,
        params: unknown[]
      ) => Promise<{ rowCount: number | null }>;
    }
  ): Promise<void> {
    if (!updates.exchange || !updates.environment) {
      const error = new Error("exchange and environment must change together");
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    const cleanConfig = { ...(updates.config as unknown as object) } as Record<
      string,
      unknown
    >;
    delete cleanConfig.exchange;
    delete cleanConfig.environment;
    const result = await client.query(
      "UPDATE strategies SET name = $1, type = $2, exchange = $3, environment = $4, config = $5, updated_at = NOW() WHERE id = $6",
      [
        updates.name,
        updates.type,
        updates.exchange,
        updates.environment,
        JSON.stringify(cleanConfig),
        id,
      ]
    );
    if (result.rowCount === 0) {
      const notFound = new Error("Strategy not found");
      (notFound as Error & { statusCode?: number }).statusCode = 404;
      throw notFound;
    }
  }

  /**
   * Delete strategy
   */
  async deleteStrategy(id: string): Promise<void> {
    try {
      const result = await query("DELETE FROM strategies WHERE id = $1", [id]);
      if (result.rowCount === 0) {
        throw new Error("Strategy not found");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete strategy: ${errorMessage}`);
    }
  }

  /**
   * Toggle strategy active status
   */
  async toggleStrategy(id: string, active: boolean): Promise<void> {
    try {
      const result = await query(
        "UPDATE strategies SET active = $1, updated_at = NOW() WHERE id = $2",
        [active, id]
      );

      if (result.rowCount === 0) {
        throw new Error("Strategy not found");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to toggle strategy: ${errorMessage}`);
    }
  }

  /**
   * Lifetime fill-ledger aggregate for one strategy (Phase 1 strategy-page
   * PnL) — `bot_trade_fills WHERE strategy_id = $1` through
   * `idx_bot_trade_fills_strategy`. Session-independent: a stop/start inserts
   * a fresh `bot_instances` row but the ledger history is never reset.
   *
   * F2 honesty kept in SQL: `SUM(pnl)` covers KNOWN pnl only (NULL = unknown,
   * never folded into the sum), unknowns are counted separately so the reader
   * can flag the total as incomplete, and best/worst are NULL — not 0 — when
   * no known fill exists.
   *
   * DECIMAL/NUMERIC arrive as STRINGS from node-postgres (the documented
   * `total_pnl` toFixed crash): every figure is coerced here, at this single
   * mapping boundary, so consumers only ever see numbers.
   */
  async getStrategyFillTotals(strategyId: string): Promise<StrategyFillTotals> {
    try {
      const result = await query<StrategyFillTotalsRow>(
        `SELECT
           COUNT(*)                                    AS total_fills,
           COUNT(pnl)                                  AS known_pnl_fills,
           COUNT(*) FILTER (WHERE pnl IS NULL)         AS unknown_pnl_fills,
           COALESCE(SUM(pnl), 0)                       AS realized_pnl,
           COUNT(*) FILTER (WHERE pnl > 0)             AS winning_fills,
           COUNT(*) FILTER (WHERE pnl < 0)             AS losing_fills,
           MAX(pnl)                                    AS best_fill,
           MIN(pnl)                                    AS worst_fill,
           COALESCE(SUM(fee), 0)                       AS total_fees,
           COUNT(fee)                                  AS known_fee_fills,
           COUNT(*) FILTER (WHERE fee IS NULL)         AS unknown_fee_fills,
           MIN(executed_at)                            AS first_fill_at,
           MAX(executed_at)                            AS last_fill_at
         FROM bot_trade_fills
         WHERE strategy_id = $1`,
        [strategyId]
      );

      const row = result.rows[0];
      if (!row) {
        // Aggregate over zero rows still returns one row in PostgreSQL —
        // a missing row means the query shape broke; fail loudly.
        throw new Error("aggregate returned no row");
      }
      return {
        totalFills: Number(row.total_fills ?? 0),
        knownPnlFills: Number(row.known_pnl_fills ?? 0),
        unknownPnlFills: Number(row.unknown_pnl_fills ?? 0),
        realizedPnl: Number(row.realized_pnl ?? 0),
        winningFills: Number(row.winning_fills ?? 0),
        losingFills: Number(row.losing_fills ?? 0),
        bestFill: row.best_fill == null ? null : Number(row.best_fill),
        worstFill: row.worst_fill == null ? null : Number(row.worst_fill),
        totalFees: Number(row.total_fees ?? 0),
        knownFeeFills: Number(row.known_fee_fills ?? 0),
        unknownFeeFills: Number(row.unknown_fee_fills ?? 0),
        firstFillAt: row.first_fill_at
          ? new Date(row.first_fill_at).toISOString()
          : null,
        lastFillAt: row.last_fill_at
          ? new Date(row.last_fill_at).toISOString()
          : null,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get strategy fill totals: ${errorMessage}`);
    }
  }

  /**
   * Map database row to Strategy interface object
   */
  private mapRowToStrategy(row: StrategyRow): Strategy | null {
    try {
      // Return plain object matching Strategy interface
      return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        type: row.type,
        exchange:
          row.exchange === "kodiak" || row.exchange === "lighter"
            ? row.exchange
            : null,
        environment:
          row.environment === "testnet" || row.environment === "mainnet"
            ? row.environment
            : null,
        config:
          typeof row.config === "string" ? JSON.parse(row.config) : row.config,
        active: row.active,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    } catch (error) {
      logger.error(
        `Failed to map strategy row to domain object: ${error}`,
        error as Error
      );
      return null;
    }
  }
}

/**
 * Database row interface for strategy data
 */
interface StrategyRow {
  id: string;
  user_id: string;
  name: string;
  type: StrategyType;
  exchange: string | null;
  environment: string | null;
  config: string | StrategyConfig;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Raw aggregate row for `getStrategyFillTotals`. node-postgres types
 * DECIMAL/NUMERIC/BIGINT as strings — the mapper above coerces every field.
 */
interface StrategyFillTotalsRow {
  total_fills: string;
  known_pnl_fills: string;
  unknown_pnl_fills: string;
  realized_pnl: string;
  winning_fills: string;
  losing_fills: string;
  best_fill: string | null;
  worst_fill: string | null;
  total_fees: string;
  known_fee_fills: string;
  unknown_fee_fills: string;
  first_fill_at: string | null;
  last_fill_at: string | null;
}
// Export singleton instance
export const strategyRepositoryAdapter = new StrategyRepositoryAdapter();
