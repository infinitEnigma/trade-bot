/** @format */

import React, { Suspense } from "react";
import { Strategy, StrategyType } from "@trade-bot/shared";
import { Zap, Edit, Trash2} from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { BotControls } from "../bots/components/BotControls";
import { getStrategyConfig } from "../types/strategies.types";
//import { BotInstance } from "../../types/trading.types";

interface StrategyCardProps {
  strategy: Strategy;
  bot?: {
    id: string;
    status: "RUNNING" | "STOPPED" | "ERROR";
    total_trades: number;
    total_pnl: number;
  };
  onEdit: (strategy: Strategy) => void;
  onDelete: (strategyId: string) => void;
  onBotStatusChange: () => void;
  formatCurrency: (value: number) => string;
  getStrategyTypeColor: (type: StrategyType) => string;
  formatStrategyType: (type: StrategyType) => string;
}

/**
 * StrategyCard component - displays individual strategy with bot controls
 */
export const StrategyCard: React.FC<StrategyCardProps> = ({
  strategy,
  bot,
  onEdit,
  onDelete,
  onBotStatusChange,
  formatCurrency,
  getStrategyTypeColor,
  formatStrategyType,
}) => {
  const strategyConfig = getStrategyConfig(strategy);
  //const config = strategyConfig?.config || {};

  return (
    <Card className="p-6">
      {/* Strategy Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-text">{strategy.name}</h3>
            <p className="text-sm text-textMuted capitalize">
              {formatStrategyType(strategy.type)}
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
            {strategyConfig && 'symbol' in strategyConfig.config
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
                {strategyConfig && 'gridSize' in strategyConfig.config
                  ? (strategyConfig.config.gridSize as number) || 0
                  : 0} levels
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-textMuted">Range:</span>
              <span className="text-text">
                {strategyConfig && 'gridRange' in strategyConfig.config
                  ? (strategyConfig.config.gridRange as number) || 0
                  : 0}%
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-textMuted">Order Qty:</span>
              <span className="text-text">
                {strategyConfig && 'orderQuantity' in strategyConfig.config
                  ? (strategyConfig.config.orderQuantity as number) || 0
                  : 0}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Bot Status */}
      {bot && (
        <div className={`bg-surface rounded p-3 mb-4 ${getStrategyTypeColor(strategy.type)}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text">Bot Status</span>
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
              <span className="text-text">{bot.total_trades || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-textMuted">PnL:</span>
              <span
                className={`font-medium ${
                  (bot.total_pnl || 0) >= 0 ? "text-success" : "text-danger"
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
          <Suspense
            fallback={
              <div className="w-24 h-8 bg-surface rounded animate-pulse" />
            }
          >
            <BotControls
              strategyId={strategy.id}
              bot={bot}
              onStatusChange={onBotStatusChange}
            />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="w-24 h-8 bg-surface rounded animate-pulse" />
            }
          >
            <BotControls
              strategyId={strategy.id}
              onStatusChange={onBotStatusChange}
            />
          </Suspense>
        )}

        <button
          onClick={() => onEdit(strategy)}
          className="p-2 rounded-lg hover:bg-surface transition-colors"
          title="Edit Strategy"
        >
          <Edit className="w-4 h-4 text-textMuted hover:text-text" />
        </button>

        <button
          onClick={() => onDelete(strategy.id)}
          className="p-2 rounded-lg hover:bg-surface transition-colors"
          title="Delete Strategy"
        >
          <Trash2 className="w-4 h-4 text-danger hover:text-danger" />
        </button>
      </div>
    </Card>
  );
};
