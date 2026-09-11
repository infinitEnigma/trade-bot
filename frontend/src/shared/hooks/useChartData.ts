/** @format */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketApi } from "../../infrastructure/api";
import { CandleData } from "../components/charts/CandlestickChart";
import { useAuth } from "../../features/auth";
import React from "react";
import { websocketClient } from "../../infrastructure/websocket/client";
import type { TickData as WsTickData, MarkPriceData as WsMarkPriceData, KlineData as WsKlineData } from "@trade-bot/shared";

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
 * TradingView data format - separated arrays for each candle property
 */
interface TradingViewData {
  t: number[]; // timestamps
  o: number[]; // opens
  h: number[]; // highs
  l: number[]; // lows
  c: number[]; // closes
  v?: number[]; // volumes (optional)
}

/**
 * Kline data format from API responses
 */
interface KlineData {
  time: number;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume?: string | number;
}

/**
 * Enhanced response with freshness metadata
 */
interface FreshnessAwareResponse<T = unknown> {
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

/**
 * Ticker data structure
 */
interface TickerData {
  price: string;
  change24h?: string;
  volume24h?: string;
}

/**
 * Mark price data structure
 */
interface MarkPriceData {
  price: string;
}

interface UseChartDataOptions {
  symbol: string;
  interval: string;
  limit?: number;
}

// Transform TradingView separated arrays to candle objects
const transformTradingViewData = (tvData: TradingViewData): CandleData[] => {
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

      // Map interval to TradingView resolution format.
      // Accepts both human-readable labels ("1m", "4h", "1d") AND native TradingView
      // resolution strings ("1", "5", "60", "240", "D") so callers don't need to
      // pre-convert before passing the value.
      const getResolution = (interval: string): string => {
        switch (interval) {
          // Human-readable labels
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
          // Native TradingView resolution strings — pass through as-is
          case "1":
          case "3":
          case "5":
          case "15":
          case "30":
          case "60":
          case "120":
          case "240":
          case "360":
          case "720":
          case "D":
          case "W":
          case "M":
            return interval;
          default:
            return "60";
        }
      };

      const response: FreshnessAwareResponse<TradingViewData> = await marketApi.getTvHistory({
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
          (kline: KlineData) => ({
            time: kline.time,
            open: parseFloat(String(kline.open)),
            high: parseFloat(String(kline.high)),
            low: parseFloat(String(kline.low)),
            close: parseFloat(String(kline.close)),
            volume: parseFloat(String(kline.volume || 0)),
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
  const { user } = useAuth();
  // Get actual user level from auth, default to BASIC if not authenticated
  const userLevel = user?.userLevel || 'BASIC'; // 'BASIC' | 'REGISTERED' | 'VERIFIED'

  return useQuery({
    queryKey: ["current-price", symbol, userLevel],
    queryFn: async () => {
      console.log(`💰 Fetching current price for ${symbol} (user level: ${userLevel})`);

      try {
        // For BASIC users: Use public ticker (may be unavailable)
        if (userLevel === 'BASIC') {
          const response: FreshnessAwareResponse<TickerData> = await marketApi.getTicker(symbol);

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
        const response: FreshnessAwareResponse<MarkPriceData> = await marketApi.getMarkPrice(symbol);

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
          const publicResponse: FreshnessAwareResponse<TickerData> = await marketApi.getTicker(symbol);

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
    staleTime: userLevel === 'BASIC' ? 10000 : 1000, // Basic: 10 sec, Premium: 10 sec (match cache TTL)
    gcTime: 1 * 10 * 1000, // 10 seconds cache
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
        return 10000; // 10 seconds for basic users
      }

      // For premium users, check freshness metadata
      const data = query.state.data;
      if (data?.freshness?.recommendedPollInterval) {
        return Math.max(data.freshness.recommendedPollInterval, 2000); // Min 2 seconds to match cache TTL
      }

      return 3000; // Default 3 seconds for all users to avoid rate limiting
    },
    refetchIntervalInBackground: false,
  });
};

/**
 * Hook for WebSocket-based real-time price updates
 * Only connects and subscribes if user is VERIFIED
 */
export const useWebSocketPriceUpdates = ({
  symbol,
  interval,
}: UseChartDataOptions) => {
  const [tickData, setTickData] = useState<WsTickData | null>(null);
  const [klineData, setKlineData] = useState<WsKlineData | null>(null);
  const [markPriceData, setMarkPriceData] = useState<WsMarkPriceData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");
  const { user } = useAuth();
  const isAuthenticated = !!user; // Connect for any authenticated user (BASIC, REGISTERED, VERIFIED)

  useEffect(() => {
    // Only connect if user is authenticated
    if (!isAuthenticated) {
      console.log("📡 WebSocket: User not authenticated, skipping connection");
      setConnectionStatus("disconnected");
      return;
    }

    console.log("📡 WebSocket: Setting up listeners for authenticated user");

    // Define handlers in effect scope so both registration and cleanup can reference them
    const handleTick = (data: WsTickData) => {
      if (data.symbol === symbol) {
        setTickData(data);
        console.log(`💰 Tick update for ${symbol}: $${data.price}`);
      }
    };

    const handleKline = (data: WsKlineData) => {
      if (data.symbol === symbol && data.interval === interval) {
        setKlineData(data);
        console.log(`📊 Kline update for ${symbol} ${interval}`);
      }
    };

    const handleMarkPrice = (data: WsMarkPriceData) => {
      if (data.symbol === symbol) {
        setMarkPriceData(data);
        console.log(`🏷️ Mark price update for ${symbol}: $${data.price}`);
      }
    };

    const handleStatusChange = (status: string) => {
      setConnectionStatus(status);
      console.log(`📡 WebSocket status: ${status}`);
    };

    // Register listeners synchronously before connecting — ensures no events are missed
    websocketClient.onTick(handleTick);
    websocketClient.onKline(handleKline);
    websocketClient.onMarkPrice(handleMarkPrice);
    websocketClient.onStatusChange(handleStatusChange);

    // Connect and subscribe (fire-and-forget — cleanup handles teardown regardless of outcome)
    websocketClient.connect()
      .then(() => {
        console.log("📡 WebSocket: Connected for VERIFIED user");
        setConnectionStatus(websocketClient.getStatus());
        return websocketClient.subscribeToSymbol(symbol);
      })
      .catch(error => {
        console.error("📡 WebSocket: Failed to connect:", error);
        setConnectionStatus("error");
      });

    // Cleanup: remove listeners and unsubscribe from the symbol.
    // DO NOT call disconnect() here — it would tear down the shared socket for all consumers.
    return () => {
      console.log("📡 WebSocket: Cleaning up listeners for", symbol);
      websocketClient.offTick(handleTick);
      websocketClient.offKline(handleKline);
      websocketClient.offMarkPrice(handleMarkPrice);
      websocketClient.offStatusChange(handleStatusChange);
      websocketClient.unsubscribeFromSymbol(symbol);
    };
  }, [symbol, interval, isAuthenticated]);

  return {
    tickData,
    klineData,
    markPriceData,
    connectionStatus,
  };
};

/**
 * Combined hook that merges historical and WebSocket real-time data
 * Maintains backward compatibility with existing CandlestickChart
 */
export const useChartData = ({
  symbol,
  interval,
}: UseChartDataOptions) => {
  // Get historical data (1x/minute)
  const historicalQuery = useChartHistorical({ symbol, interval });

  // Get WebSocket real-time updates
  const { tickData, klineData, markPriceData, connectionStatus } = useWebSocketPriceUpdates({ symbol, interval });

  // Extract data from queries with useMemo
  const historicalData = React.useMemo(() => {
    return historicalQuery.data?.candles || [];
  }, [historicalQuery.data]);

  // Merge historical data with WebSocket updates
  const mergedData = React.useMemo(() => {
    let data = [...historicalData];

    if (klineData) {
      // Convert kline data to candle format.
      // klineData.startTime is in milliseconds (from Orderly Network WebSocket),
      // but historical candles use seconds — divide by 1000 to align them.
      const startTimeSec = klineData.startTime > 1e12
        ? Math.floor(klineData.startTime / 1000)
        : klineData.startTime;

      const candle: CandleData = {
        time: startTimeSec,
        open: klineData.open,
        high: klineData.high,
        low: klineData.low,
        close: klineData.close,
        volume: klineData.volume,
      };

      // Merge or replace the latest candle
      data = mergeCandleData(data, [candle]);
    }

    return data;
  }, [historicalData, klineData]);
  // Note: markPriceData is intentionally NOT included in mergedData here.
  // CandlestickChart consumes markPriceData separately via series.update() to avoid
  // triggering a full setData() redraw on every ~1 second price tick.

  // Determine error state (prioritize historical data errors)
  const error = React.useMemo(() => {
    if (historicalQuery.error) {
      return historicalQuery.error?.message || "Failed to load historical data";
    }
    return null;
  }, [historicalQuery.error]);

  return {
    data: mergedData,
    loading: historicalQuery.isLoading,
    error,
    refetch: () => historicalQuery.refetch(),
    tickData,
    markPriceData,
    connectionStatus,
  };
};
