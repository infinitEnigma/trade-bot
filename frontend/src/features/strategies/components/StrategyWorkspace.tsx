/** @format */

import React, { useState } from "react";
import { Strategy, StrategyType } from "../../../shared/types";
import { Zap, Edit, Trash2 } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { RecentTradesTable } from "../../../shared/components/user/RecentTrades";
import { useRecentTrades } from "../../../shared/hooks";
import { cn } from "../../../shared/utils";
import { BotControls } from "../bots/components/BotControls";
import { BotStatusBadge } from "./BotStatusBadge";
import { OpenOrdersTable } from "./OpenOrdersTable";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { strategyService } from "../services/strategyService";
import { getStrategyConfig, type BotInstance } from "../types/strategies.types";
import type { OpenOrderRow } from "../../../infrastructure/api/market";

/**
 * StrategyWorkspace — the detail half of the Phase 3 master–detail Strategies
 * page: everything that operates ONE selected strategy, replacing the old
 * per-card spread (StrategyCard). Top to bottom: identity + enabled state +
 * edit/delete; live bot state + lifecycle controls (BotControls also renders
 * the start flow when no bot is attached); the execution tabs — open orders
 * + recent fills, each aged by an honest freshness chip (slice 5); static
 * configuration last.
 *
 * The account scope for orders is resolved on the page (strategy → hosting
 * session → account) and passed in as rows — this component only renders.
 */
interface StrategyWorkspaceProps {
  strategy: Strategy;
  /** Hosting session (D4), if any — undefined means the start flow shows. */
  bot?: BotInstance;
  /** Open orders for this strategy's account + market (Phase 3 slice 4). */
  orders: OpenOrderRow[];
  ordersLoading: boolean;
  ordersError: boolean;
  /** Epoch ms of the orders' last successful fetch (0 = never). */
  ordersUpdatedAt?: number;
  onEdit: (strategy: Strategy) => void;
  onDelete: (strategy: Strategy) => void;
  onBotStatusChange: () => void;
}

