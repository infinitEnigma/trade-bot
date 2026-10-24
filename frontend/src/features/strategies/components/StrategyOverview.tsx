/** @format */

import React, { useMemo } from "react";
import {
  Play,
  Square,
  OctagonAlert,
  Activity,
  DollarSign,
  AlertTriangle,
  Receipt,
} from "lucide-react";
import { cn } from "../../../shared/utils";
import { BotInstance } from "../types/strategies.types";
import { summarizeBotStates } from "../utils/summarizeBotStates";
import { useStrategyPerformanceSummary } from "../hooks";

/**
 * StrategyOverview — a compact operational strip: how many bots are Running,
 * Stopped, and Needs attention. These are REAL counts derived from live bot
 * lifecycle state, not invented performance metrics — a navigation aid that
 * answers "is anything running / is anything wrong?" at a glance, above the
 * card list.
 *
 * Phase 1: also shows lifetime realized PnL and unknown-PnL fill count,
 * derived from the shared fill-ledger aggregate (the same data as the
 * master-list chips). Buckets remain mutually exclusive and sum to the total.
 */
interface StatProps {
  icon: React.ReactNode;
  label: string;
  count: number | string;
  accent: string;
  /** Dim the tile when the count is zero (nothing to draw the eye to). */
  muted?: boolean;
  /** Optional tooltip shown on hover. */
  title?: string;
}

const Stat: React.FC<StatProps> = ({
  icon,
  label,
  count,
  accent,
  muted,
  title,
}) => (
  <div
    className={cn(
      "glass-card p-4 flex items-center gap-3",
      muted && count === 0 && "opacity-60"
    )}
    title={title}
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
  const {
    performance: summary,
    isLoading,
    error,
  } = useStrategyPerformanceSummary();

  // Aggregate across all strategies owned by the user. Each strategy's
  // realizedPnl already excludes unknown fills; unknownPnlFills is summed
  // separately so the total can be flagged as incomplete.
  const aggregated = useMemo(() => {
    if (!summary)
      return {
        realizedPnl: 0,
        unknownPnlFills: 0,
        unknownFeeFills: 0,
        count: 0,
      };
    let realizedPnl = 0;
    let unknownPnlFills = 0;
    let unknownFeeFills = 0;
    let count = 0;
    for (const perf of Object.values(summary)) {
      realizedPnl += perf.totalPnL;
      unknownPnlFills += perf.unknownPnlFills;
      unknownFeeFills += perf.unknownFeeFills;
      count += perf.totalTrades;
    }
    return { realizedPnl, unknownPnlFills, unknownFeeFills, count };
  }, [summary]);

  // Distinguish loading/error from a genuine zero. While fetching, show a
  // placeholder; on error, show the operational counts only (no fabricated
  // PnL). When loaded, zero is a real zero (no fills).
  const pnlUnavailable = isLoading && !summary;
  const pnlError = Boolean(error) && !summary;

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
        <Stat
          icon={<DollarSign className="w-4 h-4 text-text" />}
          label={
            pnlError || pnlUnavailable
              ? "Realized PnL"
              : aggregated.unknownPnlFills > 0
                ? "Realized PnL (incomplete)"
                : "Realized PnL"
          }
          count={
            pnlUnavailable || pnlError
              ? "—"
              : Math.round(aggregated.realizedPnl * 100) / 100
          }
          accent={
            aggregated.realizedPnl > 0
              ? "bg-success/10"
              : aggregated.realizedPnl < 0
                ? "bg-danger/10"
                : "bg-white/5"
          }
          muted={pnlUnavailable || pnlError}
          title={
            pnlUnavailable
              ? "Loading…"
              : pnlError
                ? "Unavailable"
                : `Lifetime realized PnL across all strategies${aggregated.unknownPnlFills > 0 ? ` — ${aggregated.unknownPnlFills} unknown-PnL fills excluded` : ""}`
          }
        />
        <Stat
          icon={<AlertTriangle className="w-4 h-4 text-warning" />}
          label="Unknown-PnL fills"
          count={
            pnlUnavailable || pnlError ? "—" : aggregated.unknownPnlFills
          }
          accent="bg-warning/10"
          muted={pnlUnavailable || pnlError}
          title={
            pnlUnavailable
              ? "Loading…"
              : pnlError
                ? "Unavailable"
                : `Fills booked with unknown PnL — excluded from realized PnL and win rate${aggregated.unknownPnlFills === 0 ? " (none)" : ""}`
          }
        />
        <Stat
          icon={<Receipt className="w-4 h-4 text-warning" />}
          label="Unknown-fee fills"
          count={
            pnlUnavailable || pnlError ? "—" : aggregated.unknownFeeFills
          }
          accent="bg-warning/10"
          muted={pnlUnavailable || pnlError}
          title={
            pnlUnavailable
              ? "Loading…"
              : pnlError
                ? "Unavailable"
                : `Fills with unknown fees — fee totals exclude these fills${aggregated.unknownFeeFills === 0 ? " (none)" : ""}`
          }
        />
      </div>
    </div>
  );
};
