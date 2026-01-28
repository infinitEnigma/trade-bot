/** @format */

//import { User } from "../../../shared/src";

export interface BalanceData {
    walletBalance: number;
    accountBalance: number;
    availableBalance: number;
    totalAssets: number;
}

export interface Position {
    symbol: string;
    position_qty: string;
    unsettled_pnl: string;
    mark_price: string;
    average_open_price: string;
}

export interface Trade {
    symbol: string;
    side: string;
    avg_close_price?: string;
    avg_open_price?: string;
    closed_position_qty: string;
    close_timestamp?: number;
    open_timestamp?: number;
}

export interface PortfolioData {
    totalBalance: number;
    pnl: number;
    pnlPercent: number;
    dailyVolume: number;
    totalTrades: number;
}

export interface PortfolioPerformancePoint {
    time: string;
    value: number;
}

export interface DashboardState {
    balance: BalanceData | null;
    positions: Position[];
    trades: Trade[];
    portfolio: PortfolioData | null;
    performanceData: PortfolioPerformancePoint[];
    isLoading: boolean;
    error: string | null;
}

export interface DashboardActions {
    refreshData: () => Promise<void>;
    updateSymbol: (symbol: string) => void;
}
