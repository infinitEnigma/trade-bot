/** @format */

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Strategy, StrategyType } from "@trade-bot/shared";
import {
  Plus,
  BarChart3,
  Trash2,
  Edit,
  Zap,
  AlertTriangle,
  Settings,
} from "lucide-react";
import { StrategyForm } from "../components/StrategyForm";
import { BotControls } from "../components/BotControls";
import CandlestickChart from "../components/CandlestickChart";
import { useBalance } from "../hooks/useBalance";
import { useAuth } from "../contexts/AuthContext";

const Strategies: React.FC = React.memo(() => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [kodiakCheckComplete, setKodiakCheckComplete] = useState(false);
  const [kodiakError, setKodiakError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState("PERP_BTC_USDC");
  const queryClient = useQueryClient();

  // ✅ Kodiak connectivity check - required for trading features
  useEffect(() => {
    const checkKodiakConnectivity = async () => {
      try {
        setKodiakError(null);

        console.log("Strategies: Checking Kodiak connectivity");
        console.log("Strategies: User object:", user);
        console.log("Strategies: User hasKodiak:", (user as any)?.hasKodiak);
        console.log("Strategies: User kodiakStatus:", (user as any)?.kodiakStatus);

        // Check if user has Kodiak credentials
        if (!(user as any)?.hasKodiak) {
          console.log("Strategies: No Kodiak credentials found, showing error screen");
          setKodiakError("No Kodiak account connected");
          return;
        }

        // Get Kodiak status
        const statusResponse = await api.getKodiakStatus();
        if (!statusResponse.success || !statusResponse.data?.verified) {
          setKodiakError("Kodiak credentials not verified");
          return;
        }

        // Try a simple API call to verify connectivity
        await api.getCurrentBalance();

        // All checks passed
        setKodiakCheckComplete(true);

      } catch (error: any) {
        console.error("Kodiak connectivity check failed:", error);

        if (error.response?.status === 403) {
          setKodiakError("Kodiak authentication failed. Please reconnect your account.");
        } else if (error.response?.status === 503) {
          setKodiakError("Kodiak service temporarily unavailable.");
        } else {
          setKodiakError("Unable to connect to Kodiak services.");
        }
      }
    };

    if (user) {
      checkKodiakConnectivity();
    }
  }, [user]);

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
    queryFn: () => api.getStrategies(),
  });

  // Fetch bot instances
  const { data: botsData } = useQuery({
    queryKey: ["bot-instances"],
    queryFn: () => api.getBotInstances(),
  });

  const strategies = strategiesData?.success ? strategiesData.data : [];
  const bots = botsData?.success ? botsData.data : [];

  // Delete strategy mutation
  const deleteMutation = useMutation({
    mutationFn: (strategyId: string) => api.deleteStrategy(strategyId),
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
    return bots.find((bot: any) => bot.strategy_id === strategyId);
  };

  // ✅ Fetch real balance data (WebSocket for verified users)
  const { balance: realBalance, loading: realBalanceLoading } = useBalance();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  // Show Kodiak connectivity error if check failed
  if (kodiakError) {
    return (
      <div className="container mx-auto px-4 py-10 space-y-10 bg-background min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 bg-red-500/10 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-text mb-4">
            Trading Features Unavailable
          </h1>
          <p className="text-textMuted mb-6">
            {kodiakError}
          </p>
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
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 space-y-10 bg-background">
      {/* Header */}
      <header className="glass-card border-b border-white/5 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
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
              {/* Navigation Links */}
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  to="/dashboard"
                  className="px-3 py-2 text-sm text-textMuted hover:text-text hover:bg-white/5 rounded-lg transition-colors"
                >
                  Dashboard
                </Link>
                <span className="px-3 py-2 text-sm text-primary font-medium bg-primary/10 rounded-lg">
                  Strategies
                </span>
                <Link
                  to="/settings"
                  className="px-3 py-2 text-sm text-textMuted hover:text-text hover:bg-white/5 rounded-lg transition-colors"
                >
                  Settings
                </Link>
              </nav>

              <button
                onClick={() => setShowCreateForm(true)}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Create Strategy
              </button>
            </div>
          </div>

          {/* Mobile Navigation */}
          <div className="md:hidden mt-4 pt-4 border-t border-white/5">
            <nav className="flex items-center justify-center gap-1">
              <Link
                to="/dashboard"
                className="px-4 py-2 text-sm text-textMuted hover:text-text hover:bg-white/5 rounded-lg transition-colors"
              >
                Dashboard
              </Link>
              <span className="px-4 py-2 text-sm text-primary font-medium bg-primary/10 rounded-lg">
                Strategies
              </span>
              <Link
                to="/settings"
                className="px-4 py-2 text-sm text-textMuted hover:text-text hover:bg-white/5 rounded-lg transition-colors"
              >
                Settings
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Candlestick Chart - Advanced trading data for verified users */}
        <div className="mb-8">
          <CandlestickChart
            symbol={selectedSymbol}
            interval="1h"
            height={450}
          />
        </div>

        {/* Account Balance Overview - WebSocket data for verified users */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-text">
              Account Balance
            </h2>
          </div>

          {realBalanceLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
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
          ) : realBalance ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <div className="w-5 h-5 bg-blue-500 rounded"></div>
                  </div>
                  <span className="text-sm text-textMuted">Wallet</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${realBalance.walletBalance.toLocaleString()}
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
                  ${realBalance.accountBalance.toLocaleString()}
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
                  ${realBalance.availableBalance.toLocaleString()}
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
                  ${realBalance.totalAssets.toLocaleString()}
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
                Connect your Kodiak trading account in Settings to view your balance and trading data.
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

        {/* Strategies Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
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
            <BarChart3 className="w-16 h-16 text-textMuted mx-auto mb-4" />
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
              const config = strategy.config as any;

              return (
                <div key={strategy.id} className="glass-card p-6">
                  {/* Strategy Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Zap className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-text">
                          {strategy.name}
                        </h3>
                        <p className="text-sm text-textMuted capitalize">
                          {strategy.type.replace("_", " ").toLowerCase()}
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
                      >
                        {strategy.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>

                  {/* Strategy Config */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-textMuted">Symbol:</span>
                      <span className="text-text font-medium">
                        {config.symbol
                          ?.replace("PERP_", "")
                          .replace("_USDC", "") || "N/A"}
                      </span>
                    </div>
                    {strategy.type === StrategyType.GRID && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-textMuted">Grid Size:</span>
                          <span className="text-text">
                            {config.gridSize || 0} levels
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-textMuted">Range:</span>
                          <span className="text-text">
                            {config.gridRange || 0}%
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-textMuted">Order Qty:</span>
                          <span className="text-text">
                            {config.orderQuantity || 0}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Bot Status */}
                  {bot && (
                    <div className="bg-surface rounded p-3 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-text">
                          Bot Status
                        </span>
                        <span
                          className={`px-2 py-1 text-xs rounded ${
                            bot.status === "RUNNING"
                              ? "bg-success/20 text-success"
                              : bot.status === "STOPPED"
                              ? "bg-warning/20 text-warning"
                              : "bg-danger/20 text-danger"
                          }`}
                        >
                          {bot.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-textMuted">Trades:</span>
                          <span className="text-text">
                            {bot.total_trades || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-textMuted">PnL:</span>
                          <span
                            className={`font-medium ${
                              (bot.total_pnl || 0) >= 0
                                ? "text-success"
                                : "text-danger"
                            }`}
                          >
                            {formatCurrency(bot.total_pnl || 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {bot ? (
                      <BotControls
                        strategyId={strategy.id}
                        bot={bot}
                        onStatusChange={() => {
                          queryClient.invalidateQueries({
                            queryKey: ["bot-instances"],
                          });
                        }}
                      />
                    ) : (
                      <BotControls
                        strategyId={strategy.id}
                        onStatusChange={() => {
                          queryClient.invalidateQueries({
                            queryKey: ["bot-instances"],
                          });
                        }}
                      />
                    )}

                    <button
                      onClick={() => setEditingStrategy(strategy)}
                      className="p-2 rounded-lg hover:bg-surface transition-colors"
                      title="Edit Strategy"
                    >
                      <Edit className="w-4 h-4 text-textMuted hover:text-text" />
                    </button>

                    <button
                      onClick={() => handleDeleteStrategy(strategy.id)}
                      className="p-2 rounded-lg hover:bg-surface transition-colors"
                      title="Delete Strategy"
                    >
                      <Trash2 className="w-4 h-4 text-danger hover:text-danger" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Strategy Form Modals */}
        {showCreateForm && (
          <StrategyForm
            onClose={() => setShowCreateForm(false)}
            onSuccess={() => {
              setShowCreateForm(false);
              queryClient.invalidateQueries({ queryKey: ["strategies"] });
              toast.success("Strategy created successfully!");
            }}
          />
        )}

        {editingStrategy && (
          <StrategyForm
            strategy={editingStrategy}
            onClose={() => setEditingStrategy(null)}
            onSuccess={() => {
              setEditingStrategy(null);
              queryClient.invalidateQueries({ queryKey: ["strategies"] });
              toast.success("Strategy updated successfully!");
            }}
          />
        )}
      </div>
    </div>
  );
});

Strategies.displayName = "Strategies";

export default Strategies;
