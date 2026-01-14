/** @format */

import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries
} from 'lightweight-charts';

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CandlestickChartProps {
  symbol: string;
  interval: string;
  data: CandleData[];
  height?: number;
  loading?: boolean;
  error?: string | null;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  interval,
  data,
  height = 400,
  loading = false,
  error = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current || error) return;

    try {
      // Create chart instance
      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#ffffff' },
          textColor: '#1f2937',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        width: containerRef.current.clientWidth,
        height: height,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          borderColor: '#d1d5db',
          fixLeftEdge: false,
          fixRightEdge: false,
        },
        rightPriceScale: {
          borderColor: '#d1d5db',
          scaleMargins: {
            top: 0.1,
            bottom: 0.25, // Leave space for volume
          },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        grid: {
          vertLines: {
            color: '#f3f4f6',
            style: 1,
          },
          horzLines: {
            color: '#f3f4f6',
            style: 1,
          },
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });

      // Create candlestick series
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',      // Green for bullish
        downColor: '#ef4444',    // Red for bearish
        borderUpColor: '#10b981',
        borderDownColor: '#ef4444',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      });

      // Create volume series
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#6b7280',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });

      // Set volume series options
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
      volumeSeriesRef.current = volumeSeries;
      setIsChartReady(true);

      // Handle window resize
      const handleResize = () => {
        if (containerRef.current && chart) {
          chart.applyOptions({
            width: containerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (chart) {
          chart.remove();
        }
        setIsChartReady(false);
      };
    } catch (chartError) {
      console.error('Failed to create chart:', chartError);
    }
  }, [height, error]);

  // Update data when it changes
  useEffect(() => {
    if (!isChartReady || !candlestickSeriesRef.current || !volumeSeriesRef.current || data.length === 0) {
      return;
    }

    try {
      // Transform data for the chart
      const chartData = data.map((item) => ({
        time: item.time as any, // Lightweight-charts expects number | string
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      }));

      // Set candlestick data
      candlestickSeriesRef.current.setData(chartData);

      // Set volume data if available
      const volumeData = data
        .filter((item) => item.volume !== undefined)
        .map((item) => ({
          time: item.time as any,
          value: item.volume || 0,
          color: item.close >= item.open ? '#10b981' : '#ef4444', // Green for up, red for down
        }));

      if (volumeData.length > 0) {
        volumeSeriesRef.current.setData(volumeData);
      }

      // Auto-fit the chart to show all data
      if (chartRef.current && chartData.length > 0) {
        chartRef.current.timeScale().fitContent();
      }
    } catch (dataError) {
      console.error('Failed to update chart data:', dataError);
    }
  }, [data, isChartReady]);

  return (
    <div className="w-full bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900">
            {symbol.replace('PERP_', '').replace('_USDC', '')}
          </h3>
          <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
            {interval}
          </span>
        </div>
        {error && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span className="text-sm text-red-600">{error}</span>
          </div>
        )}
        {loading && !error && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-gray-600">Loading...</span>
          </div>
        )}
        {!loading && !error && data.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm text-green-600">
              {data.length} candles
            </span>
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        className="w-full relative"
        style={{ height: `${height}px` }}
      >
        {!loading && !error && data.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-2 opacity-50">
                📊
              </div>
              <p>No chart data available</p>
              <p className="text-xs text-gray-400 mt-1">
                WebSocket connection may still be initializing
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CandlestickChart;
