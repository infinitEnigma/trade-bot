/** @format */

import React from "react";
import { formatNotional } from "../../../shared/utils/number";
import type { BotInstance } from "../types/strategies.types";
import { computeRunNotionalAllocation } from "../utils/runNotionalAllocation";

interface Props {
  bots: BotInstance[];
}

export const RunNotionalAllocationTile: React.FC<Props> = ({ bots }) => {
  const result = computeRunNotionalAllocation(bots);

  // `bots` empty → tile is hidden per spec.
  if (bots.length === 0) return null;

  // Nothing configured (no runs on any bot) → visible `—` tile.
  if (!result.hasRuns) {
    return (
      <div
        className="glass-card p-4 flex items-center gap-3 opacity-80"
        title="No runs configured across strategies"
      >
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
          <span className="text-sm">—</span>
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold text-text">—</div>
          <div className="text-xs text-textMuted truncate">
            Configured run notional
          </div>
        </div>
      </div>
    );
  }

  // Any invalid run or overflow → aggregate `—`, never a partial sum.
  if (result.hasInvalid || result.overflow) {
    return (
      <div
        className="glass-card p-4 flex items-center gap-3"
        title="Sum of configured run notionals is unavailable — some runs have non-numeric, missing, or negative notional amounts"
      >
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
          <span className="text-sm text-warning">—</span>
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold text-text">—</div>
          <div className="text-xs text-textMuted truncate">
            Configured run notional
          </div>
        </div>
      </div>
    );
  }

  // Valid aggregate (including a real zero).
  return (
    <div
      className="glass-card p-4 flex items-center gap-3"
      title="Sum of configured run notionals across non-detached runs; configuration fact only, not exchange exposure or collateral commitment"
    >
      <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
        <span className="text-sm">Σ</span>
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-text">
          {formatNotional(String(result.total))}
        </div>
        <div className="text-xs text-textMuted truncate">
          Run notional allocation · {result.count} run
          {result.count === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
};
