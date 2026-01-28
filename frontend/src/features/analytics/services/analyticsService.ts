/** @format */

import { marketApi } from "../../../infrastructure/api";
import { chartDataCache } from "../../../infrastructure/cache";
import { UserLevel } from "../../../../../shared/src";
import {
    AnalyticsTimeWindow,
    AnalyticsMetrics,
    SectorPerformance,
    PriceDataPoint,
    AnalyticsData
} from "../types/analytics.types";

interface TradingViewData {
    t?: number[]; // timestamps
    o?: number[]; // opens
    h?: number[]; // highs
    l?: number[]; // lows
    c?: number[]; // closes
    v?: number[]; // volumes
}

/**
 * Analytics Service
 * Handles all analytics-related data fetching and calculations
 */
export class AnalyticsService {
    private static instance: AnalyticsService;

    private constructor() { }

    public static getInstance(): AnalyticsService {
        if (!AnalyticsService.instance) {
            AnalyticsService.instance = new AnalyticsService();
        }
        return AnalyticsService.instance;
    }

    /**
     * Predefined time windows
     */
    getTimeWindows(): AnalyticsTimeWindow[] {
        return [
            { label: '7 Days', days: 7, value: '7d' },
            { label: '30 Days', days: 30, value: '30d' },
            { label: '90 Days', days: 90, value: '90d' },
            { label: '6 Months', days: 180, value: '180d' },
            { label: '1 Year', days: 365, value: '365d' },
        ];
    }

    /**
     * Load data in chunks with pagination to prevent memory issues
     */
    async loadDataInChunks(
        symbol: string,
        totalDays: number,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<PriceDataPoint[]> {
        const chunks: PriceDataPoint[] = [];
        const maxTotalDays = 365; // Cap at 1 year to prevent excessive loading
        const effectiveTotalDays = Math.min(totalDays, maxTotalDays);

        // Implement progressive loading: load recent data first, then older data
        const recentDays = Math.min(90, effectiveTotalDays); // Load last 90 days first
        const remainingDays = effectiveTotalDays - recentDays;

        // Load recent data first (higher priority)
        if (recentDays > 0) {
            const recentStart = new Date();
            recentStart.setDate(recentStart.getDate() - recentDays);
            const recentEnd = new Date();

            try {
                const recentData = await this.loadHistoricalChunk(
                    symbol,
                    recentStart,
                    recentEnd
                );
                chunks.push(...recentData);
                onProgress?.(0.5); // 50% progress after recent data
            } catch (error) {
                if (!signal?.aborted) {
                    throw error;
                }
            }
        }

        // Load older historical data in background if needed
        if (remainingDays > 0 && !signal?.aborted) {
            const historicalChunkSize = 60; // Larger chunks for older data

            for (let i = 0; i < remainingDays; i += historicalChunkSize) {
                if (signal?.aborted) break;

                const chunkDays = Math.min(historicalChunkSize, remainingDays - i);
                const chunkStart = new Date();
                chunkStart.setDate(chunkStart.getDate() - (remainingDays - i + recentDays));
                const chunkEnd = new Date();
                chunkEnd.setDate(chunkEnd.getDate() - (remainingDays - i - chunkDays + recentDays));

                try {
                    const chunkData = await this.loadHistoricalChunk(
                        symbol,
                        chunkStart,
                        chunkEnd
                    );
                    chunks.push(...chunkData);

                    // Update progress incrementally
                    const historicalProgress = (i + chunkDays) / remainingDays;
                    onProgress?.(0.5 + (historicalProgress * 0.4)); // 50-90% for historical data

                } catch (error) {
                    if (!signal?.aborted) {
                        // Log error but continue with other chunks
                        console.warn('Failed to load historical chunk:', error);
                    }
                }
            }
        }

        onProgress?.(0.9); // 90% complete
        return chunks;
    }

    /**
     * Load a single chunk of historical data
     */
    private async loadHistoricalChunk(
        symbol: string,
        startDate: Date,
        endDate: Date
    ): Promise<PriceDataPoint[]> {
        const cacheKey = `analytics-${symbol}-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}`;

        // Check cache first
        const cachedData = chartDataCache.get(cacheKey);
        if (cachedData) {
            // Type assertion: analytics cache only stores PriceDataPoint[]
            return cachedData as PriceDataPoint[];
        }

        // Load from API
        const response = await marketApi.getTvHistory({
            symbol,
            resolution: '1D', // Daily data for analytics
            from: Math.floor(startDate.getTime() / 1000),
            to: Math.floor(endDate.getTime() / 1000),
        });

        if (!response.success || !response.data) {
            throw new Error('Failed to load historical data');
        }

        // Transform and cache the data
        const transformedData = this.transformTradingViewData(response.data);
        chartDataCache.set(cacheKey, transformedData);

        return transformedData;
    }

    /**
     * Transform TradingView data to analytics format
     */
    private transformTradingViewData(tvData: TradingViewData): PriceDataPoint[] {
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
    }

    /**
     * Calculate analytics metrics from historical data
     */
    calculateAnalyticsMetrics(priceData: PriceDataPoint[]): AnalyticsMetrics {
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
            volatility,
            beta: 0.85, // Mock
            alpha: 3.2, // Mock
            marketCorrelation: 0.72, // Mock
        };
    }

