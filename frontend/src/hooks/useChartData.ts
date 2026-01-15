/** @format */

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CandleData } from '../components/CandlestickChart';

interface UseChartDataOptions {
  symbol: string;
  interval: string;
  limit?: number;
}

// Transform TradingView separated arrays to candle objects
const transformTradingViewData = (tvData: any): CandleData[] => {
  if (!tvData || typeof tvData !== 'object') {
    return [];
  }

  const { t: timestamps, o: opens, h: highs, l: lows, c: closes, v: volumes } = tvData;

  // Validate required arrays exist and are not empty
  if (!timestamps || !opens || !highs || !lows || !closes ||
      !Array.isArray(timestamps) || timestamps.length === 0) {
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
    if (typeof time !== 'number' || typeof open !== 'number' ||
        typeof high !== 'number' || typeof low !== 'number' ||
        typeof close !== 'number') {
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

export const useChartData = ({
  symbol,
  interval,
  limit = 300, // Default to 300 candles (kept for API compatibility)
}: UseChartDataOptions) => {
  const [data, setData] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 10;
  const retryInterval = 2000; // 2 seconds
  const [historicalLoaded, setHistoricalLoaded] = useState(false);

  // ✅ Fetch historical data first, then merge with realtime WebSocket data
  const fetchHistoricalData = async () => {
    try {
      console.log(`📊 Fetching historical data for ${symbol} ${interval}`);

      // Fetch last 24 hours of historical data (same as Dashboard)
      const fromTimestamp = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // 24 hours ago
      const toTimestamp = Math.floor(Date.now() / 1000);

      // Map interval to TradingView resolution format
      const getResolution = (interval: string): string => {
        switch (interval) {
          case '1m': return '1';
          case '5m': return '5';
          case '15m': return '15';
          case '30m': return '30';
          case '1h': return '60'; // 60 minutes = 1 hour
          case '4h': return '240'; // 240 minutes = 4 hours
          case '12h': return '720'; // 720 minutes = 12 hours
          case '1d': return '1D';
          case '1w': return '1W';
          case '1M': return '1M';
          default: return '60'; // Default to 1h
        }
      };

      const response = await api.getTvHistory({
        symbol: symbol,
        resolution: getResolution(interval),
        from: fromTimestamp,
        to: toTimestamp,
      });

      if (response.success && response.data) {
        const historicalCandles = transformTradingViewData(response.data);

        if (historicalCandles.length > 0) {
          console.log(`📊 Loaded ${historicalCandles.length} historical candles for ${symbol}`);
          setData(historicalCandles);
          setHistoricalLoaded(true);
          setRetryCount(0); // Reset on success
          return historicalCandles;
        }
      }

      console.warn(`📊 No historical data available for ${symbol}`);
      return [];
    } catch (err: any) {
      console.error(`⚠️ Failed to fetch historical data:`, err.message);
      return [];
    }
  };

  // ✅ Fetch realtime data from WebSocket cache and merge with historical
  const fetchRealtimeData = async (existingData: CandleData[] = []) => {
    try {
      const response = await api.getKlines({
        symbol: symbol,
        interval: interval,
        limit: 10, // Only need recent candles for merging
      });

      if (response.success && response.data && response.data.length > 0) {
        // Transform websocket data
        const realtimeCandles: CandleData[] = response.data.map(
          (kline: any) => ({
            time: kline.time,
            open: parseFloat(kline.open),
            high: parseFloat(kline.high),
            low: parseFloat(kline.low),
            close: parseFloat(kline.close),
            volume: parseFloat(kline.volume || 0),
          })
        );

        // Merge historical + realtime data
        const mergedData = mergeCandleData(existingData, realtimeCandles);

        if (mergedData.length !== existingData.length) {
          console.log(`📊 Merged data: ${existingData.length} historical + realtime = ${mergedData.length} total`);
          setData(mergedData);
        }

        return mergedData;
      }

      return existingData;
    } catch (err: any) {
      console.error(`⚠️ Failed to fetch realtime data:`, err.message);
      return existingData;
    }
  };

  // ✅ Merge historical and realtime candle data, avoiding duplicates
  const mergeCandleData = (historical: CandleData[], realtime: CandleData[]): CandleData[] => {
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

  // ✅ Main fetch function
  const fetchChartData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Step 1: Fetch historical data (if not already loaded)
      let currentData = data;
      if (!historicalLoaded) {
        currentData = await fetchHistoricalData();
      }

      // Step 2: Fetch and merge realtime data
      currentData = await fetchRealtimeData(currentData);

      // Step 3: Set final data
      setData(currentData);

      if (currentData.length === 0) {
        if (retryCount < maxRetries) {
          console.log(`📊 No data available (attempt ${retryCount + 1}/${maxRetries}), will retry in 2s`);
          setRetryCount(retryCount + 1);
        } else {
          setError('Unable to load chart data. Please check your connection.');
        }
      }

    } catch (err: any) {
      setData([]);
      setError(null);

      if (retryCount < maxRetries) {
        console.log(`⚠️ Chart data API error, will retry: ${err.message}`);
        setRetryCount(retryCount + 1);
      } else {
        console.warn(`⚠️ Failed to fetch chart data after ${maxRetries} attempts:`, err.message);
        setError('Unable to reach API. Check connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ✅ Initial data fetch
  useEffect(() => {
    if (symbol && interval) {
      // Reset state when symbol/interval changes
      setHistoricalLoaded(false);
      setData([]);
      setError(null);
      setRetryCount(0);
      fetchChartData();
    }
  }, [symbol, interval]); // Removed limit from deps

  // ✅ Periodic realtime updates (every 30 seconds after historical data is loaded)
  useEffect(() => {
    if (!historicalLoaded || !symbol || !interval) {
      return;
    }

    const updateInterval = setInterval(async () => {
      await fetchRealtimeData(data);
    }, 30000); // Update every 30 seconds

    return () => clearInterval(updateInterval);
  }, [historicalLoaded, symbol, interval, data]);

  // ✅ Retry polling when retry count changes
  useEffect(() => {
    if (retryCount === 0 || retryCount >= maxRetries || data.length > 0) {
      return; // Don't retry if not needed
    }

    const timer = setTimeout(() => {
      console.log(`📊 Retrying kline fetch (${retryCount}/${maxRetries})...`);
      fetchChartData();
    }, retryInterval);

    return () => clearTimeout(timer);
  }, [retryCount, data.length, symbol, interval]);

  return {
    data,
    loading,
    error,
    refetch: fetchChartData,
  };
};

export default useChartData;
