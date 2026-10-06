/** @format */

import { Strategy, StrategyType } from "../../../shared/types";

// Strategy Configuration Interfaces
export interface GridStrategyConfig {
  symbol: string;
  leverage: number;
  gridSize: number;
  gridRange: number;
  orderQuantity: number;
  takeProfit?: number;
  entryThreshold?: number;
  exitThreshold?: number;
  stopLoss?: number;
}

export interface TrendFollowingStrategyConfig {
  symbol: string;
  leverage: number;
  entryThreshold: number;
  exitThreshold: number;
  takeProfit?: number;
  stopLoss?: number;
}

export interface ArbitrageStrategyConfig {
  symbol: string;
  leverage: number;
  takeProfit?: number;
  stopLoss?: number;
}

export type StrategyConfig =
  | { type: StrategyType.GRID; config: GridStrategyConfig }
  | { type: StrategyType.TREND_FOLLOWING; config: TrendFollowingStrategyConfig }
  | { type: StrategyType.ARBITRAGE; config: ArbitrageStrategyConfig };

export interface StrategyRun {
  id: string;
  strategy_id: string;
  config_version: number;
  config: Record<string, unknown>;
  notional_amount: string;
  state: string;
  last_error_code: string | null;
}

export interface BotInstance {
  id: string;
  strategy_id: string;
  status: "RUNNING" | "STOPPED" | "ERROR" | "STARTING" | "STOPPING";
  total_trades: number;
  total_pnl: number;
  last_updated: string;
  config: StrategyConfig;
  /**
   * P0-3: the backend found an unresolved `RECONCILE_NEEDS_USER_ACTION` for
   * this bot — the engine was lost while the user still wants it running, and
   * the system deliberately will NOT auto-start it. Drives the "action
   * required" affordance next to the Resume button.
   */
  needsUserAction?: boolean;
  needsUserActionReason?: string | null;
  /**
   * D4 sessions: runs attached to this session (backend list query). Absent
   * on older payloads; the legacy `strategy_id` lookup covers those.
   */
  runs?: StrategyRun[];
}

/**
 * D4 sessions: the run inside a session that executes a strategy, if any.
 * Prefers an attached run over the legacy `strategy_id` column, so a
 * strategy moved between sessions resolves to the live one.
 */
export function getRunForStrategy(
  bots: Array<Pick<BotInstance, "runs" | "strategy_id">>,
  strategyId: string
): StrategyRun | undefined {
  for (const bot of bots) {
    const run = bot.runs?.find(r => r.strategy_id === strategyId);
    if (run) return run;
  }
  return undefined;
}

/**
 * D4 sessions: the session (bot row) that hosts a strategy — via its run
 * first, falling back to the legacy `strategy_id` column for pre-D rows.
 */
export function getSessionForStrategy<T extends { runs?: StrategyRun[]; strategy_id: string }>(
  bots: T[],
  strategyId: string
): T | undefined {
  return (
    bots.find(b => b.runs?.some(r => r.strategy_id === strategyId)) ??
    bots.find(b => b.strategy_id === strategyId)
  );
}

export interface TradingBalance {
  walletBalance: number;
  accountBalance: number;
  availableBalance: number;
  totalAssets: number;
}

export interface StrategyFormData {
  name: string;
  type: StrategyType;
  config: StrategyConfig;
  active: boolean;
}

export interface BotStatus {
  strategyId: string;
  status: BotInstance["status"];
  isLoading: boolean;
  error: string | null;
}

export interface MarketDataPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradingState {
  strategies: Strategy[];
  bots: BotInstance[];
  balance: TradingBalance | null;
  marketData: MarketDataPoint[];
  selectedSymbol: string;
  isLoading: boolean;
  error: string | null;
}

export interface TradingActions {
  createStrategy: (data: StrategyFormData) => Promise<void>;
  updateStrategy: (
    id: string,
    data: Partial<StrategyFormData>
  ) => Promise<void>;
  deleteStrategy: (id: string) => Promise<void>;
  startBot: (strategyId: string) => Promise<void>;
  stopBot: (strategyId: string) => Promise<void>;
  updateSymbol: (symbol: string) => void;
}

/**
 * Helper function to safely get strategy config with proper typing
 */
export function getStrategyConfig(strategy: Strategy): StrategyConfig | null {
  if (!strategy || !strategy.config) {
    return null;
  }

  // Handle legacy format where config might be a plain object
  if (typeof strategy.config === "object" && strategy.config !== null) {
    const config = strategy.config as unknown as Record<string, unknown>;

    switch (strategy.type) {
      case StrategyType.GRID:
        return {
          type: StrategyType.GRID,
          config: {
            symbol: (config.symbol as string) || "",
            leverage: (config.leverage as number) || 1,
            gridSize: (config.gridSize as number) || 10,
            gridRange: (config.gridRange as number) || 5,
            orderQuantity: (config.orderQuantity as number) || 1,
            takeProfit: config.takeProfit as number | undefined,
            entryThreshold: config.entryThreshold as number | undefined,
            exitThreshold: config.exitThreshold as number | undefined,
            stopLoss: config.stopLoss as number | undefined,
          },
        };
      case StrategyType.TREND_FOLLOWING:
        return {
          type: StrategyType.TREND_FOLLOWING,
          config: {
            symbol: (config.symbol as string) || "",
            leverage: (config.leverage as number) || 1,
            entryThreshold: (config.entryThreshold as number) || 0,
            exitThreshold: (config.exitThreshold as number) || 0,
            takeProfit: config.takeProfit as number | undefined,
            stopLoss: config.stopLoss as number | undefined,
          },
        };
      case StrategyType.ARBITRAGE:
        return {
          type: StrategyType.ARBITRAGE,
          config: {
            symbol: (config.symbol as string) || "",
            leverage: (config.leverage as number) || 1,
            takeProfit: config.takeProfit as number | undefined,
            stopLoss: config.stopLoss as number | undefined,
          },
        };
      default:
        return null;
    }
  }

  return null;
}
