/** @format */

import React, { useState } from "react";
import {
  ChevronDown,
  AlertTriangle,
  Clock,
  CircleSlash,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "../../../shared/utils";
import { formatNotional } from "../../../shared/utils/number";
import { formatRelativeDate } from "../../../shared/utils/relativeTime";
import type { StrategyRun } from "../types/strategies.types";

/**
 * Per-run state rendering.
 *
 * A run's lifecycle state is a *run* fact, NEVER a proxy for bot status:
 * a run in ERROR or AUTHORIZATION_PENDING must never drive the bot-level
 * operator-action banner or change the control surface.
 */
interface RunStateStyle {
  label: string;
  className: string;
  glyph: "spinner" | "ok" | "stopped" | "attention" | "neutral";
}

/** Run-state label map. Keys are the DB run states (019/031 CHECK). */
const RUN_STATE_STYLE: Record<string, RunStateStyle> = {
  STOPPED: {
    label: "Stopped",
    className: "bg-white/10 text-textMuted",
    glyph: "stopped",
  },
  STARTING: {
    label: "Starting",
    className: "bg-warning/20 text-warning",
    glyph: "spinner",
  },
  RUNNING: {
    label: "Running",
    className: "bg-success/20 text-success",
    glyph: "ok",
  },
  STOPPING: {
    label: "Stopping",
    className: "bg-warning/20 text-warning",
    glyph: "spinner",
  },
  ERROR: {
    label: "Error",
    className: "bg-amber/20 text-amber-300",
    glyph: "attention",
  },
  PREPARING: {
    label: "Preparing",
    className: "bg-white/10 text-textMuted",
    glyph: "neutral",
  },
  AUTHORIZATION_PENDING: {
    label: "Authorization pending",
    className: "bg-white/10 text-textMuted",
    glyph: "neutral",
  },
};

function getRunStateStyle(state: string): RunStateStyle {
  return (
    RUN_STATE_STYLE[state] ?? {
      label: "?",
      className: "bg-white/10 text-textMuted",
      glyph: "neutral",
    }
  );
}

function RunStatusBadge({ state }: { state: string }) {
  const style = getRunStateStyle(state);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
        style.className
      )}
      aria-label={`Run state: ${style.label}`}
    >
      {style.glyph === "spinner" && (
        <Loader2 className="w-3 h-3 animate-spin" />
      )}
      {style.glyph === "ok" && <CheckCircle2 className="w-3 h-3" />}
      {style.glyph === "stopped" && <CircleSlash className="w-3 h-3" />}
      {style.glyph === "attention" && <AlertTriangle className="w-3 h-3" />}
      {style.glyph === "neutral" && <Clock className="w-3 h-3" />}
      {style.label}
    </span>
  );
}

/** Short display for a run UUID (last 8 chars + ellipsis), full id in tooltip. */
function ShortRunId({ id }: { id: string }) {
  const short = id.length > 8 ? `…${id.slice(-8)}` : id;
  return (
    <span title={id} className="font-mono text-xs text-textMuted tabular-nums">
      {short}
    </span>
  );
}

interface RunHistoryItemProps {
  run: StrategyRun;
  index: number;
}

function RunHistoryItem({ run, index }: RunHistoryItemProps) {
  const relativeAge = formatRelativeDate(run.created_at);
  const notional = formatNotional(run.notional_amount);

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <RunStatusBadge state={run.state} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-textMuted">
            <span>Run {index + 1}</span>
            <span>Notional {notional}</span>
            <span>Created {relativeAge || "—"}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-textMuted" aria-label="Run ID">
          Run ID
        </span>
        <ShortRunId id={run.id} />
      </div>
    </div>
  );
}

interface RunHistoryPanelProps {
  runs?: StrategyRun[];
}

/**
 * Run-history panel (Phase B2):
 *
 * - `runs.length === 0` → hidden (null).
 * - `runs.length === 1` → collapsed to a single summary row; expand to reveal
 *   the full run UUID.
 * - `runs.length > 1` → expanded list by default.
 *
 * Report-only: state badge, configured notional (as configured, not exposure),
 * and creation age. This component deliberately does not read or calculate
 * PnL, and history must never look like a live feed.
 */
export const RunHistoryPanel: React.FC<RunHistoryPanelProps> = ({ runs }) => {
  const [expanded, setExpanded] = useState(false);

  if (!runs || runs.length === 0) {
    return null;
  }

  const hasMultiple = runs.length > 1;

  return (
    <section className="border-t border-white/5 pt-4" aria-label="Run history">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text">Run history</h3>
        <span className="text-xs text-textMuted">
          {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
      </div>

      {hasMultiple ? (
        <div role="list" aria-label="Run history list">
          {/* Keep the API's chronological oldest-to-newest order. */}
          {runs.map((run, index) => (
            <div role="listitem" key={run.id}>
              <RunHistoryItem run={run} index={index} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="run-history-details"
            aria-label={`${expanded ? "Collapse" : "Expand"} run history details`}
            className="w-full flex items-center justify-between gap-4 px-3 py-2 rounded-lg text-sm transition hover:bg-white/5"
            onClick={() => setExpanded(open => !open)}
          >
            <div className="flex min-w-0 items-center gap-3">
              <RunStatusBadge state={runs[0].state} />
              <span className="text-xs text-textMuted">
                Notional {formatNotional(runs[0].notional_amount)} · Created{" "}
                {formatRelativeDate(runs[0].created_at) || "—"}
              </span>
              <ShortRunId id={runs[0].id} />
            </div>
            <ChevronDown
              className={cn(
                "w-4 h-4 shrink-0 text-textMuted transition-transform",
                expanded && "rotate-180"
              )}
            />
          </button>
          <div
            id="run-history-details"
            className="px-3 py-2 text-xs text-textMuted"
            hidden={!expanded}
          >
            <span>Full Run ID: </span>
            <code className="font-mono">{runs[0].id}</code>
          </div>
        </>
      )}
    </section>
  );
};

export default RunHistoryPanel;
