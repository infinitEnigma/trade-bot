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

  // ✅ Fetch historical OHLC data using kline WebSocket cache (Phase 4 requirement)
  const fetchChartData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use kline endpoint which serves WebSocket-cached data
      const response = await api.getKlines({
        symbol: symbol,
        interval,
        limit,
      });

      if (response.success && response.data && response.data.length > 0) {
        // ✅ Transform kline response to chart format
        const chartData: CandleData[] = response.data.map(
          (kline: any) => ({
            time: kline.time,
            open: kline.open,
            high: kline.high,
            low: kline.low,
            close: kline.close,
            volume: kline.volume,
          })
        );

        setData(chartData);
        setRetryCount(0); // Reset on success
        console.log(`📊 Loaded ${chartData.length} klines for ${symbol}`);
      } else {
        // No data available yet - retry if not at max attempts
        if (retryCount < maxRetries) {
          console.log(`📊 No kline data yet (attempt ${retryCount + 1}/${maxRetries}), will retry in 2s`);
          setRetryCount(retryCount + 1);
        } else {
          console.warn(`📊 Failed to load klines after ${maxRetries} attempts`);
          setError('Unable to load chart data. WebSocket may still be connecting.');
        }
        setData([]);
      }

    } catch (err: any) {
      // API error - fail silently and retry
      setData([]);
      setError(null);
      
      if (retryCount < maxRetries) {
        console.log(`⚠️ API error fetching klines, will retry: ${err.message}`);
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
