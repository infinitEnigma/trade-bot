/**
 * Bot Instance Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IBotInstanceRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for bot instance data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { BotInstanceRecord, IBotInstanceRepository } from "@trade-bot/shared";
import { query } from "../../../database/pool";
import { tradingLogger as logger } from "../../../core/logging/context-aware-logger.service";

/**
 * Bot Instance Repository Adapter
 *
 * Implements the IBotInstanceRepository interface using PostgreSQL database operations.
 * Provides bot instance data access with proper error handling and type safety.
 */
export class BotInstanceRepositoryAdapter implements IBotInstanceRepository {
  /**
   * Get all bot instances for a user.
   *
   * Sessions carry no per-strategy columns (022 shim-drop): the `strategy_*`
   * display fields resolve from the session's oldest run, NULL when the
   * session has no runs yet.
   */
  async getBotInstances(userId: string): Promise<BotInstanceRecord[]> {
    try {
      const result = await query<BotInstanceRecord>(
        `
                SELECT bi.*,
                       first_run.strategy_name as strategy_name,
                       first_run.strategy_type as strategy_type,
                       first_run.strategy_config as strategy_config,
                       (tail.event_type = 'RECONCILE_NEEDS_USER_ACTION') AS needs_user_action,
                       -- Only meaningful when the flag is true: the tail event's
                       -- own reason (e.g. normal_stop) is noise otherwise and
                       -- reads as "action needed because it stopped normally".
                       CASE WHEN tail.event_type = 'RECONCILE_NEEDS_USER_ACTION'
                            THEN tail.metadata->>'reason'
                       END AS needs_user_action_reason,
                       -- D2 sessions: runs attached to this session, oldest
                       -- first (empty array for pre-D bots whose runs row
                       -- has not been attached yet).
                       COALESCE(
                         (
                           SELECT json_agg(
                             json_build_object(
                               'id', r.id,
                               'strategy_id', r.strategy_id,
                               'config_version', r.config_version,
                               'config', r.config,
                               'notional_amount', r.notional_amount,
                               'state', r.state,
                               'last_error_code', r.last_error_code
                             )
                             ORDER BY r.created_at ASC, r.id ASC
                           )
                           FROM strategy_runs r
                           WHERE r.bot_id = bi.id
                         ),
                         '[]'::json
                       ) AS runs
                FROM bot_instances bi
                LEFT JOIN LATERAL (
                    -- 022 shim-drop: oldest run's strategy projection (NULL
                    -- when the session has no runs yet).
                    SELECT s.name as strategy_name, s.type as strategy_type,
                           s.config as strategy_config
                    FROM strategy_runs r
                    JOIN strategies s ON s.id = r.strategy_id
                    WHERE r.bot_id = bi.id
                    ORDER BY r.created_at ASC, r.id ASC
                    LIMIT 1
                ) first_run ON TRUE
                LEFT JOIN LATERAL (
                    -- P0-3: the newest lifecycle event decides whether an
                    -- unresolved needs-action marker is still outstanding. Any
                    -- real transition (STATE_CHANGED, a command) becomes the
                    -- tail and clears the flag automatically, so it stays
                    -- correct without an extra table or a follow-up query.
                    SELECT e.event_type, e.metadata
                    FROM bot_lifecycle_events e
                    WHERE e.bot_id = bi.id
                    ORDER BY e.created_at DESC
                    LIMIT 1
                ) tail ON TRUE
                WHERE bi.user_id = $1
                ORDER BY bi.created_at DESC
            `,
        [userId]
      );

      return result.rows;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get bot instances", error as Error);
      throw new Error(`Failed to get bot instances: ${errorMessage}`);
    }
  }

