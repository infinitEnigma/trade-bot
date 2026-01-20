/** @format */

import { Strategy, StrategyType } from "@trade-bot/shared";

export interface BotInstance {
    id: string;
    strategy_id: string;
    status: "RUNNING" | "STOPPED" | "ERROR" | "STARTING" | "STOPPING";
    total_trades: number;
    total_pnl: number;
    last_updated: string;
    config: Record<string, any>;
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
    config: Record<string, any>;
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
    updateStrategy: (id: string, data: Partial<StrategyFormData>) => Promise<void>;
    deleteStrategy: (id: string) => Promise<void>;
    startBot: (strategyId: string) => Promise<void>;
    stopBot: (strategyId: string) => Promise<void>;
    updateSymbol: (symbol: string) => void;
}
