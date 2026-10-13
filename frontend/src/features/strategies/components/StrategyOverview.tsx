/** @format */

import React from "react";
import { Play, Square, OctagonAlert, Activity } from "lucide-react";
import { cn } from "../../../shared/utils";
import { BotInstance } from "../types/strategies.types";
import { summarizeBotStates } from "../utils/summarizeBotStates";

/**
 * StrategyOverview — a compact operational strip: how many bots are Running,
 * Stopped, and Needs attention. These are REAL counts derived from live bot
 * lifecycle state, not invented performance metrics — a navigation aid that
 * answers "is anything running / is anything wrong?" at a glance, above the
 * card list.
 *
 * Buckets are mutually exclusive (priority: needs-attention > running >
 * transitional > stopped) so they always sum to the total, never double-count.
 * The pure summarizer lives in ../utils/summarizeBotStates.
 */

interface StatProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  accent: string;
  /** Dim the tile when the count is zero (nothing to draw the eye to). */
  muted?: boolean;
}

const Stat: React.FC<StatProps> = ({ icon, label, count, accent, muted }) => (
  <div
    className={cn(
      "glass-card p-4 flex items-center gap-3",
      muted && count === 0 && "opacity-60"
    )}
  >
    <div
      className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
        accent
      )}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <div className="text-2xl font-bold text-text leading-tight">{count}</div>
      <div className="text-xs text-textMuted truncate">{label}</div>
    </div>
  </div>
);

interface StrategyOverviewProps {
  bots: BotInstance[];
}

export const StrategyOverview: React.FC<StrategyOverviewProps> = ({ bots }) => {
  const s = summarizeBotStates(bots);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-text">Overview</h2>
        <span className="text-xs text-textMuted">
          {s.total} bot{s.total === 1 ? "" : "s"} total
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={<Play className="w-4 h-4 text-success" />}
          label="Running"
          count={s.running}
          accent="bg-success/10"
          muted
        />
        <Stat
          icon={<Activity className="w-4 h-4 text-warning" />}
          label="Starting / stopping"
          count={s.transitional}
          accent="bg-warning/10"
          muted
        />
        <Stat
          icon={<OctagonAlert className="w-4 h-4 text-danger" />}
          label="Needs attention"
          count={s.needsAttention}
          accent="bg-danger/10"
          muted
        />
        <Stat
          icon={<Square className="w-4 h-4 text-textMuted" />}
          label="Stopped"
          count={s.stopped}
          accent="bg-white/5"
          muted
        />
      </div>
    </div>
  );
};
