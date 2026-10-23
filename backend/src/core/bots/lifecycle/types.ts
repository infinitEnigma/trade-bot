/**
 * Bot lifecycle shared types - used by the lifecycle components
 * (repository, dispatcher, notifier, event processor, orchestrator).
 *
 * @format
 */

import { BotActualState, BotDesiredState } from "@trade-bot/shared";

export interface BotLifecycleResult {
  botId: string;
  desiredState: BotDesiredState;
  actualState: BotActualState;
  correlationId?: string;
}

export interface BotRow {
  id: string;
  user_id: string;
  status: string;
  desired_state: BotDesiredState;
  actual_state: BotActualState;
  engine_id: string | null;
  /** Bound venue account (C3a, migration 013). NULL for legacy unbound rows. */
  exchange_account_id: string | null;
}

/**
 * One strategy execution inside a session (migration 019, plan §D).
 * `config` is the snapshot copied at attach time; `state` tracks the run.
 */
export interface StrategyRunRow {
  id: string;
  bot_id: string;
  strategy_id: string;
  config_version: number;
  config: Record<string, unknown>;
  notional_amount: string;
  state: string;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

/** Run states that occupy a strategy or count toward the session cap. */
export const LIVE_RUN_STATES = ["STARTING", "RUNNING"] as const;

/**
 * Run states that count toward the account's PENDING exposure — the grain the
 * F1 cap invariant is stated at.
 *
 * - STOPPED: a prepared-but-not-admitted run (requested, not yet reflected in
 *   venue exposure).
 * - STARTING: a run the engine is starting.
 * - AUTHORIZATION_PENDING: a run the backend has ADMITTED (its
 *   notional_amount is the backend's validated exposure) but whose execution
 *   the engine has not yet acknowledged. It carries real exposure that the
 *   venue positions do not yet reflect, so it MUST be counted — excluding it
 *   would let two concurrent admissions each pass the cap against the same
 *   remaining capacity.
 *
 * Live RUNNING runs are deliberately NOT here: their filled notional is already
 * inside the venue exposure read.
 */
export const PENDING_EXPOSURE_RUN_STATES = [
  "STOPPED",
  "STARTING",
  "AUTHORIZATION_PENDING",
] as const;

/**
 * The state a run holds while the engine is preparing it. NOT admitted, NOT
 * authorized, may NOT trade, and reserves NO exposure — the row exists so the
 * engine can resolve the bot and its credentials, and its existence grants
 * nothing.
 */
export const PREPARING_RUN_STATE = "PREPARING";

/**
 * The state a run holds after the backend admitted it and before the engine
 * acknowledged execution. It RESERVES the backend's validated notional, but it
 * may not place orders until the authorization succeeds.
 */
export const AUTHORIZATION_PENDING_RUN_STATE = "AUTHORIZATION_PENDING";

/**
 * Run states that may NOT trade.
 *
 * A prepared run is not an admitted run, and an admitted run is not an
 * executing run. These states are the non-tradable half of that distinction.
 */
export const NON_TRADABLE_RUN_STATES = [
  PREPARING_RUN_STATE,
  AUTHORIZATION_PENDING_RUN_STATE,
] as const;

/** Map actual_state to the legacy single `status` column. */
export const STATUS_BY_ACTUAL: Record<BotActualState, string> = {
  STOPPED: "STOPPED",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  STOPPING: "STOPPING",
  ERROR: "ERROR",
  UNKNOWN: "ERROR",
  // PREPARED = the engine priced the grid and reported its estimate; the
  // backend has not admitted it yet, so it is NOT running. The legacy
  // `status` column has no PREPARED value, so it maps to STARTING (the
  // session is mid-startup and has not failed).
  PREPARED: "STARTING",
};

export interface PersistTransitionInput {
  desiredState: BotDesiredState;
  actualState: BotActualState;
  engineId?: string | null;
  startedAt?: Date | null;
  stoppedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface LifecycleEventInput {
  eventType: string;
  fromState: string | null;
  toState: string | null;
  correlationId: string | null;
  messageId: string | null;
  metadata: Record<string, unknown>;
}

/** How long a PENDING command may wait for the engine before it times out. */
export const BOT_COMMAND_TIMEOUT_MS = Number(
  process.env.BOT_COMMAND_TIMEOUT_MS ?? 30_000
);

/**
 * The tail of a bot's lifecycle audit trail — enough to tell whether an
 * unresolved `RECONCILE_NEEDS_USER_ACTION` marker is already the latest row
 * (P0-3). `metadata` is the jsonb column, returned already parsed.
 */
export interface LifecycleEventRow {
  event_type: string;
  from_state: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Max automatic BOT_STOP re-issues per bot per hour before repair attempts are
 * deferred. Shared by the lifecycle reconciler and the terminal-state stop
 * repair (L24) so both bound themselves identically against a dead engine.
 */
export const MAX_STOP_REISSUES_PER_HOUR = Number(
  process.env.LIFECYCLE_RECONCILE_MAX_STOP_REISSUES ?? 3
);

/**
 * Marker the engine puts in the terminal STATE_CHANGED `reason` when a panic
 * stop could not finish its venue-side cleanup (M1). The row converges to
 * STOPPED either way — the stop itself succeeded — so this marker is the only
 * signal that orders/position may still be live on the venue. The processor
 * copies such a reason into `bot_instances.force_stop_reason`, which nothing
 * else rewrites, so the fact survives the next transition and stays queryable
 * by operators. Wire contract: keep in sync with the engine's
 * `CLEANUP_INCOMPLETE_MARKER`.
 */
export const CLEANUP_INCOMPLETE_MARKER = "cleanup_incomplete";

/** A tracked lifecycle command awaiting engine confirmation. */
export interface TrackedCommandRow {
  correlation_id: string;
  bot_id: string;
  command_type: string;
}

/**
 * Reason for a command timeout - used to determine the appropriate
 * state transition and provide better diagnostics.
 */
export enum TimeoutReason {
  /** Engine never received the command (e.g., Redis failure) */
  COMMAND_NEVER_DELIVERED = "COMMAND_NEVER_DELIVERED",
  /** Engine received command but never responded (e.g., engine crash) */
  ENGINE_NO_RESPONSE = "ENGINE_NO_RESPONSE",
  /** Bot is in unexpected state (e.g., RUNNING when START timed out) */
  STATE_MISMATCH = "STATE_MISMATCH",
  /** STOP command timed out while bot was stopping */
  STOP_INCOMPLETE = "STOP_INCOMPLETE",
}

/**
 * Determine the appropriate timeout reason based on command type and bot state.
 */
export function getTimeoutReason(
  commandType: string,
  botState: BotActualState
): TimeoutReason {
  if (commandType === "BOT_START" && botState === "RUNNING") {
    // Bot is already running - engine likely processed the start but events were lost
    return TimeoutReason.STATE_MISMATCH;
  }
  if (
    (commandType === "BOT_STOP" || commandType === "EMERGENCY_STOP") &&
    botState === "STOPPING"
  ) {
    // Stop was initiated but never completed
    return TimeoutReason.STOP_INCOMPLETE;
  }
  if (botState === "STARTING") {
    // Engine never confirmed the start
    return TimeoutReason.ENGINE_NO_RESPONSE;
  }
  return TimeoutReason.COMMAND_NEVER_DELIVERED;
}

/**
 * Determine the target state for a timed-out command based on the timeout reason.
 */
export function getTimeoutTargetState(
  reason: TimeoutReason,
  _commandType: string
): BotActualState {
  switch (reason) {
    case TimeoutReason.STATE_MISMATCH:
      // Bot is in an unexpected state - mark as UNKNOWN for reconciliation
      return "UNKNOWN";
    case TimeoutReason.STOP_INCOMPLETE:
      // Stop didn't complete - engine state is unclear
      return "UNKNOWN";
    case TimeoutReason.ENGINE_NO_RESPONSE:
    case TimeoutReason.COMMAND_NEVER_DELIVERED:
    default:
      // Engine never responded - error
      return "ERROR";
  }
}
