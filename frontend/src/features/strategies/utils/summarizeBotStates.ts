/** @format */

import type { BotInstance } from "../types/strategies.types";

export interface BotStateSummary {
  running: number;
  transitional: number;
  stopped: number;
  needsAttention: number;
  total: number;
}

/**
 * Pure summarizer for the StrategyOverview strip (kept out of the component
 * file so `react-refresh/only-export-components` stays clean). Priority order
 * makes the buckets disjoint:
 *  1. needsAttention — a reconcile-park (`needsUserAction`) or a lost/errored
 *     engine (`UNKNOWN`/`ERROR`): the operator must act.
 *  2. running — actively trading.
 *  3. transitional — STARTING/STOPPING (in flight, not a failure).
 *  4. stopped — ready to start.
 */
export function summarizeBotStates(
  bots: Array<Pick<BotInstance, "status" | "needsUserAction">>
): BotStateSummary {
  const summary: BotStateSummary = {
    running: 0,
    transitional: 0,
    stopped: 0,
    needsAttention: 0,
    total: bots.length,
  };

  for (const bot of bots) {
    if (
      bot.needsUserAction ||
      bot.status === "UNKNOWN" ||
      bot.status === "ERROR"
    ) {
      summary.needsAttention += 1;
    } else if (bot.status === "RUNNING") {
      summary.running += 1;
    } else if (bot.status === "STARTING" || bot.status === "STOPPING") {
      summary.transitional += 1;
    } else {
      // STOPPED (and any future terminal state) — ready to start.
      summary.stopped += 1;
    }
  }

  return summary;
}
