/** @format */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketApi } from "../../infrastructure/api";
import { CandleData } from "../../components/CandlestickChart";

/**
 * Data freshness metadata from backend responses
 */
interface DataFreshnessMetadata {
  lastUpdated: number;
  updateFrequency: number;
  recommendedPollInterval: number;
  nextExpectedUpdate: number;
  isStale: boolean;
  stalenessThreshold: number;
  dataSource: 'websocket' | 'api' | 'cache' | 'static';
  cacheTTLRemaining?: number;
}

/**
 * Enhanced response with freshness metadata
 */
interface FreshnessAwareResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  freshness?: DataFreshnessMetadata;
  timestamp?: number;
  cached?: boolean;
  mock?: boolean;
  stale?: boolean;
  message?: string;
}

interface UseChartDataOptions {
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
 * Hook for historical chart data with smart polling based on data freshness
 * Adjusts polling interval based on backend's recommended intervals
 */
export const useChartHistorical = ({
  symbol,
  interval,
}: UseChartDataOptions) => {
  const [freshnessData, setFreshnessData] = useState<DataFreshnessMetadata | null>(null);
  const [smartInterval, setSmartInterval] = useState<number>(60000); // Start with 1 minute

  return useQuery({
    queryKey: ["chart-historical", symbol, interval],
    queryFn: async (): Promise<{ candles: CandleData[]; freshness?: DataFreshnessMetadata }> => {
      console.log(`📊 Fetching historical chart data: ${symbol} ${interval}`);

      // Fetch last 24 hours of historical data
      const fromTimestamp = Math.floor(Date.now() / 1000) - 24 * 60 * 60; // 24 hours ago
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

      const response: FreshnessAwareResponse = await marketApi.getTvHistory({
        symbol,
        resolution: getResolution(interval),
        from: fromTimestamp,
        to: toTimestamp,
      });

      // Extract freshness metadata from response
      if (response.freshness) {
        setFreshnessData(response.freshness);
        // Adjust polling interval based on backend recommendation
        const recommendedInterval = response.freshness.recommendedPollInterval;
        // Conservative intervals for rate limit compliance - 30 second minimum for real-time data
        const minInterval = response.freshness.dataSource === 'websocket' ? 30000 : 60000;
        setSmartInterval(Math.max(recommendedInterval, minInterval));
        console.log(`📊 Adjusted polling interval to ${recommendedInterval}ms (min: ${minInterval}ms) based on backend freshness data for ${response.freshness.dataSource} data`);
      }

      if (response.success && response.data) {
        const historicalCandles = transformTradingViewData(response.data);
        console.log(`📊 Loaded ${historicalCandles.length} historical candles for ${symbol}`);
        return { candles: historicalCandles, freshness: response.freshness };
      }

      console.warn(`📊 No historical data available for ${symbol}`);
      return { candles: [] };
    },
    staleTime: smartInterval, // Dynamic stale time based on backend recommendations
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false,
    retry: 2,
    // Use smart polling interval
    refetchInterval: () => {
      // If we have freshness data and data isn't stale, use recommended interval
      if (freshnessData && !freshnessData.isStale) {
        return freshnessData.recommendedPollInterval;
      }
      // Fallback to current smart interval
      return smartInterval;
    },
    refetchIntervalInBackground: false, // Don't poll when tab is not active
  });
};

/**
 * Hook for live price updates (more frequent than historical data)
 */
export const useLivePrices = ({
  symbol,
  interval,
}: UseChartDataOptions) => {
  const [isPageVisible, setIsPageVisible] = useState(true);

  // Track page visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return useQuery({
    queryKey: ["live-prices", symbol, interval],
    queryFn: async () => {
      console.log(`💰 Fetching live prices: ${symbol} ${interval}`);
      const response = await marketApi.getKlines({
        symbol,
        interval,
        limit: 10, // Only need recent candles for live updates
      });

      if (response.success && response.data && response.data.length > 0) {
        // Transform to candle format
        const liveCandles: CandleData[] = response.data.map(
          (kline: any) => ({
            time: kline.time,
            open: parseFloat(kline.open),
            high: parseFloat(kline.high),
            low: parseFloat(kline.low),
            close: parseFloat(kline.close),
            volume: parseFloat(kline.volume || 0),
          })
        );
        return liveCandles;
      }
      return [];
    },
    enabled: isPageVisible, // Only fetch when page is visible
    staleTime: 10000, // 10 seconds (more frequent than historical)
    gcTime: 60 * 1000, // 1 minute cache
    refetchOnWindowFocus: false,
    retry: 1,
  });
};

/**
 * Current price hook with user-level awareness
 * Uses appropriate data sources based on user subscription level
 */
