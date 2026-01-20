/** @format */

export interface AnalyticsTimeWindow {
    label: string;
    days: number;
    value: string;
}

export interface AnalyticsMetrics {
    totalReturn: number;
    winRate: number;
    totalTrades: number;
    avgTradeDuration: string;
    bestDay: string;
    worstDay: string;
    sharpeRatio: number;
    maxDrawdown: number;
    volatility: number;
    beta: number;
    alpha: number;
    marketCorrelation: number;
}

export interface SectorPerformance {
    sector: string;
    performance: number;
    contribution: number;
}

export interface PriceDataPoint {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface AnalyticsData {
    metrics: AnalyticsMetrics;
    sectorPerformance: SectorPerformance[];
    priceData: PriceDataPoint[];
    volumeData: { timestamp: number; volume: number }[];
}

export interface AnalyticsOptions {
    symbol: string;
    timeWindow: AnalyticsTimeWindow;
    enabled?: boolean;
}

export interface AnalyticsState {
    data: AnalyticsData | null;
    loading: boolean;
    error: string | null;
    progress: number;
    timeWindows: AnalyticsTimeWindow[];
}
