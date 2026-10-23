/** @format */

import React, { useMemo } from "react";
import { Strategy } from "../../../shared/types";
import { cn, formatCurrency, getValueColorClass } from "../../../shared/utils";
import { BotStatusBadge } from "./BotStatusBadge";
import { strategyService } from "../services/strategyService";
import {
  getStrategyConfig,
  getSessionForStrategy,
  type BotInstance,
} from "../types/strategies.types";
import { useStrategyPerformanceSummary } from "../hooks";

/**
 * StrategyMasterList — the master half of the Phase 3 master–detail
 * Strategies page: one compact, selectable row per strategy with its state
 * at a glance (enabled/disabled, market, live bot state via the hosting
 * session). The selection drives the StrategyWorkspace beside it; each row
 * is a real button, so keyboard navigation and screen-reader semantics come
 * for free (`aria-current` marks the workspace's strategy).
 *
 * Phase 1: each row also shows a lifetime realized-PnL chip from the
 * fill-ledger aggregate (restart-safe, unlike session counters). Unknown-PnL
 * fills are flagged honestly — never folded into the number as a loss.
 */
interface StrategyMasterListProps {
  strategies: Strategy[];
  /** Live sessions (D4) — rows resolve their bot badge through them. */
  bots: BotInstance[];
  /** Id of the strategy the workspace currently shows. */
  selectedId?: string;
  onSelect: (strategy: Strategy) => void;
}

/** Card-era symbol display: `PERP_BTC_USDC` → `BTC`. */
const displaySymbol = (symbol: string | undefined) =>
  symbol ? symbol.replace("PERP_", "").replace("_USDC", "") || "N/A" : "N/A";

/**
 * PnL chip for one strategy row. Distinguishes loading, error, zero, and
 * unavailable states — never falls back to session PnL, never fabricates
 * zeros for missing data.
 */
function StrategyPnlChip({
  strategyId,
  performance,
  isLoading,
  error,
}: {
  strategyId: string;
  performance: Record<
    string,
    import("../../../infrastructure/api/trading").StrategyPerformance
  > | null;
  isLoading: boolean;
  error: unknown;
}) {
  const perf = performance?.[strategyId];

  // Still fetching — show a subtle placeholder, not a number.
  if (isLoading && !perf) {
    return <span className="text-xs text-textMuted shrink-0">…</span>;
  }

  // Fetch failed — show unavailable honestly, never a fabricated zero.
  if (error && !perf) {
    return (
      <span className="text-xs text-textMuted shrink-0" title="PnL unavailable">
        —
      </span>
    );
  }

  // No data at all (no fills, or not yet loaded) — show zero as a real zero,
  // not "unavailable".
  if (!perf) {
    return <span className="text-xs text-textMuted shrink-0">$0.00</span>;
  }

  const { totalPnL, unknownPnlFills } = perf;
  const colorClass = getValueColorClass(totalPnL);
  const incomplete =
    unknownPnlFills > 0 ? ` (incomplete, ${unknownPnlFills} unknown)` : "";

  return (
    <span
      className={cn("text-xs font-medium shrink-0", colorClass)}
      title={`Lifetime realized PnL${incomplete}`}
    >
      {formatCurrency(totalPnL)}
      {incomplete}
    </span>
  );
}

export const StrategyMasterList: React.FC<StrategyMasterListProps> = ({
  strategies,
  bots,
  selectedId,
  onSelect,
}) => {
  const {
    performance: summary,
    isLoading,
    error,
  } = useStrategyPerformanceSummary();

  // Memoized lookup so each row doesn't re-derive on every render.
  const perfByStrategy = useMemo(() => summary ?? {}, [summary]);

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-text">Strategies</h2>
        <span className="text-xs text-textMuted">
          {strategies.length} total
        </span>
      </div>
      <ul className="space-y-1.5">
        {strategies.map(strategy => {
          const bot = getSessionForStrategy(bots, strategy.id);
          const selected = strategy.id === selectedId;
          const symbol = getStrategyConfig(strategy)?.config.symbol;
          return (
            <li key={strategy.id}>
              <button
                type="button"
                onClick={() => onSelect(strategy)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2.5 border transition-colors",
                  selected
                    ? "border-primary/40 bg-primary/10"
                    : "border-transparent hover:bg-white/5"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text truncate">
                    {strategy.name}
                  </span>
                  <StrategyPnlChip
                    strategyId={strategy.id}
                    performance={perfByStrategy}
                    isLoading={isLoading}
                    error={error}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-textMuted capitalize truncate">
                    {strategyService.formatStrategyType(strategy.type)} ·{" "}
                    {displaySymbol(symbol)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 px-1.5 py-0.5 text-[10px] rounded-full",
                        strategy.active
                          ? "bg-success/20 text-success"
                          : "bg-gray-500/20 text-gray-400"
                      )}
                      title={
                        strategy.active
                          ? "Strategy enabled — a bot can run on it."
                          : "Strategy disabled — no bot can run on it."
                      }
                    >
                      {strategy.active ? "Enabled" : "Disabled"}
                    </span>
                    {bot && <BotStatusBadge bot={bot} hideDetail />}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
