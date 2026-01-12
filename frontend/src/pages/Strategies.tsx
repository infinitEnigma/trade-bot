/** @format */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Strategy, StrategyType } from "@trade-bot/shared";
import {
  Plus,
  Play,
  Square,
  Settings,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  BarChart3,
  Trash2,
  Edit,
  Zap,
} from "lucide-react";
import { StrategyForm } from "../components/StrategyForm";
import { BotControls } from "../components/BotControls";
import PriceChart from "../components/PriceChart";

const Strategies: React.FC = () => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const queryClient = useQueryClient();

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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  };

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
        {/* Price Chart */}
        <PriceChart />

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
};

export default Strategies;