export const useCurrentPrice = (symbol: string) => {
  // TODO: Implement user level detection
  // For now, assume basic user level - will be enhanced with auth integration
  const userLevel = 'BASIC'; // 'BASIC' | 'REGISTERED' | 'VERIFIED'

  return useQuery({
    queryKey: ["current-price", symbol, userLevel],
    queryFn: async () => {
      console.log(`💰 Fetching current price for ${symbol} (user level: ${userLevel})`);

      try {
        // For BASIC users: Use public ticker (may be unavailable)
        if (userLevel === 'BASIC') {
          const response: FreshnessAwareResponse = await marketApi.getTicker(symbol);

          if (response.success && response.data) {
            console.log(`💰 Got public ticker price: $${response.data.price}`);
            return {
              price: parseFloat(response.data.price),
              change24h: parseFloat(response.data.change24h || '0'),
              volume24h: parseFloat(response.data.volume24h || '0'),
              symbol,
              timestamp: Date.now(),
              source: 'public',
              freshness: response.freshness,
            };
          } else {
            // Public data unavailable
            console.warn(`💰 Public ticker unavailable for ${symbol}`);
            throw new Error(response.error || 'Market data temporarily unavailable');
          }
        }

        // For REGISTERED/VERIFIED users: Use authenticated mark price
        const response: FreshnessAwareResponse = await marketApi.getMarkPrice(symbol);

        if (response.success && response.data) {
          console.log(`💰 Got authenticated mark price: $${response.data.price}`);
          return {
            price: parseFloat(response.data.price),
            symbol,
            timestamp: Date.now(),
            source: 'authenticated',
            freshness: response.freshness,
          };
        } else {
          // Authenticated data unavailable - fallback to public if possible
          console.warn(`💰 Authenticated mark price unavailable for ${symbol}, trying public fallback`);
          const publicResponse: FreshnessAwareResponse = await marketApi.getTicker(symbol);

          if (publicResponse.success && publicResponse.data) {
            console.log(`💰 Fallback to public ticker: $${publicResponse.data.price}`);
            return {
              price: parseFloat(publicResponse.data.price),
              change24h: parseFloat(publicResponse.data.change24h || '0'),
              volume24h: parseFloat(publicResponse.data.volume24h || '0'),
              symbol,
              timestamp: Date.now(),
              source: 'public_fallback',
              freshness: publicResponse.freshness,
            };
          }

          throw new Error('Market data temporarily unavailable');
        }
      } catch (error) {
        console.error(`💰 Price fetch failed for ${symbol}:`, error);
        throw error;
      }
    },
    enabled: !!symbol,
    staleTime: userLevel === 'BASIC' ? 120000 : 60000, // Basic: 2min, Premium: 1min (was 15sec)
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    retry: (failureCount, error) => {
      // Don't retry on 403/503 (auth/data unavailable errors)
      if (error instanceof Error) {
        if (error.message.includes('403') || error.message.includes('503')) {
          return false;
        }
      }
      return failureCount < 2;
    },
    refetchInterval: (query) => {
      // Dynamic polling based on user level and data availability
      if (userLevel === 'BASIC') {
        return 60000; // 1 minute for basic users
      }

      // For premium users, check freshness metadata
      const data = query.state.data;
      if (data?.freshness?.recommendedPollInterval) {
        return Math.max(data.freshness.recommendedPollInterval, 30000); // Min 30 seconds
      }

      return 60000; // Default 60 seconds for premium users (was 10 seconds)
    },
    refetchIntervalInBackground: false,
  });
};

/**
 * Combined hook that merges historical and live data
 * Maintains backward compatibility with existing CandlestickChart
 */
export const useChartData = ({
  symbol,
  interval,
}: UseChartDataOptions) => {
  const [data, setData] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get historical data (1x/minute)
  const historicalQuery = useChartHistorical({ symbol, interval });

  // Get live price updates (more frequent)
  const liveQuery = useLivePrices({ symbol, interval });

  // Merge data when either query updates
  useEffect(() => {
    const historicalResult = historicalQuery.data;
    const historicalData = historicalResult?.candles || [];
    const liveData = liveQuery.data || [];

    if (historicalData.length > 0 || liveData.length > 0) {
      // Merge historical + live data, with live data taking precedence
      const mergedData = mergeCandleData(historicalData, liveData);
      setData(mergedData);
      setError(null);
    }
  }, [historicalQuery.data, liveQuery.data]);

  // Set loading state
  useEffect(() => {
    setLoading(historicalQuery.isLoading || liveQuery.isLoading);
  }, [historicalQuery.isLoading, liveQuery.isLoading]);

  // Set error state (prioritize historical data errors)
  useEffect(() => {
    if (historicalQuery.error) {
      setError(historicalQuery.error?.message || "Failed to load historical data");
    } else if (liveQuery.error) {
      setError(liveQuery.error?.message || "Failed to load live prices");
    } else {
      setError(null);
    }
  }, [historicalQuery.error, liveQuery.error]);

  return {
    data,
    loading,
    error,
    refetch: () => {
      historicalQuery.refetch();
      liveQuery.refetch();
    },
  };
};
