/** @format */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { CandleData } from "../../components/CandlestickChart";

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
 * Hook for historical chart data (fetched once per minute)
 * Separated from live price updates for better performance
 */
export const useChartHistorical = ({
  symbol,
  interval,
}: UseChartDataOptions) => {
  return useQuery({
    queryKey: ["chart-historical", symbol, interval],
    queryFn: async () => {
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

      const response = await api.getTvHistory({
        symbol,
        resolution: getResolution(interval),
        from: fromTimestamp,
        to: toTimestamp,
      });

      if (response.success && response.data) {
        const historicalCandles = transformTradingViewData(response.data);
        console.log(`📊 Loaded ${historicalCandles.length} historical candles for ${symbol}`);
        return historicalCandles;
      }

      console.warn(`📊 No historical data available for ${symbol}`);
      return [];
    },
    staleTime: 60000, // 1 minute (user's requirement)
    gcTime: 10 * 60 * 1000, // 10 minutes cache
    refetchOnWindowFocus: false,
    retry: 2,
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
      const response = await api.getKlines({
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
    const historicalData = historicalQuery.data || [];
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
