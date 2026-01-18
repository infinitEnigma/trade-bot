/** @format */

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { chartDataCache } from "../utils/chart-cache";

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

interface AnalyticsData {
    metrics: AnalyticsMetrics;
    sectorPerformance: SectorPerformance[];
    priceData: any[];
    volumeData: any[];
}

interface UseAnalyticsDataOptions {
    symbol: string;
    timeWindow: AnalyticsTimeWindow;
    enabled?: boolean;
}

export const useAnalyticsData = ({
    symbol,
    timeWindow,
    enabled = true,
}: UseAnalyticsDataOptions) => {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    // Refs for managing loading state
    const abortControllerRef = useRef<AbortController | null>(null);
    const isLoadingRef = useRef(false);

    // Predefined time windows
    const TIME_WINDOWS: AnalyticsTimeWindow[] = [
        { label: '7 Days', days: 7, value: '7d' },
        { label: '30 Days', days: 30, value: '30d' },
        { label: '90 Days', days: 90, value: '90d' },
        { label: '6 Months', days: 180, value: '180d' },
        { label: '1 Year', days: 365, value: '365d' },
    ];



    // Load data in chunks to prevent memory issues
    const loadDataInChunks = useCallback(async (
        symbol: string,
        totalDays: number,
        signal: AbortSignal
    ) => {
        const chunks = [];
        const chunkSize = 30; // 30 days per chunk
        const totalChunks = Math.ceil(totalDays / chunkSize);

        for (let i = 0; i < totalDays; i += chunkSize) {
            if (signal.aborted) break;

            const chunkDays = Math.min(chunkSize, totalDays - i);
            const chunkStart = new Date();
            chunkStart.setDate(chunkStart.getDate() - (totalDays - i));
            const chunkEnd = new Date();
            chunkEnd.setDate(chunkEnd.getDate() - (totalDays - i - chunkDays));

            try {
                const chunkData = await loadHistoricalChunk(
                    symbol,
                    chunkStart,
                    chunkEnd
                );
                chunks.push(chunkData);

                // Update progress
                const completedChunks = Math.floor(i / chunkSize) + 1;
                setProgress(completedChunks / totalChunks);

            } catch (error) {
                if (!signal.aborted) {
                    throw error;
                }
            }
        }

        return chunks;
    }, []);

    // Load a single 30-day chunk of historical data
    const loadHistoricalChunk = useCallback(async (
        symbol: string,
        startDate: Date,
        endDate: Date
    ) => {
        const cacheKey = `analytics-${symbol}-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}`;

        // Check cache first
        const cachedData = chartDataCache.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }

        // Load from API
        const response = await api.getTvHistory({
            symbol: symbol,
            resolution: '1D', // Daily data for analytics
            from: Math.floor(startDate.getTime() / 1000),
            to: Math.floor(endDate.getTime() / 1000),
        });

        if (!response.success || !response.data) {
            throw new Error('Failed to load historical data');
        }

        // Transform and cache the data
        const transformedData = transformTradingViewData(response.data);
        chartDataCache.set(cacheKey, transformedData);

        return transformedData;
    }, []);

    // Transform TradingView data to analytics format
    const transformTradingViewData = useCallback((tvData: any) => {
        if (!tvData || typeof tvData !== 'object') return [];

        const { t: timestamps, o: opens, h: highs, l: lows, c: closes, v: volumes } = tvData;

        if (!timestamps || !Array.isArray(timestamps)) return [];

        return timestamps.map((time: number, index: number) => ({
            timestamp: time,
            open: opens?.[index] || 0,
            high: highs?.[index] || 0,
            low: lows?.[index] || 0,
            close: closes?.[index] || 0,
            volume: volumes?.[index] || 0,
        }));
    }, []);

    // Calculate analytics metrics from historical data
    const calculateAnalyticsMetrics = useCallback((priceData: any[]): AnalyticsMetrics => {
        if (!priceData || priceData.length === 0) {
            return {
                totalReturn: 0,
                winRate: 0,
                totalTrades: 0,
                avgTradeDuration: '0 hours',
                bestDay: '0%',
                worstDay: '0%',
                sharpeRatio: 0,
                maxDrawdown: 0,
                volatility: 0,
                beta: 0,
                alpha: 0,
                marketCorrelation: 0,
            };
        }

        // Calculate basic metrics
        const firstPrice = priceData[0]?.close || 0;
        const lastPrice = priceData[priceData.length - 1]?.close || 0;
        const totalReturn = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

        // Calculate daily returns
        const dailyReturns = [];
        for (let i = 1; i < priceData.length; i++) {
            const prevClose = priceData[i - 1]?.close || 0;
            const currentClose = priceData[i]?.close || 0;
            if (prevClose > 0) {
                dailyReturns.push((currentClose - prevClose) / prevClose);
            }
        }

        // Calculate volatility (standard deviation of returns)
        const avgReturn = dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;
        const variance = dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / dailyReturns.length;
        const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized volatility

        // Find best and worst days
        const dailyReturnPercents = dailyReturns.map(ret => ret * 100);
        const bestDay = Math.max(...dailyReturnPercents);
        const worstDay = Math.min(...dailyReturnPercents);

        // Mock additional metrics (would be calculated from real trading data)
        return {
            totalReturn,
            winRate: 68.5, // Mock
            totalTrades: Math.floor(priceData.length * 0.1), // Mock
            avgTradeDuration: '2.3 hours', // Mock
            bestDay: `+${bestDay.toFixed(1)}%`,
            worstDay: `${worstDay.toFixed(1)}%`,
            sharpeRatio: 1.8, // Mock
            maxDrawdown: Math.abs(worstDay), // Simplified
            volatility: volatility,
            beta: 0.85, // Mock
            alpha: 3.2, // Mock
            marketCorrelation: 0.72, // Mock
        };
    }, []);

    // Calculate sector performance (mock data for now)
    const calculateSectorPerformance = useCallback((): SectorPerformance[] => {
        return [
            { sector: 'DeFi', performance: 15.2, contribution: 35 },
            { sector: 'NFT', performance: -3.1, contribution: 15 },
            { sector: 'Gaming', performance: 8.7, contribution: 25 },
            { sector: 'Infrastructure', performance: 22.1, contribution: 25 },
        ];
    }, []);

    // Main data loading function
    const loadAnalyticsData = useCallback(async () => {
        if (!enabled || isLoadingRef.current) return;

        // Cancel any existing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
            isLoadingRef.current = true;
            setLoading(true);
            setError(null);
            setProgress(0);

            // Load data in chunks
            const chunks = await loadDataInChunks(symbol, timeWindow.days, abortController.signal);

            if (abortController.signal.aborted) return;

            // Merge all chunks
            const allPriceData = chunks.flat();

            // Calculate metrics
            const metrics = calculateAnalyticsMetrics(allPriceData);
            const sectorPerformance = calculateSectorPerformance();

            const analyticsData: AnalyticsData = {
                metrics,
                sectorPerformance,
                priceData: allPriceData,
                volumeData: allPriceData.map(d => ({ timestamp: d.timestamp, volume: d.volume })),
            };

            setData(analyticsData);
            setProgress(1);

        } catch (err: any) {
            if (!abortController.signal.aborted) {
                setError(err.message || 'Failed to load analytics data');
            }
        } finally {
            isLoadingRef.current = false;
            setLoading(false);
            abortControllerRef.current = null;
        }
    }, [enabled, symbol, timeWindow, loadDataInChunks, calculateAnalyticsMetrics, calculateSectorPerformance]);

    // Load data when dependencies change
    useEffect(() => {
        loadAnalyticsData();
    }, [loadAnalyticsData]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    return {
        data,
        loading,
        error,
        progress,
        timeWindows: TIME_WINDOWS,
        refetch: loadAnalyticsData,
    };
};
