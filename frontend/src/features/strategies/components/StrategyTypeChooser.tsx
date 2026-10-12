/** @format */

/**
 * StrategyTypeChooser — first step of the CREATE flow (per-type form split).
 *
 * One card per strategy type. Only types the engine actually implements are
 * clickable: Grid is the live path (the engine has exactly one strategy,
 * `GridTradingStrategy`; `bot-manager.ts` resolves every run through
 * `resolveGridConfig`). Trend Following and Arbitrage are product-planned —
 * their cards render disabled with "Coming soon" so the roadmap is visible
 * without offering a create path that would silently start a default GRID
 * (the exact dishonesty the old type-`<select>` allowed).
 *
 * When a type ships, its card enables and its own form mounts in
 * `StrategyForm` — no shared form grows conditional sections for it.
 */

import React from "react";
import { Grid3x3, TrendingUp, ArrowLeftRight } from "lucide-react";
import { StrategyType } from "../../../shared/types";

interface StrategyTypeChooserProps {
  onSelect: (type: StrategyType) => void;
}

interface TypeCard {
  type: StrategyType;
  title: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  badge?: string;
}

const TYPE_CARDS: TypeCard[] = [
  {
    type: StrategyType.GRID,
    title: "Grid Trading",
    description:
      "Place a ladder of buy/sell levels around a baseline price and harvest the range.",
    icon: <Grid3x3 className="w-6 h-6 text-primary" />,
  },
  {
    type: StrategyType.TREND_FOLLOWING,
    title: "Trend Following",
    description:
      "Ride sustained moves with entry/exit thresholds and stop-loss risk control.",
    icon: <TrendingUp className="w-6 h-6 text-textMuted" />,
    disabled: true,
    badge: "Coming soon",
  },
  {
    type: StrategyType.ARBITRAGE,
    title: "Arbitrage",
    description:
      "Capture price differences between markets with market-neutral positioning.",
    icon: <ArrowLeftRight className="w-6 h-6 text-textMuted" />,
    disabled: true,
    badge: "Coming soon",
  },
];

/**
 * Body-only component: the overlay shell (frame, title, close) is owned by
 * `StrategyForm` so switching steps never re-renders the frame.
 */
export const StrategyTypeChooser: React.FC<StrategyTypeChooserProps> = ({
  onSelect,
}) => (
  <div className="p-6 space-y-4">
    <p className="text-sm text-textMuted">
      Pick a strategy type. Each type has its own form with only the fields that
      strategy actually uses.
    </p>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {TYPE_CARDS.map(card =>
        card.disabled ? (
          <div
            key={card.type}
            aria-disabled="true"
            className="p-4 rounded-xl border border-white/10 bg-white/[0.02] opacity-60 cursor-not-allowed"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
                {card.icon}
              </div>
              {card.badge && (
                <span className="px-2 py-1 text-xs rounded-full bg-warning/20 text-warning">
                  {card.badge}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-text mb-1">{card.title}</h3>
            <p className="text-sm text-textMuted">{card.description}</p>
          </div>
        ) : (
          <button
            key={card.type}
            type="button"
            onClick={() => onSelect(card.type)}
            className="p-4 rounded-xl border border-white/10 bg-white/[0.02] hover:border-primary/50 hover:bg-white/[0.04] transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
              {card.icon}
            </div>
            <h3 className="font-semibold text-text mb-1">{card.title}</h3>
            <p className="text-sm text-textMuted">{card.description}</p>
          </button>
        )
      )}
    </div>
  </div>
);
