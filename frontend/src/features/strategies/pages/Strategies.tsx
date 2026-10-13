/** @format */

import React, { useState, useEffect, Suspense, lazy } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  marketApi,
  tradingApi,
  accountsApi,
} from "../../../infrastructure/api";
import { Strategy } from "../../../shared/types";
import { Plus, BarChart3, AlertTriangle } from "lucide-react";
import { EngineJournalIntegrityNotice } from "../components/EngineJournalIntegrityNotice";
import { ConfirmDialog } from "../../../shared/components/ui";
import {
  buildChartSymbolGroups,
  resolveChartSelection,
  type ChartSelection,
  type ChartVenueRef,
  type VenueCatalog,
} from "../utils/chartSymbolPicker";
import { StrategyOverview } from "../components/StrategyOverview";
import { MarketDetailsSection } from "../components/MarketDetailsSection";
import { StrategyMasterList } from "../components/StrategyMasterList";
import { StrategyWorkspace } from "../components/StrategyWorkspace";
import { useOpenOrders } from "../hooks";

// Lazy load heavy components for better performance
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
import { useBotsList, getStateDisplayInfo } from "../../bots/hooks";
import {
  getExchangeAccountForStrategy,
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
  // P1: the strategy awaiting delete confirmation. Non-null opens the in-app
  // ConfirmDialog (replacing the native confirm()); we hold the full object so
  // the dialog can name it and show whether a bot is attached + its state.
  const [pendingDelete, setPendingDelete] = useState<Strategy | null>(null);
  // Phase 3 (slice 4): master-list selection — the workspace renders this
  // strategy. Derived during render (P1 pattern): an id that no longer
  // resolves (deleted row, refetch reorder) falls back to the first strategy,
  // so a non-empty list always shows a workspace and the detail pane never
  // blanks.
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(
    null
  );
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
  // P1: loading, a successful empty list, and a failed fetch are three
  // DIFFERENT states and must render three different things. Before, only
  // `isLoading` was read and a failed fetch fell through to the "No Strategies
  // Yet" empty state — making an API failure look like an empty account. Keep
  // `isError`/`error`/`refetch` so the page can show "Couldn't load strategies"
  // with a Retry action instead.
  const {
    data: strategiesData,
    isLoading,
    isError,
    error: strategiesError,
    refetch: refetchStrategies,
  } = useQuery({
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
  // Phase 3 (slice 4): the workspace's strategy — the operator's explicit
  // pick wins; anything else falls back to the first row (initial load,
  // deleted selection). Pure derivation, no effect needed.
  const selectedStrategy =
    (strategies as Strategy[]).find(s => s.id === selectedStrategyId) ??
    (strategies as Strategy[])[0] ??
    null;

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
    chartSelectionOverride ?? resolveChartSelection(catalogs, strategySymbols);
  const chartSymbol = chartSelection.symbol;
  const chartGroups = buildChartSymbolGroups(catalogs, strategySymbols);
  const chartOptionCount = chartGroups.reduce(
    (count, group) => count + group.symbols.length,
    0
  );

  // Phase 3 (slice 3): the open-orders book for the charted market, drawn as
  // levels/markers on the chart. Orders are account-scoped on the backend, so
  // scope to the first ACTIVE account of the CHARTED venue — the chart is a
  // market view; the master-detail workspace (slice 4) scopes by the selected
  // strategy's own account. `symbol` matches the chart selection (backend
  // normalises venue forms, bare `BTC` included). No ACTIVE account of the
  // charted venue ⇒ nothing of ours can rest there, so the query stays off.
  const chartAccountId = (accountsQuery.data?.data?.accounts ?? []).find(
    account =>
      account.status === "ACTIVE" &&
      account.exchange === chartSelection.exchange &&
      account.environment === chartSelection.environment
  )?.id;
  const chartOrdersQuery = useOpenOrders(
    { exchangeAccountId: chartAccountId, symbol: chartSymbol },
    { enabled: !!chartAccountId }
  );

  // Phase 3 (slice 4): the workspace's open-orders table — scoped to the
  // SELECTED STRATEGY's venue account (strategy → hosting session → account
  // via getExchangeAccountForStrategy; sessions carry the binding, strategy
  // rows never do). A null resolution (no session, or a legacy row predating
  // the C3a binding) falls back to the backend's default-account read — the
  // documented D4 unscoped fallback — and the strategy's symbol narrows the
  // book. Same hook as the chart's levels: an identical scope shares one
  // cache entry; the chart above stays a market view of the charted venue.
  const workspaceOrdersQuery = useOpenOrders(
    {
      exchangeAccountId:
        (selectedStrategy &&
          getExchangeAccountForStrategy(bots, selectedStrategy.id)) ||
        undefined,
      symbol:
        (selectedStrategy &&
          getStrategyConfig(selectedStrategy)?.config.symbol) ||
        undefined,
    },
    { enabled: !!selectedStrategy }
  );

  // Delete strategy mutation.
  // P1: surface the server's actionable error (e.g. a bot that must be stopped
  // first, an ownership/lifecycle refusal) instead of a generic toast. The
  // dialog stays open on failure so the operator sees WHY; it closes on
  // success. Backend ownership/lifecycle checks remain authoritative.
  const deleteMutation = useMutation({
    mutationFn: (strategyId: string) => tradingApi.deleteStrategy(strategyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      queryClient.invalidateQueries({ queryKey: ["bot-instances"] });
      setPendingDelete(null);
      toast.success("Strategy deleted successfully");
    },
    onError: (error: unknown) => {
      toast.error(readDeleteErrorMessage(error, "Failed to delete strategy"), {
        duration: 6000,
      });
    },
  });

  const handleDeleteStrategy = (strategy: Strategy) => {
    setPendingDelete(strategy);
  };

  const confirmDeleteStrategy = () => {
    if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
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

        {/* Journal-integrity notice (F4): sticky reconciliation alert (observed
            UNKNOWN, red) OR verification-pending (UNVERIFIED, amber). Keyed on
            the sticky alert for the severe case so an unresolved gap stays
            visible even if the latest heartbeat reports healthy. Precedence and
            copy live in the component. See docs/FINANCIAL_RECONCILIATION.md. */}
        <EngineJournalIntegrityNotice
          journalIntegrity={engineStatus?.data?.journalIntegrity}
          journalIntegrityAlert={engineStatus?.data?.journalIntegrityAlert}
          variant="banner"
        />

        {/* Overview — real Running / Stopped / Needs-attention counts
            derived from live bot state (navigation aid, not metrics). */}
        <StrategyOverview bots={bots} />

        {/* Strategy list — four distinct states, in precedence order:
            ERROR (couldn't fetch — never imply an empty account) → loading
            skeleton → genuinely-empty (no strategies exist) → the grid. */}
        {isError ? (
          <div className="glass-card p-12 text-center">
            <AlertTriangle className="w-12 h-12 text-danger mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-text mb-2">
              Couldn't load strategies
            </h3>
            <p className="text-textMuted mb-6 max-w-md mx-auto">
              We couldn't reach the strategies service. This doesn't mean you
              have no strategies — your list simply couldn't be retrieved. Try
              again; if it keeps failing, check your connection.
            </p>
            {strategiesError instanceof Error && strategiesError.message ? (
              <p className="text-xs text-textMuted mb-6 font-mono break-words">
                {strategiesError.message}
              </p>
            ) : null}
            <button onClick={() => refetchStrategies()} className="btn-primary">
              Try again
            </button>
          </div>
        ) : isLoading ? (
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
          /* Phase 3 (slice 4): master–detail — the compact selectable list
             beside the selected strategy's workspace (control panel). The
             market/portfolio reference stays below (Phase 2 IA); the chart
             remains a market view (first ACTIVE account of the charted
             venue) while the workspace's orders scope to the selected
             strategy's own account. */
          <div className="grid grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)] gap-6 items-start">
            <StrategyMasterList
              strategies={strategies as Strategy[]}
              bots={bots}
              selectedId={selectedStrategy?.id}
              onSelect={strategy => setSelectedStrategyId(strategy.id)}
            />
            {selectedStrategy && (
              <StrategyWorkspace
                strategy={selectedStrategy}
                bot={getBotForStrategy(selectedStrategy.id)}
                orders={workspaceOrdersQuery.data?.data ?? []}
                ordersLoading={workspaceOrdersQuery.isLoading}
                ordersError={workspaceOrdersQuery.isError}
                ordersUpdatedAt={workspaceOrdersQuery.dataUpdatedAt}
                onEdit={setEditingStrategy}
                onDelete={handleDeleteStrategy}
                onBotStatusChange={() => {
                  queryClient.invalidateQueries({
                    queryKey: ["bot-instances"],
                  });
                }}
              />
            )}
          </div>
        )}

        {/* Market + portfolio figures: reference detail moved BELOW the
            strategy list (Phase 2 IA) into a collapsible section. */}
        <MarketDetailsSection
          chartOptionCount={chartOptionCount}
          chartGroups={chartGroups}
          chartSelection={chartSelection}
          chartSymbol={chartSymbol}
          onChartSelectionChange={setChartSelectionOverride}
          portfolioSummary={portfolioSummary}
          isVerified={user?.userLevel === "VERIFIED"}
          orders={chartOrdersQuery.data?.data ?? []}
        />

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
                // Phase 3: also bind the workspace to the new strategy so
                // the prompt's target and the detail pane agree.
                if (created) {
                  setStartPromptStrategy(created);
                  setSelectedStrategyId(created.id);
                }
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

        {/* P1: in-app delete confirmation (replaces native confirm()). Names
            the strategy and — when a bot is bound to it — its current lifecycle
            state, and states the stop-first prerequisite. Backend ownership /
            lifecycle checks remain authoritative; this only frames the action
            and surfaces whatever the server returns. */}
        <ConfirmDialog
          open={!!pendingDelete}
          onClose={() => {
            // Only allow closing when no delete is in flight (the dialog is
            // non-dismissible while loading), so a stray close can't strand a
            // half-open confirmation.
            if (!deleteMutation.isPending) setPendingDelete(null);
          }}
          onConfirm={confirmDeleteStrategy}
          title="Delete strategy?"
          tone="danger"
          confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
          loading={deleteMutation.isPending}
        >
          {(() => {
            const bot = pendingDelete
              ? getBotForStrategy(pendingDelete.id)
              : undefined;
            const botIsLive =
              !!bot && bot.status !== "STOPPED" && bot.status !== "ERROR";
            return (
              <>
                <p>
                  You're about to permanently delete{" "}
                  <span className="font-medium text-text">
                    “{pendingDelete?.name}”
                  </span>
                  . This removes the strategy and its configuration. It can't be
                  undone.
                </p>
                {bot ? (
                  <p className="text-warning">
                    A bot is currently associated with this strategy and is{" "}
                    <span className="font-medium">
                      {getStateDisplayInfo(bot.status).label}
                    </span>
                    .{" "}
                    {botIsLive
                      ? "Stop the bot first — a running bot can't be deleted."
                      : "Its history row will be removed with the strategy."}
                  </p>
                ) : (
                  <p>No bot is associated with this strategy.</p>
                )}
              </>
            );
          })()}
        </ConfirmDialog>

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

/**
 * Extract an actionable message from a delete failure. Same error-shape
 * handling the strategy form uses (Error / axios `response.data.error` /
 * fallback) so a backend refusal (e.g. "stop the bot first", ownership) reads
 * as a real reason rather than a generic toast.
 */
function readDeleteErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
    ) {
      return (data as { error: string }).error;
    }
  }
  return fallback;
}

export default Strategies;
