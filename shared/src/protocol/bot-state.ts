/**
 * Bot Lifecycle State Machine - Single source of truth for bot states
 *
 * Distinguishes between:
 * - desired_state: what the backend/user wants (RUNNING | STOPPED)
 * - actual_state:  what the engine reports (STOPPED | STARTING | RUNNING | STOPPING | ERROR | UNKNOWN)
 *
 * The API must never declare a bot RUNNING before the engine confirms it via
 * STATE_CHANGED. All actual-state mutations must go through assertTransition().
 *
 * @format
 */

// ===========================================
// STATE TYPES
// ===========================================

/**
 * Actual lifecycle state as reported by the engine.
 * UNKNOWN means the engine is unreachable / heartbeat lost (reserved for a later milestone).
 */
export type BotActualState =
  "STOPPED" | "STARTING" | "RUNNING" | "STOPPING" | "ERROR" | "UNKNOWN";

/**
 * Desired lifecycle state - what the backend/user wants.
 */
export type BotDesiredState = "RUNNING" | "STOPPED";

export const BOT_ACTUAL_STATES: readonly BotActualState[] = [
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "ERROR",
  "UNKNOWN",
];

export const BOT_DESIRED_STATES: readonly BotDesiredState[] = [
  "RUNNING",
  "STOPPED",
];

// ===========================================
// VALID TRANSITIONS
// ===========================================

/**
 * Legal actual-state transitions. Anything not listed here is invalid and
 * must be rejected by assertTransition().
 *
 *   STOPPED  ──START──▶ STARTING ──confirm──▶ RUNNING ──STOP──▶ STOPPING ──confirm──▶ STOPPED
 *   STARTING ──failure──▶ ERROR | STOPPED
 *   RUNNING  ──failure──▶ ERROR | UNKNOWN
 *   STOPPING ──failure──▶ ERROR
 *   UNKNOWN  ──reconnect──▶ RUNNING | STOPPED | ERROR
 *   ERROR    ──retry──▶ STARTING | STOPPED
 */
export const VALID_TRANSITIONS: Record<
  BotActualState,
  readonly BotActualState[]
> = {
  STOPPED: ["STARTING"],
  STARTING: ["RUNNING", "STOPPED", "ERROR"],
  RUNNING: ["STOPPING", "ERROR", "UNKNOWN"],
  STOPPING: ["STOPPED", "ERROR"],
  UNKNOWN: ["RUNNING", "STOPPED", "ERROR"],
  ERROR: ["STARTING", "STOPPED"],
};

/**
 * Error thrown when an illegal state transition is attempted.
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: BotActualState,
    public readonly to: BotActualState
  ) {
    super(`Invalid bot state transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Check whether a transition between actual states is legal.
 */
export function canTransition(
  from: BotActualState,
  to: BotActualState
): boolean {
  if (from === to) {
    // Self-transitions are treated as no-ops, not errors.
    return true;
  }
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * The only legal way to mutate actual lifecycle state.
 * Throws InvalidStateTransitionError for illegal transitions.
 * Returns the target state on success (allows `actual = assertTransition(actual, next)`).
 */
export function assertTransition(
  from: BotActualState,
  to: BotActualState
): BotActualState {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
  return to;
}

/**
 * Type guard for BotActualState.
 */
export function isBotActualState(value: unknown): value is BotActualState {
  return (
    typeof value === "string" &&
    (BOT_ACTUAL_STATES as readonly string[]).includes(value)
  );
}

/**
 * Type guard for BotDesiredState.
 */
export function isBotDesiredState(value: unknown): value is BotDesiredState {
  return (
    typeof value === "string" &&
    (BOT_DESIRED_STATES as readonly string[]).includes(value)
  );
}
