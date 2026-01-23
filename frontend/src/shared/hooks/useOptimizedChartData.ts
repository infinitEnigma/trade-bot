/** @format */

/**
 * OPTIMIZED CHART DATA HOOK
 *
 * Single coordinated hook to prevent chart API call flood.
 * Combines historical and live data into one managed query with smart polling.
 * Dramatically reduces API calls while maintaining real-time updates.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketApi } from "../../infrastructure/api";
import { CandleData } from "../../components/CandlestickChart";

interface UseOptimizedChartDataOptions {
    symbol: string;
    interval: string;
    limit?: number;
}

// Transform TradingView separated arrays to candle objects
const transformTradingViewData = (tvData: any): CandleData[] => {
    if (!tvData || typeof tvData !== "object") {
        return [];
    }

    const {
        t: timestamps,
        o: opens,
        h: highs,
        l: lows,
        c: closes,
        v: volumes,
    } = tvData;

    // Validate required arrays exist and are not empty
    if (
        !timestamps ||
        !opens ||
        !highs ||
        !lows ||
        !closes ||
        !Array.isArray(timestamps) ||
        timestamps.length === 0
    ) {
        return [];
    }

    const candles: CandleData[] = [];

    // Process data points
    for (let i = 0; i < timestamps.length; i++) {
        const time = timestamps[i];
        const open = opens[i];
        const high = highs[i];
        const low = lows[i];
        const close = closes[i];
        const volume = volumes?.[i] || 0;

        // Validate data types
        if (
            typeof time !== "number" ||
            typeof open !== "number" ||
            typeof high !== "number" ||
            typeof low !== "number" ||
            typeof close !== "number"
        ) {
            continue;
        }

        candles.push({
            time, // Already in seconds (Unix timestamp)
            open,
            high,
            low,
            close,
            volume,
        });
    }

    // Sort by time to ensure chronological order
    candles.sort((a, b) => a.time - b.time);

    return candles;
};

// ✅ Merge historical and realtime candle data, avoiding duplicates
const mergeCandleData = (
    historical: CandleData[],
    realtime: CandleData[]
): CandleData[] => {
    const timeMap = new Map<number, CandleData>();

    // Add historical data first
    historical.forEach(candle => timeMap.set(candle.time, candle));

    // Add/overwrite with realtime data (more current)
    realtime.forEach(candle => timeMap.set(candle.time, candle));

    // Convert back to array and sort chronologically
    const merged = Array.from(timeMap.values());
    merged.sort((a, b) => a.time - b.time);

    return merged;
};

/**
 * OPTIMIZED: Single coordinated chart data hook
 * Prevents API call flood by using one query with smart polling
 */
export const useOptimizedChartData = ({
    symbol,
    interval,
}: UseOptimizedChartDataOptions) => {
    // Track page visibility for smart polling
    const [isPageVisible, setIsPageVisible] = useState(true);

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsPageVisible(!document.hidden);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    // Single optimized query that handles both historical and live data
    const query = useQuery({
        queryKey: ["optimized-chart-data", symbol, interval],
        queryFn: async () => {
            console.log(`📊 OPTIMIZED: Fetching chart data: ${symbol} ${interval}`);

            try {
                // Fetch historical data (last 24 hours)
                const fromTimestamp = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
                const toTimestamp = Math.floor(Date.now() / 1000);

                // Map interval to TradingView resolution format
                const getResolution = (interval: string): string => {
                    switch (interval) {
                        case "1m": return "1";
                        case "5m": return "5";
                        case "15m": return "15";
                        case "30m": return "30";
                        case "1h": return "60";
                        case "4h": return "240";
                        case "12h": return "720";
                        case "1d": return "1D";
                        case "1w": return "1W";
                        case "1M": return "1M";
                        default: return "60";
                    }
                };

                // Get historical data
                const historicalResponse = await marketApi.getTvHistory({
                    symbol,
                    resolution: getResolution(interval),
                    from: fromTimestamp,
                    to: toTimestamp,
                });

                // Get recent live data (last 10 candles)
                const liveResponse = await marketApi.getKlines({
                    symbol,
                    interval,
                    limit: 10,
                });

                // Process historical data
                const historicalCandles = historicalResponse.success && historicalResponse.data
                    ? transformTradingViewData(historicalResponse.data)
                    : [];

                // Process live data
                const liveCandles = liveResponse.success && liveResponse.data
                    ? liveResponse.data.map((kline: any) => ({
                        time: kline.time,
                        open: parseFloat(kline.open),
                        high: parseFloat(kline.high),
                        low: parseFloat(kline.low),
                        close: parseFloat(kline.close),
                        volume: parseFloat(kline.volume || 0),
                    }))
                    : [];

                // Merge data (live takes precedence)
                const mergedData = mergeCandleData(historicalCandles, liveCandles);

                console.log(`📊 OPTIMIZED: Loaded ${mergedData.length} candles (${historicalCandles.length} historical + ${liveCandles.length} live)`);

                return mergedData;

            } catch (error) {
                console.error(`📊 OPTIMIZED: Chart data fetch failed for ${symbol}:`, error);
                throw error;
            }
        },
        enabled: isPageVisible && !!symbol, // Only fetch when page is visible
        staleTime: 300000, // ⬆️ 5 minutes (was 1 minute)
        gcTime: 10 * 60 * 1000, // 10 minutes cache
        refetchOnWindowFocus: false, // 🚫 Don't refetch on focus
        refetchInterval: 300000, // 🔄 Poll every 5 minutes (was constant)
        refetchIntervalInBackground: false, // 🚫 Don't poll in background
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 429) return false; // Don't retry rate limits
            if (error?.response?.status === 403) return false; // Don't retry auth errors
            return failureCount < 2;
        },
    });

    return {
        data: query.data || [],
        loading: query.isLoading,
        error: query.error?.message || null,
        refetch: query.refetch,
    };
};