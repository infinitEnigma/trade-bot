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

  // ✅ Fetch historical OHLC data using kline WebSocket cache (Phase 4 requirement)
  const fetchChartData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use kline endpoint which serves WebSocket-cached data
      const response = await api.getKlines({
        symbol: `PERP_${symbol}`,
        interval,
        limit,
      });

      if (response.data.success && response.data.data && response.data.data.length > 0) {
        // ✅ Transform kline response to chart format
        const chartData: CandleData[] = response.data.data.map(
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
        console.log(`📊 Dashboard kline: Loaded ${chartData.length} data points for ${symbol}`);
      } else {
        // No data available yet - WebSocket might still be connecting
        setData([]);
        console.log(`📊 Dashboard kline: No data available yet for ${symbol} (WebSocket connecting)`);
      }

    } catch (err: any) {
      // API failed - show empty chart
      setError(null);
      setData([]);
      console.warn(`Dashboard kline data unavailable for ${symbol}:`, err.message);
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

  return {
    data,
    loading,
    error,
    refetch: fetchChartData,
  };
};

export default useChartData;