  /**
   * Get bot instance by ID. Same oldest-run strategy projection as the
   * list query (022 shim-drop).
   */
  async getBotInstance(id: string): Promise<BotInstanceRecord | null> {
    try {
      const result = await query<BotInstanceRecord>(
        `
                SELECT bi.*,
                       first_run.strategy_name as strategy_name,
                       first_run.strategy_type as strategy_type,
                       first_run.strategy_config as strategy_config
                FROM bot_instances bi
                LEFT JOIN LATERAL (
                    SELECT s.name as strategy_name, s.type as strategy_type,
                           s.config as strategy_config
                    FROM strategy_runs r
                    JOIN strategies s ON s.id = r.strategy_id
                    WHERE r.bot_id = bi.id
                    ORDER BY r.created_at ASC, r.id ASC
                    LIMIT 1
                ) first_run ON TRUE
                WHERE bi.id = $1
            `,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get bot instance", error as Error);
      throw new Error(`Failed to get bot instance: ${errorMessage}`);
    }
  }

  /**
   * Create a new bot instance.
   *
   * Retired path (022 shim-drop): session creation goes through
   * `BotLifecycleRepository.insertBotInstance` (no `strategy_id` column).
   * This adapter keeps the interface shape but fails closed — sessions
   * must not be created with a per-strategy column that no longer exists.
   */
  async createBotInstance(
    _bot: Omit<BotInstanceRecord, "created_at" | "updated_at">
  ): Promise<BotInstanceRecord> {
    throw new Error(
      "Bot instance creation moved to BotLifecycleRepository.insertBotInstance " +
        "(022 shim-drop: sessions carry no strategy_id column)"
    );
  }

  /**
   * Update bot instance status
   */
  async updateBotStatus(id: string, status: string): Promise<void> {
    try {
      await query(
        "UPDATE bot_instances SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [status, id]
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to update bot status", error as Error);
      throw new Error(`Failed to update bot status: ${errorMessage}`);
    }
  }

  /**
   * Update bot instance performance metrics
   */
  async updateBotPerformance(
    id: string,
    metrics: { runningTime?: number; totalTrades?: number; totalPnL?: number }
  ): Promise<void> {
    try {
      // Build update query dynamically based on provided fields
      const updateFields: string[] = [];
      const updateValues: unknown[] = [];
      let valueIndex = 1;

      if (metrics.runningTime !== undefined) {
        updateFields.push(`running_time = $${valueIndex}`);
        updateValues.push(metrics.runningTime);
        valueIndex++;
      }

      if (metrics.totalTrades !== undefined) {
        updateFields.push(`total_trades = $${valueIndex}`);
        updateValues.push(metrics.totalTrades);
        valueIndex++;
      }

      if (metrics.totalPnL !== undefined) {
        updateFields.push(`total_pnl = $${valueIndex}`);
        updateValues.push(metrics.totalPnL);
        valueIndex++;
      }

      if (updateFields.length === 0) {
        return; // No fields to update
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateValues.push(id); // For the WHERE clause

      await query(
        `UPDATE bot_instances SET ${updateFields.join(", ")} WHERE id = $${valueIndex}`,
        updateValues
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to update bot performance", error as Error);
      throw new Error(`Failed to update bot performance: ${errorMessage}`);
    }
  }

  /**
   * Delete bot instance
   */
  async deleteBotInstance(id: string): Promise<void> {
    try {
      await query("DELETE FROM bot_instances WHERE id = $1", [id]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to delete bot instance", error as Error);
      throw new Error(`Failed to delete bot instance: ${errorMessage}`);
    }
  }

  /**
   * Get active bot instances
   */
  async getActiveBotInstances(): Promise<BotInstanceRecord[]> {
    try {
      const result = await query<BotInstanceRecord>(`
                SELECT * FROM bot_instances 
                WHERE status IN ('RUNNING', 'STARTING')
            `);

      return result.rows;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get active bot instances", error as Error);
      throw new Error(`Failed to get active bot instances: ${errorMessage}`);
    }
  }

  /**
   * Sessions hosting one strategy (any lifecycle state), resolved via
   * `strategy_runs` (022 shim-drop): a session hosts the strategy iff it
   * has a run row for it.
   */
  async getBotInstancesByStrategy(
    strategyId: string
  ): Promise<BotInstanceRecord[]> {
    try {
      const result = await query<BotInstanceRecord>(
        `SELECT bi.* FROM bot_instances bi
           JOIN strategy_runs r ON r.bot_id = bi.id AND r.strategy_id = $1
          ORDER BY bi.created_at DESC`,
        [strategyId]
      );
      return result.rows;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get bot instances for strategy", error as Error);
      throw new Error(
        `Failed to get bot instances for strategy: ${errorMessage}`
      );
    }
  }
}

// Export singleton instance
export const botInstanceRepositoryAdapter = new BotInstanceRepositoryAdapter();
