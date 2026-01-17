/** @format */

import { useState, useEffect } from "react";
import { api } from "../lib/api";

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
}

// Hook for getting real-time price data (futures + mark price)
export const usePrice = (symbol: string) => {
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchPrice = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get futures data (static, more detailed)
        const futuresResponse = await api.getFuturesPrice(symbol);

        // Get mark price (real-time via WebSocket)
        const markPriceResponse = await api.getMarkPrice(symbol);

        if (mounted) {
          // Use mark price if available (more current), otherwise use futures price
          const priceData =
            markPriceResponse.success && markPriceResponse.data
              ? markPriceResponse.data
              : futuresResponse.success && futuresResponse.data
                ? {
                    symbol,
                    price: futuresResponse.data.price,
                    timestamp: futuresResponse.timestamp,
                  }
                : null;

          setPrice(priceData);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to fetch price data");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    if (symbol) {
      fetchPrice();
    }

    return () => {
      mounted = false;
    };
  }, [symbol]);

  const refetch = async () => {
    try {
      setLoading(true);
      setError(null);

      const futuresResponse = await api.getFuturesPrice(symbol);
      const markPriceResponse = await api.getMarkPrice(symbol);

      const priceData =
        markPriceResponse.success && markPriceResponse.data
          ? markPriceResponse.data
          : futuresResponse.success && futuresResponse.data
            ? {
                symbol,
                price: futuresResponse.data.price,
                timestamp: futuresResponse.timestamp,
              }
            : null;

      setPrice(priceData);
    } catch (err: any) {
      setError(err.message || "Failed to fetch price data");
    } finally {
      setLoading(false);
    }
  };

  return { price, loading, error, refetch };
};

export default usePrice;
