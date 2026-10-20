/**
 * Bot Lifecycle Repository Adapter — all PostgreSQL persistence for the
 * lifecycle, implementing the core `ILifecycleRepository` port.
 *
 * Moved here from `core/bots/lifecycle/bot-lifecycle.repository.ts`
 * (dependency inversion — external review P1, 2026-10-15): every
 * lifecycle-related SQL statement lives in this infrastructure adapter —
 * bot reads, compare-and-set transitions, audit trail, command tracking,
 * timeout-sweep queries and the F1 cap-guarded run attach. Core consumes the
 * port; `index.ts` wires this adapter at startup.
 *
 * @format
 */

import { BotActualState } from "@trade-bot/shared";
import { query, transaction } from "../../../database/pool";
import type { PoolClient } from "pg";
import { contextLogger as logger } from "../../../core/logging";
import {
  ILifecycleRepository,
  LifecycleTx,
  ResidualAbandonContext,
  EditBlockers,
  StrategyVenueRow,
  RunNotionalCapExceededError,
} from "../../../core/bots/lifecycle/lifecycle-repository.port";
import {
  BOT_COMMAND_TIMEOUT_MS,
  BotRow,
  LifecycleEventInput,
  LifecycleEventRow,
  PersistTransitionInput,
  StrategyRunRow,
  TrackedCommandRow,
} from "../../../core/bots/lifecycle/types";

/** Cast the opaque core tx handle back to the concrete pg client. */
function clientOf(tx: LifecycleTx): PoolClient {
  return tx as unknown as PoolClient;
}

export class BotLifecycleRepositoryAdapter implements ILifecycleRepository {
  /**
   * Session columns (022 shim-drop): `strategy_id` is gone — strategy
   * attribution resolves via `strategy_runs`.
   */
  private static readonly BOT_COLUMNS =
    "id, user_id, status, desired_state, actual_state, engine_id, exchange_account_id";