    /**
     * Calculate sector performance (mock data for now)
     */
    calculateSectorPerformance(): SectorPerformance[] {
        return [
            { sector: 'DeFi', performance: 15.2, contribution: 35 },
            { sector: 'NFT', performance: -3.1, contribution: 15 },
            { sector: 'Gaming', performance: 8.7, contribution: 25 },
            { sector: 'Infrastructure', performance: 22.1, contribution: 25 },
        ];
    }

    /**
     * Load complete analytics data
     */
    async loadAnalyticsData(
        symbol: string,
        timeWindow: AnalyticsTimeWindow,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<AnalyticsData> {
        // Load data in chunks
        const priceData = await this.loadDataInChunks(symbol, timeWindow.days, onProgress, signal);

        // Calculate metrics
        const metrics = this.calculateAnalyticsMetrics(priceData);
        const sectorPerformance = this.calculateSectorPerformance();

        return {
            metrics,
            sectorPerformance,
            priceData,
            volumeData: priceData.map(d => ({ timestamp: d.timestamp, volume: d.volume })),
        };
    }

    /**
     * Load analytics data with user-level limits and custom chunk size
     */
    async loadAnalyticsDataWithLimits(
        symbol: string,
        timeWindow: AnalyticsTimeWindow,
        userLevel: UserLevel,
        chunkSize: number,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<AnalyticsData> {
        // Load data in chunks with user-level limits
        const priceData = await this.loadDataInChunksWithLimits(
            symbol,
            timeWindow.days,
            userLevel,
            chunkSize,
            onProgress,
            signal
        );

        // Calculate metrics
        const metrics = this.calculateAnalyticsMetrics(priceData);
        const sectorPerformance = this.calculateSectorPerformance();

        return {
            metrics,
            sectorPerformance,
            priceData,
            volumeData: priceData.map(d => ({ timestamp: d.timestamp, volume: d.volume })),
        };
    }

    /**
     * Load data in chunks with user-level limits and custom chunk size
     */
    private async loadDataInChunksWithLimits(
        symbol: string,
        totalDays: number,
        userLevel: UserLevel,
        chunkSize: number,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<PriceDataPoint[]> {
        const chunks: PriceDataPoint[] = [];

        // Apply user level limits
        const userLimits = this.getUserLevelLimits(userLevel);
        const effectiveTotalDays = Math.min(totalDays, userLimits.maxDays);

        // Implement progressive loading: load recent data first, then older data
        const recentDays = Math.min(90, effectiveTotalDays); // Load last 90 days first
        const remainingDays = effectiveTotalDays - recentDays;

        // Load recent data first (higher priority)
        if (recentDays > 0) {
            const recentStart = new Date();
            recentStart.setDate(recentStart.getDate() - recentDays);
            const recentEnd = new Date();

            try {
                const recentData = await this.loadHistoricalChunk(
                    symbol,
                    recentStart,
                    recentEnd
                );
                chunks.push(...recentData);
                onProgress?.(0.5); // 50% progress after recent data
            } catch (error) {
                if (!signal?.aborted) {
                    throw error;
                }
            }
        }

        // Load older historical data in background if needed
        if (remainingDays > 0 && !signal?.aborted) {
            for (let i = 0; i < remainingDays; i += chunkSize) {
                if (signal?.aborted) break;

                const chunkDays = Math.min(chunkSize, remainingDays - i);
                const chunkStart = new Date();
                chunkStart.setDate(chunkStart.getDate() - (remainingDays - i + recentDays));
                const chunkEnd = new Date();
                chunkEnd.setDate(chunkEnd.getDate() - (remainingDays - i - chunkDays + recentDays));

                try {
                    const chunkData = await this.loadHistoricalChunk(
                        symbol,
                        chunkStart,
                        chunkEnd
                    );
                    chunks.push(...chunkData);

                    // Update progress incrementally
                    const historicalProgress = (i + chunkDays) / remainingDays;
                    onProgress?.(0.5 + (historicalProgress * 0.4)); // 50-90% for historical data

                } catch (error) {
                    if (!signal?.aborted) {
                        // Log error but continue with other chunks
                        console.warn('Failed to load historical chunk:', error);
                    }
                }
            }
        }

        onProgress?.(0.9); // 90% complete
        return chunks;
    }

    /**
     * Get user level limits for analytics
     */
    private getUserLevelLimits(userLevel: UserLevel) {
        switch (userLevel) {
            case UserLevel.BASIC:
                return { maxDays: 90, chunkSize: 30 };
            case UserLevel.REGISTERED:
                return { maxDays: 180, chunkSize: 60 };
            case UserLevel.VERIFIED:
                return { maxDays: 365, chunkSize: 90 };
            default:
                return { maxDays: 90, chunkSize: 30 }; // Default to basic limits
        }
    }
}

export const analyticsService = AnalyticsService.getInstance();
