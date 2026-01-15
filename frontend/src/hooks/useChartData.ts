/** @format */

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CandleData } from '../components/CandlestickChart';

interface UseChartDataOptions {
  symbol: string;
  interval: string;
  limit?: number;
}

export const useChartData = ({
  symbol,
  interval,
  limit = 300, // Default to 300 candles
}: UseChartDataOptions) => {
  const [data, setData] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 10;
  const retryInterval = 2000; // 2 seconds

  // ✅ Fetch historical OHLC data using WebSocket cache (more reliable than TradingView)
  const fetchChartData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use WebSocket klines endpoint which has cached data from live trading
      const response = await api.getKlines({
        symbol: symbol,
        interval: interval,
        limit: 300, // Get up to 300 candles from WebSocket cache
      });

      if (response.success && response.data && response.data.length > 0) {
        // ✅ Transform kline response to chart format
        const chartData: CandleData[] = response.data.map(
          (kline: any) => ({
            time: kline.time, // Already in seconds
            open: parseFloat(kline.open),
            high: parseFloat(kline.high),
            low: parseFloat(kline.low),
            close: parseFloat(kline.close),
            volume: parseFloat(kline.volume),
          })
        );

        // Sort by time to ensure chronological order
        chartData.sort((a, b) => a.time - b.time);

        setData(chartData);
        setRetryCount(0); // Reset on success
        console.log(`📊 Loaded ${chartData.length} WebSocket klines for ${symbol}`);
      } else {
        // No cached WebSocket data yet - retry
        if (retryCount < maxRetries) {
          console.log(`📊 No WebSocket data yet (attempt ${retryCount + 1}/${maxRetries}), will retry in 2s`);
          setRetryCount(retryCount + 1);
        } else {
          console.warn(`📊 Failed to load klines after ${maxRetries} attempts`);
          setError('Unable to load chart data. WebSocket may still be connecting.');
        }
        setData([]);
      }

    } catch (err: any) {
      // API error - retry
      setData([]);
      setError(null);

      if (retryCount < maxRetries) {
        console.log(`⚠️ WebSocket API error, will retry: ${err.message}`);
        setRetryCount(retryCount + 1);
      } else {
        console.warn(`⚠️ Failed to fetch klines after ${maxRetries} attempts:`, err.message);
        setError('Unable to reach API. Check connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ✅ Initial data fetch
  useEffect(() => {
    if (symbol && interval) {
      fetchChartData();
    }
  }, [symbol, interval, limit]);

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
  }, [retryCount, data.length, symbol, interval, limit]);

  return {
    data,
    loading,
    error,
    refetch: fetchChartData,
  };
};

export default useChartData;