  async findBot(botId: string): Promise<BotRow | null> {
    const result = await query<BotRow>(
      `SELECT ${BotLifecycleRepositoryAdapter.BOT_COLUMNS} FROM bot_instances WHERE id = $1`,
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
  async persistStopTx(
    botId: string,
    input: PersistTransitionInput,
    expectedActualState: BotActualState,
    forceStopReason?: string
  ): Promise<boolean> {
    return transaction(async client => {
      const binding = await client.query<{
        exchange_account_id: string | null;
      }>("SELECT exchange_account_id FROM bot_instances WHERE id = $1", [
        botId,
      ]);
      const exchangeAccountId = binding.rows[0]?.exchange_account_id;
      // Only serialize on the account lock when the bot is bound. A bot
      // without a bound account can't start a concurrent session anyway, so
      // there's nothing to race against; skip the lock rather than failing
      // the stop entirely.
      if (exchangeAccountId) {
        await client.query(
          "SELECT id FROM exchange_accounts WHERE id = $1 FOR UPDATE",
          [exchangeAccountId]
        );
      }
      const params: unknown[] = [
        botId,
        input.desiredState,
        input.actualState,
        input.actualState === "UNKNOWN" ? "ERROR" : input.actualState,
        input.engineId ?? null,
        new Date(),
        input.startedAt ?? null,
        input.stoppedAt ?? null,
        input.errorCode === undefined ? null : input.errorCode,
        input.errorMessage === undefined ? null : input.errorMessage,
      ];
      let markerSql = "";
      if (forceStopReason?.includes("cleanup_incomplete")) {
        params.push(forceStopReason);
        markerSql = `, force_stop_reason = $${params.length}`;
      }
      params.push(expectedActualState);
      const result = await client.query(
        `UPDATE bot_instances
            SET desired_state = $2, actual_state = $3, status = $4,
                engine_id = COALESCE($5, engine_id), state_changed_at = $6,
                started_at = COALESCE($7, started_at), stopped_at = COALESCE($8, stopped_at),
                last_error_code = COALESCE($9, last_error_code),
                last_error_message = COALESCE($10, last_error_message)${markerSql},
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND actual_state = $${params.length}`,
        params
      );
      return (result.rowCount ?? 0) === 1;
    });
  }

  /**
   * Atomic start admission: serialize with stop/abandon/create/attach on the
   * account row, reject unresolved venue exposure, then persist the CAS state
   * transition and audit event before releasing the lock.
   */
  async persistStartTx(
    botId: string,
    exchangeAccountId: string | null,
    input: PersistTransitionInput,
    expectedActualState: BotActualState,
    event: LifecycleEventInput
  ): Promise<{ persisted: boolean; unresolvedExposureId?: string }> {
    return transaction(async client => {
      const tx = client as unknown as LifecycleTx;
      if (exchangeAccountId) {
        await this.lockAccountRowTx(tx, exchangeAccountId);
        const unresolved = await this.findUnresolvedExposureTx(
          tx,
          exchangeAccountId
        );
        if (unresolved) {
          return { persisted: false, unresolvedExposureId: unresolved.id };
        }
      }

      const params: unknown[] = [
        botId,
        input.desiredState,
        input.actualState,
        input.actualState === "UNKNOWN" ? "ERROR" : input.actualState,
        input.engineId ?? null,
        new Date(),
        input.startedAt ?? null,
        input.stoppedAt ?? null,
        input.errorCode === undefined ? null : input.errorCode,
        input.errorMessage === undefined ? null : input.errorMessage,
        expectedActualState,
      ];
      const result = await client.query(
        `UPDATE bot_instances
            SET desired_state = $2, actual_state = $3, status = $4,
                engine_id = COALESCE($5, engine_id), state_changed_at = $6,
                started_at = COALESCE($7, started_at), stopped_at = COALESCE($8, stopped_at),
                last_error_code = COALESCE($9, last_error_code),
                last_error_message = COALESCE($10, last_error_message),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND actual_state = $11`,
        params
      );
      if ((result.rowCount ?? 0) !== 1) {
        return { persisted: false };
      }

      await this.recordLifecycleEventTx(tx, botId, event);
      return { persisted: true };
    });
  }

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
   * Audit write via the caller's tx — rolls back with the admission so a
   * failed attach leaves no BOT_CREATED/RUN_ATTACHED trail for a missing row.
   */
  async recordLifecycleEventTx(
    tx: LifecycleTx,
    botId: string,
    input: LifecycleEventInput
  ): Promise<void> {
    const client = clientOf(tx);
    await client.query(
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
      `SELECT ${BotLifecycleRepositoryAdapter.BOT_COLUMNS}
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
      `SELECT ${BotLifecycleRepositoryAdapter.BOT_COLUMNS}
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

  /**
   * Strategy venue + symbol for admission (migration 026). Venue comes from
   * the top-level columns, symbol from `config` — never the reverse.
   */
  async findStrategyVenue(strategyId: string): Promise<{
    exchange: string | null;
    environment: string | null;
    symbol: string;
    config: Record<string, unknown>;
  }> {
    const result = await query<{
      exchange: string | null;
      environment: string | null;
      config: Record<string, unknown> | string | null;
    }>("SELECT exchange, environment, config FROM strategies WHERE id = $1", [
      strategyId,
    ]);
    return BotLifecycleRepositoryAdapter.toVenue(result.rows[0]);
  }

  /**
   * Run `fn` inside one database transaction (BEGIN/COMMIT/ROLLBACK via the
   * shared pool helper). The tx handle handed to `fn` is the port's opaque
   * `LifecycleTx` — core composes lock→validate→insert sequences through
   * this method without ever touching pg types.
   */
  async inTransaction<T>(fn: (tx: LifecycleTx) => Promise<T>): Promise<T> {
    return transaction(client => fn(client as unknown as LifecycleTx));
  }

  /**
   * Lock the strategy row first inside the caller's tx; returns venue +
   * symbol + config. Lock order everywhere: strategies → bot_instances.
   */
  async lockStrategyRow(
    tx: LifecycleTx,
    strategyId: string
  ): Promise<StrategyVenueRow | null> {
    const client = clientOf(tx);
    const result = await client.query<{
      exchange: string | null;
      environment: string | null;
      config: Record<string, unknown> | string | null;
    }>(
      "SELECT exchange, environment, config FROM strategies WHERE id = $1 FOR UPDATE",
      [strategyId]
    );
    if (!result.rows[0]) return null;
    return BotLifecycleRepositoryAdapter.toVenue(result.rows[0]);
  }

  private static toVenue(
    row:
      | {
          exchange: string | null;
          environment: string | null;
          config: Record<string, unknown> | string | null;
        }
      | undefined
  ): {
    exchange: string | null;
    environment: string | null;
    symbol: string;
    config: Record<string, unknown>;
  } {
    if (!row)
      return { exchange: null, environment: null, symbol: "", config: {} };
    const config =
      typeof row.config === "string"
        ? (JSON.parse(row.config) as Record<string, unknown>)
        : (row.config ?? {});
    return {
      exchange: row.exchange,
      environment: row.environment,
      symbol: typeof config.symbol === "string" ? config.symbol : "",
      config,
    };
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

  /** Live run occupying a strategy, read under the caller's lock. */
  async findLiveRunForStrategyTx(
    tx: LifecycleTx,
    strategyId: string
  ): Promise<StrategyRunRow | null> {
    const client = clientOf(tx);
    const result = await client.query<StrategyRunRow>(
      `SELECT id, bot_id, strategy_id, config_version, config, notional_amount,
              state, last_error_code, created_at, updated_at
         FROM strategy_runs
        WHERE strategy_id = $1
          AND state IN ('STARTING', 'RUNNING')
        ORDER BY created_at DESC
        LIMIT 1`,
      [strategyId]
    );
    return result.rows[0] ?? null;
  }

  /** Live-or-parked session on an account, read under the caller's lock. */
  async findLiveSessionForAccountTx(
    tx: LifecycleTx,
    exchangeAccountId: string
  ): Promise<{ id: string } | null> {
    const client = clientOf(tx);
    const result = await client.query<{ id: string }>(
      `SELECT id FROM bot_instances
        WHERE exchange_account_id = $1
          AND (
            actual_state IN ('STARTING', 'RUNNING')
            OR (desired_state = 'RUNNING' AND actual_state IN ('UNKNOWN', 'ERROR'))
          )
        LIMIT 1`,
      [exchangeAccountId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Lock the account row (FOR UPDATE) in the caller's tx — the serialization
   * point for every run admit on this account (Arch-3). Idempotent within a
   * tx: attachRunWithCapGuardTx re-issues it as a no-op after the caller has
   * already taken it.
   */
  async lockAccountRowTx(
    tx: LifecycleTx,
    exchangeAccountId: string
  ): Promise<void> {
    const client = clientOf(tx);
    await client.query(
      `SELECT id FROM exchange_accounts WHERE id = $1 FOR UPDATE`,
      [exchangeAccountId]
    );
  }

  /**
   * Edit blockers for venue/symbol changes (026). A terminal-looking run
   * state alone never permits edits: ERROR/UNKNOWN sessions, incomplete
   * venue cleanup, or an unresolved RECONCILE_NEEDS_USER_ACTION tail block.
   */
  async findResidualAbandonContextTx(
    tx: LifecycleTx,
    botId: string,
    userId: string
  ): Promise<ResidualAbandonContext | null> {
    const client = clientOf(tx);
    const session = await client.query<
      Omit<ResidualAbandonContext, "run_symbols">
    >(
      `SELECT id,user_id,exchange_account_id,actual_state,force_stop_reason,residual_abandoned_at FROM bot_instances WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [botId, userId]
    );
    const row = session.rows[0];
    if (!row) return null;
    const symbols = await client.query<{ symbol: string | null }>(
      `SELECT DISTINCT COALESCE(config->>'symbol',config->'strategy'->>'symbol') AS symbol FROM strategy_runs WHERE bot_id=$1`,
      [botId]
    );
    return {
      ...row,
      run_symbols: symbols.rows
        .map(x => x.symbol)
        .filter((x): x is string => Boolean(x)),
    };
  }
  async completeResidualAbandonTx(
    tx: LifecycleTx,
    botId: string,
    userId: string,
    input: {
      reason: string;
      quantity: string;
      symbol: string;
      operator: string;
      forceStopReason: string;
      resolution: "parsed" | "operator";
    }
  ): Promise<void> {
    const client = clientOf(tx);
    const updated = await client.query<{ residual_abandoned_at: string }>(
      `UPDATE bot_instances
          SET residual_abandoned_at = CURRENT_TIMESTAMP,
              residual_abandoned_by = $3,
              residual_abandon_reason = $4,
              residual_accepted_quantity = $5::numeric,
              residual_accepted_symbol = $6
        WHERE id = $1 AND user_id = $2
          AND residual_abandoned_at IS NULL
          AND actual_state = 'STOPPED'
          AND force_stop_reason LIKE '%cleanup_incomplete%'
        RETURNING residual_abandoned_at`,
      [
        botId,
        userId,
        input.operator,
        input.reason,
        input.quantity,
        input.symbol,
      ]
    );
    if (updated.rowCount !== 1 || !updated.rows[0]) {
      const error = new Error(
        "Residual abandonment state changed; refresh and retry"
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    // This event is the durable, self-contained audit record. Do not rely on
    // the five bot_instances columns to reconstruct history: they may be
    // cleared during a future reviewed normalization. Preserve the raw parser
    // input and the operator's accepted fallback values in event metadata.
    const abandonedAt = updated.rows[0].residual_abandoned_at;
    await client.query(
      `INSERT INTO bot_lifecycle_events
         (bot_id, event_type, from_state, to_state, correlation_id, message_id, metadata)
       VALUES ($1, 'RESIDUAL_ABANDONED', 'STOPPED', 'STOPPED', NULL, NULL, $2::jsonb)`,
      [
        botId,
        JSON.stringify({
          operator: input.operator,
          reason: input.reason,
          acceptedQuantity: input.quantity,
          symbol: input.symbol,
          resolution: input.resolution,
          force_stop_reason: input.forceStopReason,
          rawParserInput: input.forceStopReason,
          operatorFallback:
            input.resolution === "operator"
              ? {
                  acceptedQuantity: input.quantity,
                  symbol: input.symbol,
                  reason: input.reason,
                }
              : null,
          residualAbandonedAt: abandonedAt,
        }),
      ]
    );
  }

  async findUnresolvedExposureTx(
    tx: LifecycleTx,
    exchangeAccountId: string
  ): Promise<{ id: string } | null> {
    const client = clientOf(tx);
    const result = await client.query<{ id: string }>(
      `SELECT id FROM bot_instances
        WHERE exchange_account_id = $1 AND residual_abandoned_at IS NULL
          AND (actual_state = 'STOPPING'
            OR (actual_state = 'STOPPED' AND force_stop_reason LIKE '%cleanup_incomplete%'))
        ORDER BY created_at ASC LIMIT 1`,
      [exchangeAccountId]
    );
    return result.rows[0] ?? null;
  }

  async findEditBlockersTx(
    tx: LifecycleTx,
    strategyId: string
  ): Promise<EditBlockers> {
    const client = clientOf(tx);
    const runs = await client.query<{ id: string; state: string }>(
      `SELECT id, state FROM strategy_runs
        WHERE strategy_id = $1 AND state IN ('STARTING', 'RUNNING', 'STOPPING')`,
      [strategyId]
    );
    if (runs.rows.length > 0) {
      return {
        blocked: true,
        reason: `run ${runs.rows[0].id} is ${runs.rows[0].state}`,
      };
    }
    const sessions = await client.query<{ id: string; actual_state: string }>(
      `SELECT DISTINCT b.id, b.actual_state
         FROM bot_instances b JOIN strategy_runs r ON r.bot_id = b.id
        WHERE r.strategy_id = $1
          AND b.actual_state IN ('STARTING', 'RUNNING', 'STOPPING', 'UNKNOWN', 'ERROR')`,
      [strategyId]
    );
    if (sessions.rows.length > 0) {
      return {
        blocked: true,
        reason: `session ${sessions.rows[0].id} is ${sessions.rows[0].actual_state}`,
      };
    }
    const cleanup = await client.query<{ id: string }>(
      `SELECT b.id FROM bot_instances b JOIN strategy_runs r ON r.bot_id = b.id
        WHERE r.strategy_id = $1
          AND b.force_stop_reason LIKE '%cleanup_incomplete%'
          AND b.residual_abandoned_at IS NULL`,
      [strategyId]
    );
    if (cleanup.rows.length > 0) {
      return {
        blocked: true,
        reason: `session ${cleanup.rows[0].id} has incomplete venue cleanup`,
      };
    }
    const actionTail = await client.query<{ bot_id: string }>(
      `SELECT r.bot_id FROM strategy_runs r
         JOIN bot_lifecycle_events e ON e.bot_id = r.bot_id
        WHERE r.strategy_id = $1 AND e.event_type = 'RECONCILE_NEEDS_USER_ACTION'
          AND e.id = (SELECT MAX(id) FROM bot_lifecycle_events WHERE bot_id = r.bot_id)
        LIMIT 1`,
      [strategyId]
    );
    if (actionTail.rows.length > 0) {
      return {
        blocked: true,
        reason: `session ${actionTail.rows[0].bot_id} needs user action`,
      };
    }
    return { blocked: false, reason: "" };
  }

  /**
   * Retired bot-level guard (022 shim-drop): the column it read
   * (`bot_instances.strategy_id`) no longer exists. Kept as a throwing stub
   * so any missed caller fails loudly instead of querying a dropped column;
   * `findLiveRunForStrategy` is the authority. Remove entirely once the
   * migration is proven in production.
   */
  async findActiveBotForStrategy(
    _strategyId: string
  ): Promise<{ id: string } | null> {
    throw new Error(
      "findActiveBotForStrategy retired by the 022 shim-drop — use findLiveRunForStrategy"
    );
  }

  /** Insert a session in the deterministic initial STOPPED state; returns its id. */
  async insertBotInstance(
    _strategyId: string,
    userId: string,
    exchangeAccountId: string
  ): Promise<string> {
    const insertResult = await query<{ id: string }>(
      `INSERT INTO bot_instances
                (user_id, exchange_account_id, status, running_time, total_trades, total_pnl, desired_state, actual_state)
             VALUES ($1, $2, 'STOPPED', 0, 0, 0, 'STOPPED', 'STOPPED')
             RETURNING id`,
      [userId, exchangeAccountId]
    );
    return insertResult.rows[0].id;
  }

  /** Insert a session via the caller's tx — no nested transaction. */
  async insertBotInstanceTx(
    tx: LifecycleTx,
    userId: string,
    exchangeAccountId: string
  ): Promise<string> {
    const client = clientOf(tx);
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO bot_instances
                (user_id, exchange_account_id, status, running_time, total_trades, total_pnl, desired_state, actual_state)
              VALUES ($1, $2, 'STOPPED', 0, 0, 0, 'STOPPED', 'STOPPED')
              RETURNING id`,
      [userId, exchangeAccountId]
    );
    return insertResult.rows[0].id;
  }

  // ===========================================
  // STRATEGY RUNS (account sessions, plan §D / migration 019)
  // ===========================================

  /** All runs attached to a session, oldest first. */
  async getRunsForBot(botId: string): Promise<StrategyRunRow[]> {
    const result = await query<StrategyRunRow>(
      `SELECT id, bot_id, strategy_id, config_version, config, notional_amount,
              state, last_error_code, created_at, updated_at
         FROM strategy_runs
        WHERE bot_id = $1
        ORDER BY created_at ASC, id ASC`,
      [botId]
    );
    return result.rows;
  }

  /** Single run by id (ownership checked by the caller via bot_id). */
  async findRun(runId: string): Promise<StrategyRunRow | null> {
    const result = await query<StrategyRunRow>(
      `SELECT id, bot_id, strategy_id, config_version, config, notional_amount,
              state, last_error_code, created_at, updated_at
         FROM strategy_runs
        WHERE id = $1`,
      [runId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Session-aware strategy guard (022 shim-drop): the live run occupying a
   * strategy, if any — "one live run per strategy". Replaces the retired
   * bot-level `strategy_id` query; pre-D rows with no runs row simply have
   * no live run.
   */
  async findLiveRunForStrategy(
    strategyId: string
  ): Promise<StrategyRunRow | null> {
    const result = await query<StrategyRunRow>(
      `SELECT id, bot_id, strategy_id, config_version, config, notional_amount,
              state, last_error_code, created_at, updated_at
         FROM strategy_runs
        WHERE strategy_id = $1
          AND state IN ('STARTING', 'RUNNING')
        ORDER BY created_at DESC
        LIMIT 1`,
      [strategyId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * The live-or-parked session occupying an account, if any — "one live
   * session per exchange account" (migration 019 index
   * bot_instances_one_live_per_account). STOPPING excluded so the ordinary
   * stop-then-start flow keeps working.
   */
  async findLiveSessionForAccount(
    exchangeAccountId: string
  ): Promise<{ id: string } | null> {
    const result = await query<{ id: string }>(
      `SELECT id FROM bot_instances
        WHERE exchange_account_id = $1
          AND (
            actual_state IN ('STARTING', 'RUNNING')
            OR (desired_state = 'RUNNING' AND actual_state IN ('UNKNOWN', 'ERROR'))
          )
        ORDER BY created_at DESC
        LIMIT 1`,
      [exchangeAccountId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * THE single run-insert path (Arch-3): F1 notional admission — cap-guarded
   * attach with ACCOUNT-level serialization, residual capacity (Model A).
   *
   * The whole admission is one transaction so the check cannot be raced:
   *   1. lock the account's `exchange_accounts` row (`FOR UPDATE`) — ALL
   *      admits bound to this account serialize here, across sessions;
   *   2. lock the session's `bot_instances` row (`FOR UPDATE`) — belt and
   *      braces for same-session races (redundant under 1, kept because the
   *      session row is the bot's identity row in the tx);
   *   3. RECALCULATE the PENDING run sum (STOPPED + STARTING) ACCOUNT-grain
   *      while holding those locks (a sum read before the lock can be stale
   *      by insert time);
   *   4. enforce `existingExposure + pendingSum + notionalAmount <= cap`, else
   *      throw {@link RunNotionalCapExceededError} (rolls back — no run row);
   *   5. insert the STOPPED run.
   *
   * Live RUNNING runs are NOT in the pending sum — their filled notional is
   * already inside `existingExposure` (venue positions). `cap` and
   * `existingExposure` are resolved by the caller OUTSIDE this transaction (the
   * venue balance + positions calls must not hold a DB lock across network
   * I/O); only the pending sum is re-read authoritatively under the lock.
   *
   * Via the caller's client (026 locking protocol: strategy lock already
   * held, no nested transaction). The caller may already hold the account
   * lock (createAndStart via lockAccountRowTx) — re-issuing it here is an
   * idempotent no-op in the same tx.
   */
  async attachRunWithCapGuardTx(
    tx: LifecycleTx,
    botId: string,
    strategyId: string,
    config: Record<string, unknown>,
    notionalAmount: number,
    cap: number,
    existingExposure: number,
    exchangeAccountId: string
  ): Promise<string> {
    const client = clientOf(tx);
    // Serialize ALL admits on this account (not just this session) so two
    // bots bound to the same account cannot both pass on a stale pending sum.
    await client.query(
      `SELECT id FROM exchange_accounts WHERE id = $1 FOR UPDATE`,
      [exchangeAccountId]
    );
    await client.query(
      `SELECT id FROM bot_instances WHERE id = $1 FOR UPDATE`,
      [botId]
    );
    const sumResult = await client.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(notional_amount), 0) AS total
             FROM strategy_runs r
             JOIN bot_instances b ON r.bot_id = b.id
            WHERE b.exchange_account_id = $1
              AND r.state IN ('STOPPED', 'STARTING')`,
      [exchangeAccountId]
    );
    const pendingSum = Number(sumResult.rows[0]?.total ?? 0);
    if (existingExposure + pendingSum + notionalAmount > cap) {
      throw new RunNotionalCapExceededError(
        existingExposure,
        pendingSum,
        notionalAmount,
        cap
      );
    }
    const capInsert = await client.query<{ id: string }>(
      `INSERT INTO strategy_runs
                (bot_id, strategy_id, config_version, config, notional_amount, state)
              VALUES ($1, $2, 1, $3, $4, 'STOPPED')
              RETURNING id`,
      [botId, strategyId, JSON.stringify(config), notionalAmount]
    );
    return capInsert.rows[0].id;
  }

  /** CAS a run's state; returns false when the row moved underneath. */
  async setRunState(
    runId: string,
    to: string,
    expectedFrom?: string,
    errorCode?: string | null
  ): Promise<boolean> {
    const result = expectedFrom
      ? await query(
          `UPDATE strategy_runs
              SET state = $2,
                  last_error_code = COALESCE($3, last_error_code),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND state = $4`,
          [runId, to, errorCode ?? null, expectedFrom]
        )
      : await query(
          `UPDATE strategy_runs
              SET state = $2,
                  last_error_code = COALESCE($3, last_error_code),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [runId, to, errorCode ?? null]
        );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Σ notional of PENDING runs (STOPPED + STARTING) bound to an ACCOUNT —
   * the grain the cap invariant is stated at. Runs are joined through
   * bot_instances.exchange_account_id so the sum captures every session's
   * pending runs on the account, not just one bot's. Live RUNNING runs are
   * deliberately EXCLUDED — their filled notional is already inside the
   * venue exposure read by the cap provider.
   */
  async sumPendingRunNotionalForAccount(
    exchangeAccountId: string
  ): Promise<number> {
    const result = await query<{ total: string | null }>(
      `SELECT COALESCE(SUM(notional_amount), 0) AS total
         FROM strategy_runs r
         JOIN bot_instances b ON r.bot_id = b.id
        WHERE b.exchange_account_id = $1
          AND r.state IN ('STOPPED', 'STARTING')`,
      [exchangeAccountId]
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  /** Detach a STOPPED run (history of live runs stays for audit). */
  async detachRun(runId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM strategy_runs WHERE id = $1 AND state = 'STOPPED'`,
      [runId]
    );
    return (result.rowCount ?? 0) === 1;
  }

  // ===========================================
  // LIFECYCLE RECONCILIATION QUERIES
  // ===========================================

  /** Bots the user wants stopped but the engine still reports as active. */
  async findDesiredStoppedButActiveBots(): Promise<BotRow[]> {
    const result = await query<BotRow>(
      `SELECT ${BotLifecycleRepositoryAdapter.BOT_COLUMNS}
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
      `SELECT b.id, b.user_id, b.status, b.desired_state, b.actual_state, b.engine_id, b.exchange_account_id
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
      `SELECT ${BotLifecycleRepositoryAdapter.BOT_COLUMNS}
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
