/** @format */

import React, { useState, useEffect, Suspense, lazy } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  marketApi,
  tradingApi,
  accountsApi,
} from "../../../infrastructure/api";
import { strategyService } from "../services/strategyService";
import { Strategy } from "../../../shared/types";
import { Plus, BarChart3, AlertTriangle } from "lucide-react";
import {
  buildChartSymbolGroups,
  decodeChartOption,
  encodeChartOption,
  FALLBACK_CHART_SELECTION,
  resolveChartSelection,
  type ChartSelection,
  type ChartVenueRef,
  type VenueCatalog,
} from "../utils/chartSymbolPicker";

// Lazy load heavy components for better performance
const CandlestickChart = lazy(
  () => import("../../../shared/components/charts/CandlestickChart")
);
const StrategyCard = lazy(() =>
  import("../components/StrategyCard").then(module => ({
    default: module.StrategyCard,
  }))
);
const StrategyForm = lazy(() =>
  import("../components/StrategyForm").then(module => ({
    default: module.StrategyForm,
  }))
);
const BotControls = lazy(() =>
  import("../bots/components").then(module => ({ default: module.BotControls }))
);
import { usePortfolioSummary } from "../../../shared/hooks";
import { useAuth } from "../../auth";
import { useBotsList } from "../../bots/hooks";
import {
  getSessionForStrategy,
  getStrategyConfig,
} from "../types/strategies.types";
import { PageLayout, Container } from "../../../shared/components/layout";

