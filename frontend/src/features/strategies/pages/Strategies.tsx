/** @format */

import React, { useState, useEffect, Suspense, lazy } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { tradingApi } from "../../../infrastructure/api";
import { strategyService } from "../services/strategyService";
import { Strategy } from "../../../shared/types";
import { Plus, BarChart3, AlertTriangle, Settings } from "lucide-react";

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
import { useBalance } from "../../../shared/hooks";
import { useAuth } from "../../auth";
import { useBotsList } from "../../bots/hooks";
import { PageLayout, Container } from "../../../shared/components/layout";

const Strategies: React.FC = React.memo(() => {
  const { user } = useAuth();
  //const [_kodiakCheckComplete, setKodiakCheckComplete] = useState(false);
  const [kodiakError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  // Phase 2: after create, offer "start it now" — a strategy is created
  // inactive; starting a bot on it (C3a account pick + size) is the start.
  const [startPromptStrategy, setStartPromptStrategy] =
    useState<Strategy | null>(null);
  const [_selectedSymbol] = useState("PERP_BTC_USDC");
  const queryClient = useQueryClient();

  // Note: Kodiak connectivity check removed for simplicity
  // Individual components handle their own error states

  // Memory cleanup effect
  useEffect(() => {
    const cleanup = () => {
      // Clear React Query cache for strategies page
      queryClient.removeQueries({ queryKey: ["strategies"] });
      queryClient.removeQueries({ queryKey: ["bot-instances"] });

      // Force garbage collection if available
      if (window.gc && typeof window.gc === "function") {
        window.gc();
      }
    };

    // Cleanup on page hide/unmount
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, reduce memory usage
        queryClient.cancelQueries({ queryKey: ["strategies"] });
        queryClient.cancelQueries({ queryKey: ["bot-instances"] });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Periodic cleanup every 5 minutes
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
    return bots.find(
      (bot: { strategy_id: string }) => bot.strategy_id === strategyId
    );
  };

  // ✅ Fetch real balance data (WebSocket for verified users)
  const { balance: realBalance, loading: realBalanceLoading } = useBalance();

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

  // Show Kodiak connectivity error if check failed
  if (kodiakError) {
    return (
      <PageLayout className="flex items-center justify-center">
        <Container size="sm" className="text-center">
          <div className="glass-card p-8">
            <div className="w-12 h-12 mx-auto mb-6 bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-text mb-4">
              Trading Features Unavailable
            </h1>
            <p className="text-textMuted mb-6">{kodiakError}</p>
            <div className="space-y-3">
              <Link
                to="/settings"
                className="btn-primary w-full inline-flex items-center justify-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Connect Kodiak Account
              </Link>
              <Link
                to="/dashboard"
                className="btn-secondary w-full inline-flex items-center justify-center gap-2"
              >
                Return to Dashboard
              </Link>
            </div>
          </div>
        </Container>
      </PageLayout>
    );
  }

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
        <div className="mb-8">
          <Suspense
            fallback={
              <div className="glass-card p-6 animate-pulse">
                <div className="w-32 h-5 bg-surface rounded mb-4"></div>
                <div className="bg-surface rounded-lg h-110"></div>
              </div>
            }
          >
            <CandlestickChart
              symbol={_selectedSymbol}
              interval="1h"
              height={450}
            />
          </Suspense>
        </div>

        {/* Account Balance Overview - Show for users with Kodiak access */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-text">Account Balance</h2>
          </div>

          {realBalanceLoading ? (
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
          ) : realBalance ||
            user?.userLevel === "VERIFIED" ||
            user?.userLevel === "REGISTERED" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-blue-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Wallet</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${(realBalance?.walletBalance || 0).toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">Available funds</p>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-green-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Account</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${(realBalance?.accountBalance || 0).toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">Trading account</p>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-orange-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Available</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${(realBalance?.availableBalance || 0).toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">For trading</p>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-purple-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Total Assets</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${(realBalance?.totalAssets || 0).toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">Portfolio value</p>
              </div>
            </div>
          ) : (
            <div className="glass-card p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
                <div className="w-6 h-6 bg-red-500 rounded"></div>
              </div>
              <h3 className="text-lg font-semibold text-text mb-2">
                Kodiak Account Required
              </h3>
              <p className="text-textMuted mb-4">
                Connect your Kodiak trading account in Settings to view your
                balance and trading data.
              </p>
              <Link
                to="/settings"
                className="btn-primary inline-flex items-center gap-2"
              >
                Connect Account
              </Link>
            </div>
          )}
        </div>

        {/* Engine offline banner: informational only — bot instances are still
            fetched and start/stop still works (the backend ensures the engine
            on start). */}
        {engineStatus && engineStatus?.data?.running === false && (
          <div className="glass-card p-4 flex items-center gap-3 border-warning/20 bg-warning/5">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            <p className="text-sm text-textMuted">
              Trading engine is currently stopped. Existing bots are still
              listed below; starting a bot will bring the engine up.
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
