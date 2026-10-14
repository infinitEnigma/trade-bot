/** @format */

import React, { Suspense, lazy, useEffect, useState } from "react";
import { Strategy, StrategyType } from "../../../shared/types";
import { Zap, Edit, Trash2 } from "lucide-react";
import { Card, FreshnessIndicator } from "../../../shared/components/ui";
import { RecentTradesTable } from "../../../shared/components/user/RecentTrades";
import { useRecentTrades } from "../../../shared/hooks";
import { cn } from "../../../shared/utils";
import {
  decodeChartOption,
  encodeChartOption,
  venueLabel,
  type ChartSelection,
  type ChartSymbolGroup,
} from "../utils/chartSymbolPicker";
import { BotControls } from "../bots/components/BotControls";
import { BotStatusBadge } from "./BotStatusBadge";
import { OpenOrdersTable } from "./OpenOrdersTable";
import { PositionsTable } from "./PositionsTable";
import { strategyService } from "../services/strategyService";
import { getStrategyConfig, type BotInstance } from "../types/strategies.types";
import type { ExchangeAccountDto } from "../../../infrastructure/api/accounts";
import type {
  AccountPositionRow,
  OpenOrderRow,
} from "../../../infrastructure/api/market";

// Lazy load the heavy chart (same performance reason as everywhere else).
const CandlestickChart = lazy(
  () => import("../../../shared/components/charts/CandlestickChart")
);

/** Venue symbol forms differ per venue — bare `BTC` vs `PERP_BTC_USDC`. */
const normalizeMarketSymbol = (raw: string): string => {
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return "";
  return symbol.includes("_") ? symbol : `PERP_${symbol}_USDC`;
};

/**
 * Phase 3.1 (review P2-3): matchMedia subscription — the workspace renders
 * the execution panels side by side on xl (≥1280px) and falls back to tabs
 * below it. Environments without matchMedia (jsdom/SSR) answer false →
 * tab mode, which is also what the tests exercise.
 */
function useMediaQuery(query: string): boolean {
  const readMatch = (): boolean =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? (window.matchMedia(query)?.matches ?? false)
      : false;
  const [matches, setMatches] = useState(readMatch);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return undefined;
    }
    const mql = window.matchMedia(query);
    if (!mql) return undefined;
    const onChange = () => setMatches(mql.matches ?? false);
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari < 14 fallback.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);
  return matches;
}

/**
 * StrategyWorkspace — the detail half of the Phase 3 master–detail Strategies
 * page: everything that operates ONE selected strategy, replacing the old
 * per-card spread (StrategyCard). Top to bottom: identity + enabled state +
 * edit/delete; live bot state + lifecycle controls (BotControls also renders
 * the start flow when no bot is attached); the chart bound to this strategy's
 * market (Phase 3.1, review P1-1); the execution tabs — open orders + recent
 * fills, each aged by an honest freshness chip (slice 5); static configuration
 * last.
 *
 * The account scope for orders is resolved on the page (strategy → hosting
 * session → account) and passed in as rows — this component only renders.
 */
interface StrategyWorkspaceProps {
  strategy: Strategy;
  /** Hosting session (D4), if any — undefined means the start flow shows. */
  bot?: BotInstance;
  /**
   * The bound venue account for the header chip (Phase 3.1, review P2-5):
   * exchange · environment · accountRef; null/undefined = unbound.
   */
  account?: ExchangeAccountDto | null;
  /** The chart's market + venue (Phase 3.1: bound to this strategy). */
  chartSelection: ChartSelection;
  chartGroups: ChartSymbolGroup[];
  chartOptionCount: number;
  onChartSelectionChange: (selection: ChartSelection) => void;
  /** Open orders for this strategy's account + market (Phase 3 slice 4). */
  orders: OpenOrderRow[];
  ordersLoading: boolean;
  ordersError: boolean;
  /** Epoch ms of the orders' last successful fetch (0 = never). */
  ordersUpdatedAt?: number;
  /** Account-level positions (Phase 3.1, review P2-4). */
  positions: AccountPositionRow[];
  positionsLoading: boolean;
  positionsError: boolean;
  /** Epoch ms of the positions' last successful fetch (0 = never). */
  positionsUpdatedAt?: number;
  onEdit: (strategy: Strategy) => void;
  onDelete: (strategy: Strategy) => void;
  onBotStatusChange: () => void;
}

