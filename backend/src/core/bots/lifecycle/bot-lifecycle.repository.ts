/**
 * Bot Lifecycle Repository - all PostgreSQL persistence for the lifecycle
 *
 * Extracted from BotLifecycleService so the service can focus on
 * orchestration. Every lifecycle-related SQL statement lives here:
 * bot reads, compare-and-set transitions, audit trail, command
 * tracking and timeout-sweep queries.
 *
 * @format
 */

import { BotActualState } from "@trade-bot/shared";
import { query } from "../../../database/pool";
import { contextLogger as logger } from "../../logging";
import {
  BOT_COMMAND_TIMEOUT_MS,
  BotRow,
  LifecycleEventInput,
  LifecycleEventRow,
  PersistTransitionInput,
  TrackedCommandRow,
} from "./types";

export class BotLifecycleRepository {
  async findBot(botId: string): Promise<BotRow | null> {
    const result = await query<BotRow>(
      "SELECT id, user_id, strategy_id, status, desired_state, actual_state, engine_id, exchange_account_id FROM bot_instances WHERE id = $1",
      [botId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Persist a lifecycle transition. When `expectedActualState` is provided,
   * the UPDATE is guarded with a compare-and-set predicate
   * (`AND actual_state = $expected`) so concurrent lifecycle operations
   * cannot race: the caller receives `false` if the row's actual_state
   * changed underneath it and must treat the transition as stale.
   */
  async persistTransition(
    botId: string,
    input: PersistTransitionInput,
    expectedActualState?: BotActualState
  ): Promise<boolean> {
    const now = new Date();
    const sql = expectedActualState
      ? `UPDATE bot_instances
               SET desired_state = $2,
                   actual_state = $3,
                   status = $4,
                   engine_id = COALESCE($5, engine_id),
                   state_changed_at = $6,
                   started_at = COALESCE($7, started_at),
                   stopped_at = COALESCE($8, stopped_at),
                   last_error_code = COALESCE($9, last_error_code),
                   last_error_message = COALESCE($10, last_error_message),
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $1 AND actual_state = $11`
      : `UPDATE bot_instances
               SET desired_state = $2,
                   actual_state = $3,
                   status = $4,
                   engine_id = COALESCE($5, engine_id),
                   state_changed_at = $6,
                   started_at = COALESCE($7, started_at),
                   stopped_at = COALESCE($8, stopped_at),
                   last_error_code = COALESCE($9, last_error_code),
                   last_error_message = COALESCE($10, last_error_message),
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $1`;
    const params: unknown[] = [
      botId,
      input.desiredState,
      input.actualState,
      input.actualState === "UNKNOWN" ? "ERROR" : input.actualState,
      input.engineId ?? null,
      now,
      input.startedAt ?? null,
      input.stoppedAt ?? null,
      input.errorCode === undefined ? null : input.errorCode,
      input.errorMessage === undefined ? null : input.errorMessage,
    ];
    if (expectedActualState) {
      params.push(expectedActualState);
    }
    const result = await query(sql, params);
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Write the display/authoritative `status` column directly. Used by the
   * emergency-stop flow to mark FORCE_STOPPING after a persistTransition
   * (which mirrors `status` to `actual_state`); the next engine STATE_CHANGED
   * converges it back to the actual state.
   */
  async updateStatus(botId: string, status: string): Promise<void> {
    try {
      await query(
        "UPDATE bot_instances SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [status, botId]
      );
    } catch (error) {
      logger.error("Failed to update bot status", undefined, {
        botId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Record why a force stop left the venue in a state the operator must know
   * about (M1: the engine's `cleanup_incomplete` marker). Unlike
   * `last_error_message` — which the terminal transition clears, because the
   * stop itself succeeded — this column is never reset, so the fact survives
   * the next start/stop cycle and stays visible in the row and the audit trail.
   */
  async recordForceStopReason(botId: string, reason: string): Promise<void> {
    try {
      await query(
        "UPDATE bot_instances SET force_stop_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [reason, botId]
      );
    } catch (error) {
      logger.error("Failed to record force stop reason", undefined, {
        botId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Append to the lifecycle audit trail. Audit failures never break the
   * lifecycle flow itself - they are logged and swallowed.
   */
  async recordLifecycleEvent(
    botId: string,
    input: LifecycleEventInput
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO bot_lifecycle_events (bot_id, event_type, from_state, to_state, correlation_id, message_id, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          botId,
          input.eventType,
          input.fromState,
          input.toState,
          input.correlationId,
          input.messageId,
          JSON.stringify(input.metadata),
        ]
      );
    } catch (error) {
      logger.error("Failed to record lifecycle event", undefined, {
        botId,
        eventType: input.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The most recent lifecycle event for a bot, or null when it has none.
   *
   * P0-3: used to keep an unresolved `RECONCILE_NEEDS_USER_ACTION` marker to ONE
   * row per episode. The reconciler runs every ~60 s; recording unconditionally
   * produced 794 identical marker rows against 24 real `STATE_CHANGED` events
   * in this database (one bot alone had 725).
   *
   * "Latest" is what makes this work: any real transition (or command) becomes
   * the new tail, so the marker is legitimately re-recorded if the bot parks
   * again later. `bot_lifecycle_events.id` is a UUID and carries no ordering, so
   * `created_at` is the only ordering available; a sub-microsecond tie can at
   * worst skip one redundant write, never loop.
   */
  async findLatestLifecycleEvent(
    botId: string
  ): Promise<LifecycleEventRow | null> {
    const result = await query<LifecycleEventRow>(
      `SELECT event_type, from_state, metadata
         FROM bot_lifecycle_events
        WHERE bot_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [botId]
    );
    return result.rows[0] ?? null;
  }

  // ===========================================
  // COMMAND TRACKING
  // ===========================================

  /**
   * Record a command as PENDING in `bot_commands`. The timeout sweeper uses
   * this table to detect commands that Redis accepted but the engine never
   * processed (e.g. engine down), so bots cannot be stuck in STARTING/STOPPING.
   */
  async recordPendingCommand(
    botId: string,
    correlationId: string,
    commandType: string
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO bot_commands (correlation_id, bot_id, command_type, state, expires_at)
                 VALUES ($1, $2, $3, 'PENDING', NOW() + make_interval(secs => $4))
                 ON CONFLICT (correlation_id) DO NOTHING`,
        [correlationId, botId, commandType, BOT_COMMAND_TIMEOUT_MS / 1000]
      );
    } catch (error) {
      // Command tracking must never break the lifecycle flow itself;
      // the worst case is a command without timeout supervision.
      logger.error("Failed to record pending command", undefined, {
        botId,
        correlationId,
        commandType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Mark a tracked command resolved. Unknown correlationIds are ignored so
   * events for commands tracked before this feature keep working.
   */
  async resolveCommand(
    correlationId: string,
    state: "ACCEPTED" | "FAILED",
    errorCode?: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      await query(
        `UPDATE bot_commands
                 SET state = $2,
                     resolved_at = CURRENT_TIMESTAMP,
                     error_code = COALESCE($3, error_code),
                     error_message = COALESCE($4, error_message)
                 WHERE correlation_id = $1 AND state = 'PENDING'`,
        [correlationId, state, errorCode ?? null, errorMessage ?? null]
      );
    } catch (error) {
      logger.error("Failed to resolve tracked command", undefined, {
        correlationId,
        state,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Look up a tracked command by correlationId - used for stale-generation
   * rejection of engine events (delayed events from superseded commands).
   */
  async findTrackedCommand(
    correlationId: string
  ): Promise<{ bot_id: string; state: string } | null> {
    const result = await query<{ bot_id: string; state: string }>(
      "SELECT bot_id, state FROM bot_commands WHERE correlation_id = $1",
      [correlationId]
    );
    return result.rows[0] ?? null;
  }

  /** All PENDING commands past their expiry (timeout supervision sweep). */
  async findExpiredPendingCommands(): Promise<TrackedCommandRow[]> {
    const result = await query<TrackedCommandRow>(
      `SELECT correlation_id, bot_id, command_type
             FROM bot_commands
             WHERE state = 'PENDING' AND expires_at < NOW()`,
      []
    );
    return result.rows;
  }

  /**
   * Claim an expired command for timeout processing (CAS against concurrent
   * sweeps). Returns true if this caller won the claim.
   */
  async claimTimedOutCommand(correlationId: string): Promise<boolean> {
    const claimed = await query(
      `UPDATE bot_commands
             SET state = 'TIMED_OUT', resolved_at = CURRENT_TIMESTAMP,
                 error_code = 'COMMAND_TIMEOUT'
             WHERE correlation_id = $1 AND state = 'PENDING'`,
      [correlationId]
    );
    return (claimed.rowCount ?? 0) === 1;
  }

  /** All RUNNING bots assigned to an engine (heartbeat-loss supervision). */
  async findRunningBotsForEngine(engineId: string): Promise<BotRow[]> {
    const result = await query<BotRow>(
      `SELECT id, user_id, strategy_id, status, desired_state, actual_state, engine_id, exchange_account_id
             FROM bot_instances
             WHERE engine_id = $1 AND actual_state = 'RUNNING'`,
      [engineId]
    );
    return result.rows;
  }

  /** Lifecycle state of specific bots (heartbeat inventory drift checks). */
  async findBotsByIds(botIds: string[]): Promise<BotRow[]> {
    if (botIds.length === 0) {
      return [];
    }
    const placeholders = botIds.map((_, i) => `$${i + 1}`).join(", ");
    const result = await query<BotRow>(
      `SELECT id, user_id, strategy_id, status, desired_state, actual_state, engine_id, exchange_account_id
             FROM bot_instances
             WHERE id IN (${placeholders})`,
      botIds
    );
    return result.rows;
  }

  /** Non-secret strategy configuration for the start command payload. */
  async findStrategyConfig(
    strategyId: string
  ): Promise<Record<string, unknown>> {
    const result = await query<{ config: Record<string, unknown> | null }>(
      "SELECT config FROM strategies WHERE id = $1",
      [strategyId]
    );
    return result.rows[0]?.config ?? {};
  }

  /** Whether a strategy exists and belongs to the user (createAndStart). */
  async strategyExistsForUser(
    strategyId: string,
    userId: string
  ): Promise<boolean> {
    const result = await query<{ id: string }>(
      "SELECT id FROM strategies WHERE id = $1 AND user_id = $2",
      [strategyId, userId]
    );
    return result.rows.length > 0;
  }

  /**
   * The bot that already occupies a strategy, if any - "one live bot per
   * strategy".
   *
   * P0 (2026-10-05): the predicate used to be `actual_state IN ('STARTING',
   * 'RUNNING')` only, so a bot that a crashed engine had parked in UNKNOWN (or
   * ERROR) with `desired_state = 'RUNNING'` did NOT count as occupying the
   * strategy. `POST /start` therefore created a SECOND live bot on the same venue
   * account — reproduced live during Gate-4 run 3. A parked bot still wants to
   * run and may still hold venue orders, so it must block a duplicate.
   *
   * STOPPING is deliberately excluded: it is on its way out (orders being
   * cancelled) and blocking on it would break the ordinary stop-then-start flow.
   *
   * Keyed on `strategy_id` today. The account-session model (plan §D) makes the
   * invariant "one live session per exchange account" instead — see
   * DATA_MODEL.md §4.4 and migration 018, which enforces this predicate as a
   * partial unique index.
   */
  async findActiveBotForStrategy(
    strategyId: string
  ): Promise<{ id: string } | null> {
    const result = await query<{ id: string }>(
      `SELECT id FROM bot_instances
        WHERE strategy_id = $1
          AND (
            actual_state IN ('STARTING', 'RUNNING')
            OR (desired_state = 'RUNNING' AND actual_state IN ('UNKNOWN', 'ERROR'))
          )
        ORDER BY created_at DESC
        LIMIT 1`,
      [strategyId]
    );
    return result.rows[0] ?? null;
  }

  /** Insert a bot instance in the deterministic initial STOPPED state; returns its id. */
  async insertBotInstance(
    strategyId: string,
    userId: string,
    exchangeAccountId: string
  ): Promise<string> {
    const insertResult = await query<{ id: string }>(
      `INSERT INTO bot_instances
                (strategy_id, user_id, exchange_account_id, status, running_time, total_trades, total_pnl, desired_state, actual_state)
             VALUES ($1, $2, $3, 'STOPPED', 0, 0, 0, 'STOPPED', 'STOPPED')
             RETURNING id`,
      [strategyId, userId, exchangeAccountId]
    );
    return insertResult.rows[0].id;
  }

  // ===========================================
  // LIFECYCLE RECONCILIATION QUERIES
  // ===========================================

  /** Bots the user wants stopped but the engine still reports as active. */
  async findDesiredStoppedButActiveBots(): Promise<BotRow[]> {
    const result = await query<BotRow>(
      `SELECT id, user_id, strategy_id, status, desired_state, actual_state, engine_id, exchange_account_id
             FROM bot_instances
             WHERE desired_state = 'STOPPED'
               AND actual_state IN ('STARTING', 'RUNNING', 'STOPPING')`
    );
    return result.rows;
  }

  /**
   * Transitional bots stuck with NO pending command and no state change
   * within the grace window. Their actual state can no longer be confirmed
   * by the supervision sweeps, so it must degrade to UNKNOWN.
   */
  async findStuckTransitionalBots(graceSeconds: number): Promise<BotRow[]> {
    const result = await query<BotRow>(
      `SELECT b.id, b.user_id, b.strategy_id, b.status, b.desired_state, b.actual_state, b.engine_id, b.exchange_account_id
             FROM bot_instances b
             WHERE b.actual_state IN ('STARTING', 'STOPPING')
               AND b.state_changed_at < NOW() - make_interval(secs => $1)
               AND NOT EXISTS (
                   SELECT 1 FROM bot_commands c
                   WHERE c.bot_id = b.id AND c.state = 'PENDING'
               )`,
      [graceSeconds]
    );
    return result.rows;
  }

  /** Bots the user wants running but whose actual state is unconfirmed (ERROR/UNKNOWN). */
  async findDesiredRunningUnconfirmedBots(): Promise<BotRow[]> {
    const result = await query<BotRow>(
      `SELECT id, user_id, strategy_id, status, desired_state, actual_state, engine_id, exchange_account_id
             FROM bot_instances
             WHERE desired_state = 'RUNNING'
               AND actual_state IN ('ERROR', 'UNKNOWN')`
    );
    return result.rows;
  }

  /**
   * Count reconciliation stop-reissues for a bot within the last hour,
   * used to bound automatic repair attempts.
   */
  async countRecentStopReissues(botId: string): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count
             FROM bot_lifecycle_events
             WHERE bot_id = $1
               AND event_type = 'RECONCILE_STOP_REISSUED'
               AND created_at > NOW() - INTERVAL '1 hour'`,
      [botId]
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }
}
