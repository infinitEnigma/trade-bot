/** @format */

import React from "react";
import { Strategy, StrategyType } from "@trade-bot/shared";
import { BarChart3 } from "lucide-react";
import { StrategyConfig } from "../types/strategies.types";
//import { Link } from "react-router-dom";
import { Card } from "../../../shared/components/ui";
import { StrategyCard } from "./StrategyCard";
//import { BotInstance, StrategyFormData } from "../../types/trading.types";

interface StrategyListProps {
  strategies: Strategy[];
  getBotForStrategy: (strategyId: string) => { id: string; status: "RUNNING" | "STOPPED" | "ERROR"; total_trades: number; total_pnl: number; } | undefined;
  onCreateStrategy: () => void;
  onEditStrategy: (strategy: Strategy) => void;
  onDeleteStrategy: (strategyId: string) => void;
  onBotStatusChange: () => void;
  isLoading: boolean;
  formatCurrency: (value: number) => string;
  validateStrategyConfig: (type: StrategyType, config: StrategyConfig) => { isValid: boolean; errors: string[] };
  formatStrategyType: (type: StrategyType) => string;
  getStrategyTypeColor: (type: StrategyType) => string;
}

/**
 * StrategyList component - displays grid of strategy cards
 */
export const StrategyList: React.FC<StrategyListProps> = ({
  strategies,
  getBotForStrategy,
  onCreateStrategy,
  onEditStrategy,
  onDeleteStrategy,
  onBotStatusChange,
  isLoading,
  formatCurrency,
  //validateStrategyConfig,
  formatStrategyType,
  getStrategyTypeColor,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <Card key={i} className="p-6">
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
          </Card>
        ))}
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <Card className="p-12 text-center">
        <BarChart3 className="w-12 h-12 text-textMuted mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-text mb-2">
          No Strategies Yet
        </h3>
        <p className="text-textMuted mb-6">
          Create your first automated trading strategy to get started.
        </p>
        <button
          onClick={onCreateStrategy}
          className="btn-primary"
        >
          Create Your First Strategy
        </button>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {strategies.map(strategy => {
        const bot = getBotForStrategy(strategy.id);

        return (
          <StrategyCard
            key={strategy.id}
            strategy={strategy}
            bot={bot}
            onEdit={onEditStrategy}
            onDelete={onDeleteStrategy}
            onBotStatusChange={onBotStatusChange}
            formatCurrency={formatCurrency}
            getStrategyTypeColor={getStrategyTypeColor}
            formatStrategyType={formatStrategyType}
          />
        );
      })}
    </div>
  );
};
