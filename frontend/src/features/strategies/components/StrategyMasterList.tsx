/** @format */

import React from "react";
import { Strategy } from "../../../shared/types";
import { cn } from "../../../shared/utils";
import { BotStatusBadge } from "./BotStatusBadge";
import { strategyService } from "../services/strategyService";
import {
  getStrategyConfig,
  getSessionForStrategy,
  type BotInstance,
} from "../types/strategies.types";

/**
 * StrategyMasterList — the master half of the Phase 3 master–detail
 * Strategies page: one compact, selectable row per strategy with its state
 * at a glance (enabled/disabled, market, live bot state via the hosting
 * session). The selection drives the StrategyWorkspace beside it; each row
 * is a real button, so keyboard navigation and screen-reader semantics come
 * for free (`aria-current` marks the workspace's strategy).
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

export const StrategyMasterList: React.FC<StrategyMasterListProps> = ({
  strategies,
  bots,
  selectedId,
  onSelect,
}) => (
  <div className="glass-card p-4 space-y-3">
    <div className="flex items-baseline justify-between">
      <h2 className="text-lg font-semibold text-text">Strategies</h2>
      <span className="text-xs text-textMuted">{strategies.length} total</span>
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
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-xs text-textMuted capitalize truncate">
                  {strategyService.formatStrategyType(strategy.type)} ·{" "}
                  {displaySymbol(symbol)}
                </span>
                {bot && <BotStatusBadge bot={bot} hideDetail />}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  </div>
);