export const StrategyWorkspace: React.FC<StrategyWorkspaceProps> = ({
  strategy,
  bot,
  orders,
  ordersLoading,
  ordersError,
  ordersUpdatedAt,
  onEdit,
  onDelete,
  onBotStatusChange,
}) => {
  const strategyConfig = getStrategyConfig(strategy);
  // Execution tabs (slice 5): the two live views of this strategy's
  // execution. The trades tab exists only for a bot-backed strategy (a
  // bot-less strategy cannot fill); if the bot detaches while its tab is
  // active, the derived `activeTab` falls back to orders — no effect.
  const [executionTab, setExecutionTab] = useState<"orders" | "trades">(
    "orders"
  );
  const activeTab = executionTab === "trades" && !bot ? "orders" : executionTab;
  const {
    trades: strategyFills,
    isLoading: strategyFillsLoading,
    error: strategyFillsError,
    dataUpdatedAt: tradesUpdatedAt,
  } = useRecentTrades({
    strategyId: strategy.id,
    limit: 5,
    enabled: !!bot,
  });

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);

  return (
    <Card className="space-y-5">
      {/* Header: identity + enabled state + row actions (card-era Edit /
          Delete, now anchored to the workspace instead of every row). */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text">{strategy.name}</h3>
            <p className="text-sm text-textMuted capitalize">
              {strategyService.formatStrategyType(strategy.type)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              strategy.active
                ? "bg-success/20 text-success"
                : "bg-gray-500/20 text-gray-400"
            }`}
            title={
              strategy.active
                ? "Strategy enabled — a bot can run on it. Bot state is shown separately below."
                : "Strategy disabled — no bot can run on it."
            }
          >
            {strategy.active ? "Enabled" : "Disabled"}
          </span>
          <button
            onClick={() => onEdit(strategy)}
            className="p-2 rounded-lg hover:bg-surface transition-colors"
            title="Edit Strategy"
          >
            <Edit className="w-4 h-4 text-textMuted hover:text-text" />
          </button>
          <button
            onClick={() => onDelete(strategy)}
            className="p-2 rounded-lg hover:bg-surface transition-colors"
            title="Delete Strategy"
          >
            <Trash2 className="w-4 h-4 text-danger hover:text-danger" />
          </button>
        </div>
      </div>
      {/* Bot panel — lifecycle state is distinct from the strategy's
          Enabled/Disabled badge above; "Needs attention" carries its own
          one-line explanation of the next safe action (P1). */}
      {bot && (
        <div
          className={`bg-surface rounded p-3 ${strategyService.getStrategyTypeColor(strategy.type)}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text">Bot</span>
            <BotStatusBadge bot={bot} hideDetail />
          </div>
          {/* Bot lifecycle is distinct from the strategy's Enabled/Disabled
              state above. "Needs attention" (reconcile-park or lost engine)
              carries its own one-line explanation of the next safe action. */}
          {bot.needsUserAction || bot.status === "UNKNOWN" ? (
            <BotStatusBadge bot={bot} />
          ) : null}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-textMuted">Trades:</span>
              <span className="text-text">{bot.total_trades || 0}</span>
            </div>
            <div className="flex justify-between">
              {/* P1: ledger total_pnl is realized only — labeled as such so
                  the workspace never implies total PnL. Venue-exact unrealized
                  lives on the portfolio strip. F2: with unknown-PnL fills the
                  figure is INCOMPLETE (unknown direction, never a lower
                  bound) — incomplete marker + count, never net PnL. */}
              <span className="text-textMuted">Realized PnL:</span>
              <span
                className={`font-medium ${
                  (bot.total_pnl || 0) >= 0 ? "text-success" : "text-danger"
                }`}
                title={
                  (bot.total_pnl_incomplete_fills ?? 0) > 0
                    ? `${bot.total_pnl_incomplete_fills} fill(s) have unknown PnL — total shows known fills only (incomplete, not net PnL)`
                    : undefined
                }
              >
                {formatCurrency(bot.total_pnl || 0)}
                {(bot.total_pnl_incomplete_fills ?? 0) > 0
                  ? ` (incomplete, ${bot.total_pnl_incomplete_fills} unknown)`
                  : ""}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Lifecycle controls — without a bot these render the C3a start flow
          (account pick + size), same as the old card. */}
      <div className="flex items-center gap-2">
        <BotControls
          strategyId={strategy.id}
          strategySymbol={strategyConfig?.config.symbol}
          bot={bot}
          onStatusChange={onBotStatusChange}
        />
      </div>

      {/* Execution tabs (slice 5): open orders + recent fills, one panel at a
          time, each aged by an honest freshness chip — the time of the last
          successful fetch of the ACTIVE source, never an implied live feed.
          Orders stay scoped on the page to this strategy's account + market
          (D4 fallback documented there); the chart mirrors their levels.
          Only bot-backed strategies get the fills tab. */}
      <div className="border-t border-white/5 pt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Execution views"
            className="flex gap-1"
          >
            <button
              type="button"
              role="tab"
              id="workspace-tab-orders"
              aria-selected={activeTab === "orders"}
              aria-controls="workspace-panel-orders"
              onClick={() => setExecutionTab("orders")}
              className={cn(
                "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                activeTab === "orders"
                  ? "border-primary/40 bg-primary/10 text-text font-medium"
                  : "border-transparent text-textMuted hover:text-text"
              )}
            >
              Open orders ({orders.length})
            </button>
            {bot && (
              <button
                type="button"
                role="tab"
                id="workspace-tab-trades"
                aria-selected={activeTab === "trades"}
                aria-controls="workspace-panel-trades"
                onClick={() => setExecutionTab("trades")}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                  activeTab === "trades"
                    ? "border-primary/40 bg-primary/10 text-text font-medium"
                    : "border-transparent text-textMuted hover:text-text"
                )}
              >
                Recent trades
              </button>
            )}
          </div>
          <FreshnessIndicator
            updatedAt={
              activeTab === "orders" ? ordersUpdatedAt : tradesUpdatedAt
            }
          />
        </div>
        <div
          role="tabpanel"
          id="workspace-panel-orders"
          aria-labelledby="workspace-tab-orders"
          hidden={activeTab !== "orders"}
        >
          <OpenOrdersTable
            orders={orders}
            isLoading={ordersLoading}
            error={ordersError}
          />
        </div>
        {bot && (
          <div
            role="tabpanel"
            id="workspace-panel-trades"
            aria-labelledby="workspace-tab-trades"
            hidden={activeTab !== "trades"}
            className="max-h-64 overflow-y-auto"
          >
            <RecentTradesTable
              trades={strategyFills}
              isLoading={strategyFillsLoading}
              error={strategyFillsError}
              variant="compact"
              title=""
            />
          </div>
        )}
      </div>

      {/* Configuration — the card-era config summary (reference data last). */}
      <div className="border-t border-white/5 pt-4 space-y-2">
        <h4 className="text-sm font-semibold text-text">Configuration</h4>
        <div className="flex justify-between text-sm">
          <span className="text-textMuted">Symbol:</span>
          <span className="text-text font-medium">
            {strategyConfig && "symbol" in strategyConfig.config
              ? (strategyConfig.config.symbol as string)
                  ?.replace("PERP_", "")
                  .replace("_USDC", "") || "N/A"
              : "N/A"}
          </span>
        </div>
        {strategy.type === StrategyType.GRID && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-textMuted">Grid Size:</span>
              <span className="text-text">
                {strategyConfig && "gridSize" in strategyConfig.config
                  ? (strategyConfig.config.gridSize as number) || 0
                  : 0}{" "}
                levels
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-textMuted">Range:</span>
              <span className="text-text">
                {strategyConfig && "gridRange" in strategyConfig.config
                  ? (strategyConfig.config.gridRange as number) || 0
                  : 0}
                %
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-textMuted">Order Qty:</span>
              <span className="text-text">
                {strategyConfig && "orderQuantity" in strategyConfig.config
                  ? (strategyConfig.config.orderQuantity as number) || 0
                  : 0}
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
};