export const StrategyWorkspace: React.FC<StrategyWorkspaceProps> = ({
  strategy,
  bot,
  account,
  chartSelection,
  chartGroups,
  chartOptionCount,
  onChartSelectionChange,
  orders,
  ordersLoading,
  ordersError,
  ordersUpdatedAt,
  positions,
  positionsLoading,
  positionsError,
  positionsUpdatedAt,
  onEdit,
  onDelete,
  onBotStatusChange,
}) => {
  const strategyConfig = getStrategyConfig(strategy);
  // Execution tabs (slice 5): the two live views of this strategy's
  // execution. The trades tab exists only for a bot-backed strategy (a
  // bot-less strategy cannot fill); if the bot detaches while its tab is
  // active, the derived `activeTab` falls back to orders — no effect.
  const [executionTab, setExecutionTab] = useState<
    "orders" | "trades" | "positions"
  >("orders");
  const activeTab = executionTab === "trades" && !bot ? "orders" : executionTab;
  // Phase 3.1 (review P2-3): side-by-side execution panels on xl (≥1280px),
  // tabs below. Environments without matchMedia answer false → tab mode.
  const wideView = useMediaQuery("(min-width: 1280px)");
  const {
    trades: strategyFills,
    isLoading: strategyFillsLoading,
    error: strategyFillsError,
    dataUpdatedAt: tradesUpdatedAt,
  } = useRecentTrades({
    strategyId: strategy.id,
    // Review P2-3: five records was restrictive when investigating bot
    // behaviour — 25 in-panel (backend cap 200). Full pagination stays
    // deferred: the ledger route is limit-only (no offset) today.
    limit: 25,
    enabled: !!bot,
  });
  // Phase 3.1 (review P2-4): positions are ACCOUNT × MARKET on the backend —
  // the panel narrows the account book to this strategy's market (venue
  // forms differ: bare `BTC` vs `PERP_BTC_USDC` — same normalisation the
  // chart uses) and its caption labels the attribution it cannot claim.
  const strategyMarket = normalizeMarketSymbol(
    strategyConfig?.config.symbol ?? ""
  );
  const marketPositions = strategyMarket
    ? positions.filter(
        row => normalizeMarketSymbol(row.symbol) === strategyMarket
      )
    : [];

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
            {/* Review P2-5: the venue context before any lifecycle action. */}
            <p className="text-xs text-textMuted">
              {account
                ? `${venueLabel(account.exchange, account.environment)} · ${account.accountRef}`
                : "No venue account bound"}
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

      {/* Chart (Phase 3.1, review P1-1): the SELECTED strategy's market —
          bound here, not in the lower reference section. The levels drawn
          are THIS scope's book only while the chart shows the strategy's
          market; a deliberate dropdown detour to another venue gets no
          levels (the strategy's account cannot rest orders there — never a
          misattributed marker). */}
      <div className="border-t border-white/5 pt-4">
        {chartOptionCount > 1 && (
          <div className="flex items-center gap-2 mb-3">
            <label
              htmlFor="strategies-chart-symbol"
              className="text-sm text-textMuted"
            >
              Chart symbol
            </label>
            <select
              id="strategies-chart-symbol"
              value={encodeChartOption(chartSelection)}
              onChange={event => {
                const decoded = decodeChartOption(event.target.value);
                if (decoded) onChartSelectionChange(decoded);
              }}
              aria-label="Chart symbol"
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-text focus:border-primary/50 focus:outline-none"
            >
              {chartGroups.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.symbols.map(sym => (
                    <option
                      key={sym}
                      value={encodeChartOption({
                        symbol: sym,
                        exchange: group.exchange,
                        environment: group.environment,
                      })}
                    >
                      {sym.replace("PERP_", "").replace("_USDC", "")}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <Suspense
          fallback={
            <div className="glass-card p-6 animate-pulse">
              <div className="w-32 h-5 bg-surface rounded mb-4"></div>
              <div className="bg-surface rounded-lg h-110"></div>
            </div>
          }
        >
          <CandlestickChart
            symbol={chartSelection.symbol}
            interval="1h"
            height={450}
            venue={{
              exchange: chartSelection.exchange,
              environment: chartSelection.environment,
            }}
            orders={
              chartSelection.symbol.trim().toUpperCase() ===
              (strategyConfig?.config.symbol ?? "").trim().toUpperCase()
                ? orders
                : []
            }
          />
        </Suspense>
      </div>

      {/* Execution views (slice 5, Phase 3.1 re-scoped): below xl the three
          sources are tabs (one panel at a time); on xl (≥1280px) open orders
          and recent fills render SIDE BY SIDE with positions underneath —
          orders and executions together (review P2-3). Each xl panel header
          ages its OWN source with an honest freshness chip (last successful
          fetch, never an implied live feed); the tab strip carries the active
          source's chip below xl. Orders stay scoped on the page to this
          strategy's account + market (D4 fallback documented there); only
          bot-backed strategies get the fills tab. */}
      <div className="border-t border-white/5 pt-4 space-y-3">
        {!wideView && (
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
              <button
                type="button"
                role="tab"
                id="workspace-tab-positions"
                aria-selected={activeTab === "positions"}
                aria-controls="workspace-panel-positions"
                onClick={() => setExecutionTab("positions")}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                  activeTab === "positions"
                    ? "border-primary/40 bg-primary/10 text-text font-medium"
                    : "border-transparent text-textMuted hover:text-text"
                )}
              >
                Positions ({marketPositions.length})
              </button>
            </div>
            <FreshnessIndicator
              updatedAt={
                activeTab === "orders"
                  ? ordersUpdatedAt
                  : activeTab === "trades"
                    ? tradesUpdatedAt
                    : positionsUpdatedAt
              }
            />
          </div>
        )}
        <div
          className={cn(
            "space-y-3",
            bot && "xl:grid xl:grid-cols-2 xl:gap-4 xl:space-y-0"
          )}
        >
          <div
            role="tabpanel"
            id="workspace-panel-orders"
            aria-labelledby="workspace-tab-orders"
            hidden={!wideView && activeTab !== "orders"}
          >
            <div className="hidden xl:flex items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-semibold text-text">
                Open orders ({orders.length})
              </h4>
              <FreshnessIndicator updatedAt={ordersUpdatedAt} />
            </div>
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
              hidden={!wideView && activeTab !== "trades"}
              className="max-h-64 overflow-y-auto"
            >
              <div className="hidden xl:flex items-center justify-between gap-2 mb-2">
                <h4 className="text-sm font-semibold text-text">
                  Recent trades
                </h4>
                <FreshnessIndicator updatedAt={tradesUpdatedAt} />
              </div>
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
        <div
          role="tabpanel"
          id="workspace-panel-positions"
          aria-labelledby="workspace-tab-positions"
          hidden={!wideView && activeTab !== "positions"}
        >
          <div className="hidden xl:flex items-center justify-between gap-2 mb-2">
            <h4 className="text-sm font-semibold text-text">
              Positions ({marketPositions.length})
            </h4>
            <FreshnessIndicator updatedAt={positionsUpdatedAt} />
          </div>
          <p className="text-xs text-textMuted mb-2">
            Venue account truth for this market — positions are account ×
            market, not strategy-attributed.
          </p>
          <PositionsTable
            positions={marketPositions}
            isLoading={positionsLoading}
            error={positionsError}
          />
        </div>
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
