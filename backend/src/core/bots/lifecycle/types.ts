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
  strategy_id: string;
  status: string;
  desired_state: BotDesiredState;
  actual_state: BotActualState;
  engine_id: string | null;
  /** Bound venue account (C3a, migration 013). NULL for legacy unbound rows. */
  exchange_account_id: string | null;
}

/** Map actual_state to the legacy single `status` column. */
export const STATUS_BY_ACTUAL: Record<BotActualState, string> = {
  STOPPED: "STOPPED",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  STOPPING: "STOPPING",
  ERROR: "ERROR",
  UNKNOWN: "ERROR",
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