const Strategies: React.FC = React.memo(() => {
  const { user } = useAuth();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  // Phase 2: after create, offer "start it now" — a strategy is created
  // inactive; starting a bot on it (C3a account pick + size) is the start.
  const [startPromptStrategy, setStartPromptStrategy] =
    useState<Strategy | null>(null);
  // P1/X3: chart symbol + venue follow the dropdown override below (default
  // = first strategy's symbol, venue by catalog membership — see
  // chartSymbolPicker.ts). Absent strategies/catalogs fall back to the
  // historic BTC default. Stored Kodiak form (PERP_ETH_USDC) passes through
  // unchanged — CandlestickChart/useChartData already handle it.
  const [chartSelectionOverride, setChartSelectionOverride] =
    useState<ChartSelection | null>(null);
  const queryClient = useQueryClient();

  // Note: exchange connectivity check removed for simplicity
  // Individual components handle their own error states

  // Memory cleanup effect.
  //
  // Single-owner cache (see useBotLifecycle.ts / commit 448712c): the
  // ["bot-instances"] key is owned exclusively by useBotLifecycle — this page
  // must NOT removeQueries/cancelQueries it. Doing so (the old behaviour, also
  // finding G1) tore the data out from under the mounted per-card useBotState
  // observers, flipping the shared observer to `data: undefined` and blanking
  // the route behind AnimatePresence. Only the page-owned ["strategies"] key is
  // touched here.
  useEffect(() => {
    const cleanup = () => {
      queryClient.removeQueries({ queryKey: ["strategies"] });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        queryClient.cancelQueries({ queryKey: ["strategies"] });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Periodic cleanup every 5 minutes (strategies key only)
    const cleanupInterval = setInterval(cleanup, 5 * 60 * 1000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(cleanupInterval);
      cleanup();
    };
  }, [queryClient]);

  // Fetch strategies
  const { data: strategiesData, isLoading } = useQuery({
    queryKey: ["strategies"],
    queryFn: () => tradingApi.getStrategies(),
    staleTime: 2 * 60 * 1000, // 2 minutes - strategies don't change often
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false, // Don't refetch on focus for this data
  });

  // Fetch engine status first - only query bots if engine is running
  // 🔧 FIXED: Reduced polling frequency and added better controls
  const { data: engineStatus } = useQuery({
    queryKey: ["engine-status"],
    queryFn: () => tradingApi.getEngineStatus(),
    staleTime: 120000, // ⬆️ Increased to 2 minutes (from 30s)
    gcTime: 300000, // ⬆️ Increased to 5 minutes (from 1min)
    refetchInterval: 300000, // 🔄 Poll every 5 minutes (not continuously)
    refetchOnWindowFocus: false, // 🚫 Don't refetch on focus
    refetchIntervalInBackground: false, // 🚫 Don't poll in background
    enabled: user?.userLevel === "VERIFIED", // Only for verified users
    retry: (failureCount, error: unknown) => {
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 429) return false; // Don't retry rate limits
      if (err.response?.status === 403) return false; // Don't retry auth errors
      return failureCount < 1; // Only retry once for engine status
    },
  });

  // Strategies page owns the card list (lookup + refresh); per-card live state
  // comes from useBotLifecycle's shared ["bot-instances"] cache (single
  // owner — see useBotLifecycle.ts). useBotsList subscribes to that cache so
  // this page never writes the key itself: a second writer with a different
  // shape/observer options is what blanked the page (shared-observer data
  // flip → .map on undefined).
  const { bots } = useBotsList();

  const strategies = strategiesData?.success ? strategiesData.data : [];

  // P1: all strategy symbols for the chart picker (locked decision: every
  // strategy, not just RUNNING).
  const strategySymbols: string[] = [];
  for (const s of strategies as Strategy[]) {
    const sym = getStrategyConfig(s)?.config.symbol;
    if (typeof sym === "string" && sym && !strategySymbols.includes(sym)) {
      strategySymbols.push(sym);
    }
  }

  // X3: the picker lists every symbol the user's ACTIVE venues list. One
  // accounts query under the shared ["exchange-accounts", userId] key (the
  // same source usePortfolioSummary/BotControls read — one cache, one
  // truth), venue pairs deduped in ACTIVE-account order (the same order the
  // portfolio strip uses), one catalog fetch per pair (fail-open, X2).
  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", user?.id],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const activeVenues: ChartVenueRef[] = [];
  const seenVenues = new Set<string>();
  for (const account of accountsQuery.data?.data?.accounts ?? []) {
    if (account.status !== "ACTIVE") continue;
    const key = `${account.exchange}:${account.environment}`;
    if (seenVenues.has(key)) continue;
    seenVenues.add(key);
    activeVenues.push({
      exchange: account.exchange,
      environment: account.environment,
    });
  }

  const catalogsQuery = useQuery({
    queryKey: [
      "chart-venue-catalogs",
      activeVenues.map(v => `${v.exchange}:${v.environment}`),
    ],
    queryFn: async (): Promise<VenueCatalog[]> =>
      Promise.all(
        activeVenues.map(async venue => {
          try {
            const res = await marketApi.getVenueSymbols(venue);
            return {
              ...venue,
              available: res?.data?.available === true,
              symbols: Array.isArray(res?.data?.symbols)
                ? (res.data.symbols as string[])
                : [],
            };
          } catch {
            // Fail-open (X2): an unfetchable catalog is "unknown", never an error.
            return { ...venue, available: false, symbols: [] };
          }
        })
      ),
    enabled: activeVenues.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const catalogs: VenueCatalog[] = catalogsQuery.data ?? [];

  // Default = first strategy's symbol (venue by catalog membership); the
  // operator's explicit pick always wins (derived during render, P1 pattern).
  const chartSelection =
    chartSelectionOverride ??
    resolveChartSelection(catalogs, strategySymbols, activeVenues);
  const chartSymbol = chartSelection.symbol;
  const chartGroups = buildChartSymbolGroups(
    catalogs,
    strategySymbols,
    activeVenues[0] ?? FALLBACK_CHART_SELECTION
  );
  const chartOptionCount = chartGroups.reduce(
    (count, group) => count + group.symbols.length,
    0
  );

  // Delete strategy mutation
  const deleteMutation = useMutation({
    mutationFn: (strategyId: string) => tradingApi.deleteStrategy(strategyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      queryClient.invalidateQueries({ queryKey: ["bot-instances"] });
      toast.success("Strategy deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete strategy");
    },
  });

  const handleDeleteStrategy = (strategyId: string) => {
    if (confirm("Are you sure you want to delete this strategy?")) {
      deleteMutation.mutate(strategyId);
    }
  };

  const getBotForStrategy = (strategyId: string) => {
    // D4 sessions: resolve through the session's runs first.
    return getSessionForStrategy(bots, strategyId);
  };

  // B1/B6: the five portfolio figures — on-chain wallet, selected exchange
  // balance, venue-exact unrealized PnL, venue-computed realized PnL, total
  // across all ACTIVE
  // accounts. Each reads its own real source (replaces the old useBalance
  // strip where all four cards showed the same venue total).
  const portfolioSummary = usePortfolioSummary();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatStrategyType = (type: Strategy["type"]) =>
    strategyService.formatStrategyType(type);
  const getStrategyTypeColor = (type: Strategy["type"]) =>
    strategyService.getStrategyTypeColor(type);

  return (
    <PageLayout
      header={
        <div className="glass-card border-b border-white/5">
          <Container className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-linear-to-br from-primary to-primaryHover flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-text">
                    Trading Strategies
                  </h1>
                  <p className="text-sm text-textMuted">
                    Manage your automated trading strategies
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="btn-primary flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Strategy
                </button>
              </div>
            </div>

            {/* Mobile Navigation - removed duplicate */}
          </Container>
        </div>
      }
    >
      <Container
        size={{
          default: "lg",
          xl: "xl",
          "2xl": "2xl",
          "3xl": "3xl",
          "4xl": "4xl",
        }}
        className="py-2 space-y-4"
      >
        {/* Candlestick Chart - Advanced trading data for verified users */}
        {/* P1/X3: symbol AND venue follow the dropdown (all venue-listed
            symbols, grouped by venue — X1 pattern); the venue drives the
            backend's candle dispatch and the Orderly-WS skip. */}
        <div className="mb-8">
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
                  if (decoded) setChartSelectionOverride(decoded);
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
              symbol={chartSymbol}
              interval="1h"
              height={450}
              venue={{
                exchange: chartSelection.exchange,
                environment: chartSelection.environment,
              }}
            />
          </Suspense>
        </div>

        {/* Account Balance Overview - real venue balances (VERIFIED users) */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-text">Portfolio</h2>
          </div>

          {portfolioSummary.initialLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="glass-card p-6">
                  <div className="animate-pulse">
                    <div className="grid grid-rows-[auto_1fr_auto] gap-3">
                      <div className="flex items-center justify-between">
                        <div className="w-10 h-10 bg-white/10 rounded-lg"></div>
                        <div className="w-20 h-4 bg-white/10 rounded"></div>
                      </div>
                      <div className="w-24 h-8 bg-white/10 rounded"></div>
                      <div className="w-16 h-4 bg-white/10 rounded"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : portfolioSummary.error ? (
            <div className="glass-card p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-warning/10 rounded-full flex items-center justify-center">
                <div className="w-6 h-6 bg-warning rounded"></div>
              </div>
              <h3 className="text-lg font-semibold text-text mb-2">
                Portfolio figures unavailable
              </h3>
              <p className="text-textMuted mb-4">{portfolioSummary.error}</p>
            </div>
          ) : user?.userLevel === "VERIFIED" ? (
            /* Five distinct, real figures (B1/B6; 2026-10-09 PnL fix) — same
               sources as the Dashboard strip: on-chain wallet, selected
               exchange balance, venue-exact unrealized PnL, venue-computed
               realized PnL, total across all accounts. */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-blue-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Wallet</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${portfolioSummary.walletBalance.toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">On-chain balance</p>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-green-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Exchange</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${portfolioSummary.exchangeBalance.toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">Selected account</p>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-orange-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Unrealized PnL</span>
                </div>
                <div
                  className={`text-2xl font-bold mb-1 ${
                    portfolioSummary.unrealizedPnl >= 0
                      ? "text-success"
                      : "text-danger"
                  }`}
                >
                  {portfolioSummary.unrealizedPnl >= 0 ? "+" : "-"}$
                  {Math.abs(portfolioSummary.unrealizedPnl).toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">Open positions</p>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-orange-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Realized PnL</span>
                </div>
                <div
                  className={`text-2xl font-bold mb-1 ${
                    portfolioSummary.realizedPnl >= 0
                      ? "text-success"
                      : "text-danger"
                  }`}
                >
                  {portfolioSummary.realizedPnl >= 0 ? "+" : "-"}$
                  {Math.abs(portfolioSummary.realizedPnl).toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">Venue 7d window</p>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-purple-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Total</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${portfolioSummary.totalAcrossExchanges.toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">
                  Across {portfolioSummary.activeAccountCount || 0} account
                  {portfolioSummary.activeAccountCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Engine offline banner: informational only — bot instances are still
            fetched. Start fails fast with a 503 until the engine runs; the
            backend never spawns it. Operator docs: docs/OPERATIONS.md. */}
        {engineStatus && engineStatus?.data?.running === false && (
          <div className="glass-card p-4 flex items-center gap-3 border-warning/20 bg-warning/5">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            <p className="text-sm text-textMuted">
              The trading engine isn't running — starting a bot will fail until
              it is. Existing bots are still listed below.
            </p>
          </div>
        )}

        {/* Strategies Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass-card p-6">
                <div className="animate-pulse">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-24 h-6 bg-white/10 rounded"></div>
                    <div className="w-16 h-6 bg-white/10 rounded"></div>
                  </div>
                  <div className="w-32 h-8 bg-white/10 rounded mb-4"></div>
                  <div className="space-y-2">
                    <div className="w-full h-4 bg-white/10 rounded"></div>
                    <div className="w-3/4 h-4 bg-white/10 rounded"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : strategies.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <BarChart3 className="w-12 h-12 text-textMuted mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-text mb-2">
              No Strategies Yet
            </h3>
            <p className="text-textMuted mb-6">
              Create your first automated trading strategy to get started.
            </p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="btn-primary"
            >
              Create Your First Strategy
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {strategies.map((strategy: Strategy) => {
              const bot = getBotForStrategy(strategy.id);

              return (
                <Suspense
                  key={strategy.id}
                  fallback={
                    <div className="glass-card p-6">
                      <div className="animate-pulse">
                        <div className="w-24 h-6 bg-white/10 rounded mb-4"></div>
                        <div className="w-full h-4 bg-white/10 rounded"></div>
                      </div>
                    </div>
                  }
                >
                  <StrategyCard
                    strategy={strategy}
                    bot={bot}
                    onEdit={setEditingStrategy}
                    onDelete={handleDeleteStrategy}
                    onBotStatusChange={() => {
                      queryClient.invalidateQueries({
                        queryKey: ["bot-instances"],
                      });
                    }}
                    formatCurrency={formatCurrency}
                    formatStrategyType={formatStrategyType}
                    getStrategyTypeColor={getStrategyTypeColor}
                  />
                </Suspense>
              );
            })}
          </div>
        )}

        {/* Strategy Form Modals */}
        {showCreateForm && (
          <Suspense
            fallback={
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="glass-card p-8 animate-pulse">
                  <div className="w-64 h-8 bg-surface rounded mb-4"></div>
                  <div className="space-y-3">
                    <div className="w-full h-10 bg-surface rounded"></div>
                    <div className="w-full h-10 bg-surface rounded"></div>
                    <div className="flex gap-3">
                      <div className="w-20 h-10 bg-surface rounded"></div>
                      <div className="w-24 h-10 bg-surface rounded"></div>
                    </div>
                  </div>
                </div>
              </div>
            }
          >
            <StrategyForm
              onClose={() => setShowCreateForm(false)}
              onSuccess={created => {
                setShowCreateForm(false);
                queryClient.invalidateQueries({ queryKey: ["strategies"] });
                toast.success("Strategy created successfully!");
                // Phase 2: created inactive → offer the start flow at once.
                if (created) setStartPromptStrategy(created);
              }}
            />
          </Suspense>
        )}

        {/* Post-create start prompt: a strategy is created inactive; the
            real "start" is a bot bound to it (C3a: account pick + size).
            BotControls without a bot renders exactly that start flow. */}
        {startPromptStrategy && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="glass-card p-6 w-full max-w-md mx-4 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-text">
                  Start "{startPromptStrategy.name}" now?
                </h3>
                <p className="text-sm text-textMuted">
                  Pick the exchange account and trading size to launch this
                  strategy. You can also start it later from its card.
                </p>
              </div>
              <Suspense
                fallback={
                  <div className="text-center py-4 text-textMuted text-sm">
                    Loading…
                  </div>
                }
              >
                <BotControls
                  strategyId={startPromptStrategy.id}
                  strategySymbol={
                    getStrategyConfig(startPromptStrategy)?.config.symbol
                  }
                  onStatusChange={() => {
                    queryClient.invalidateQueries({
                      queryKey: ["bot-instances"],
                    });
                    queryClient.invalidateQueries({ queryKey: ["strategies"] });
                    setStartPromptStrategy(null);
                  }}
                />
              </Suspense>
              <div className="flex justify-end">
                <button
                  onClick={() => setStartPromptStrategy(null)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        {editingStrategy && (
          <Suspense
            fallback={
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="glass-card p-8 animate-pulse">
                  <div className="w-64 h-8 bg-surface rounded mb-4"></div>
                  <div className="space-y-3">
                    <div className="w-full h-10 bg-surface rounded"></div>
                    <div className="w-full h-10 bg-surface rounded"></div>
                    <div className="flex gap-3">
                      <div className="w-20 h-10 bg-surface rounded"></div>
                      <div className="w-24 h-10 bg-surface rounded"></div>
                    </div>
                  </div>
                </div>
              </div>
            }
          >
            <StrategyForm
              strategy={editingStrategy}
              onClose={() => setEditingStrategy(null)}
              onSuccess={() => {
                setEditingStrategy(null);
                queryClient.invalidateQueries({ queryKey: ["strategies"] });
                toast.success("Strategy updated successfully!");
              }}
            />
          </Suspense>
        )}
      </Container>
    </PageLayout>
  );
});

Strategies.displayName = "Strategies";

export default Strategies;
