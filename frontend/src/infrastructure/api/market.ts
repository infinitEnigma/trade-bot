/** @format */

import { httpClient } from "./client";
import { globalRequestManager } from "../request-manager";
import type { AccountExchange, AccountEnvironment } from "./accounts";

/**
 * Market data API endpoints
 * Handles market prices, trading data, and TradingView integration with global deduplication
 */
export const marketApi = {
  // Market data endpoints
  async getTicker(symbol?: string) {
    const key = symbol ? `market:ticker:${symbol}` : "market:tickers:all";
    return globalRequestManager.deduplicateRequest(
      key,
      () => {
        const params = symbol ? { symbol } : {};
        return httpClient
          .getClient()
          .get("/api/market/ticker", { params })
          .then(r => r.data);
      },
      "marketApi"
    );
  },

  async getFuturesPrice(symbol: string) {
    return globalRequestManager.deduplicateRequest(
      `market:futures:${symbol}`,
      () =>
        httpClient
          .getClient()
          .get(`/api/market/futures/${symbol}`)
          .then(r => r.data),
      "marketApi"
    );
  },

  async getMarkPrice(symbol: string) {
    return globalRequestManager.deduplicateRequest(
      `market:markprice:${symbol}`,
      () =>
        httpClient
          .getClient()
          .get(`/api/market/markprice/${symbol}`)
          .then(r => r.data),
      "marketApi"
    );
  },

  async getKlines(params: {
    symbol?: string;
    interval?: string;
    limit?: number;
  }) {
    const key = `market:klines:${params.symbol || "all"}:${params.interval || "1m"}:${params.limit || 100}`;
    return globalRequestManager.deduplicateRequest(
      key,
      () =>
        httpClient
          .getClient()
          .get("/api/market/klines", { params })
          .then(r => r.data),
      "marketApi"
    );
  },

  async getKlineHistory(params: {
    symbol?: string;
    resolution?: string;
    from?: number;
    to?: number;
    limit?: number;
  }) {
    const key = `market:kline-history:${params.symbol || "all"}:${params.resolution || "1D"}:${params.from || 0}:${params.to || Date.now()}:${params.limit || 100}`;
    return globalRequestManager.deduplicateRequest(
      key,
      () =>
        httpClient
          .getClient()
          .get("/api/market/kline-history", { params })
          .then(r => r.data),
      "marketApi"
    );
  },

  async getPositions() {
    return globalRequestManager.deduplicateRequest(
      "market:positions",
      () =>
        httpClient
          .getClient()
          .get("/api/market/positions")
          .then(r => r.data),
      "marketApi"
    );
  },

  // TradingView endpoints
  async getTvConfig() {
    return globalRequestManager.deduplicateRequest(
      "market:tv:config",
      () =>
        httpClient
          .getClient()
          .get("/api/market/tv/config")
          .then(r => r.data),
      "marketApi"
    );
  },

  async getTvSymbols(params: { symbol?: string }) {
    const key = params.symbol
      ? `market:tv:symbols:${params.symbol}`
      : "market:tv:symbols:all";
    return globalRequestManager.deduplicateRequest(
      key,
      () =>
        httpClient
          .getClient()
          .get("/api/market/tv/symbols", { params })
          .then(r => r.data),
      "marketApi"
    );
  },

  async getTvHistory(params: {
    symbol?: string;
    resolution?: string;
    from?: number;
    to?: number;
    /**
     * X3 venue dispatch: pass both to read candles from that venue (only
     * `lighter` differs server-side today; Kodiak is the default path). The
     * dedupe key includes them so two venues never share one in-flight entry.
     */
    exchange?: AccountExchange;
    environment?: AccountEnvironment;
  }) {
    const venue = params.exchange
      ? `${params.exchange}:${params.environment}`
      : "kodiak";
    const key = `market:tv:history:${venue}:${params.symbol || "all"}:${params.resolution || "1D"}:${params.from || 0}:${params.to || Date.now()}`;
    return globalRequestManager.deduplicateRequest(
      key,
      () =>
        httpClient
          .getClient()
          .get("/api/market/tv/history", { params })
          .then(r => r.data),
      "marketApi"
    );
  },

  /**
   * Venue symbol catalog (X2) — the symbols a given exchange/environment
   * lists. Powers the venue-aware start check: when a user picks an account,
   * the UI compares the strategy's symbol against this list and warns on a
   * mismatch before dispatching start. `available: false` (catalog unfetchable)
   * means "unknown" — the UI stays silent and the backend start gate decides.
   */
  async getVenueSymbols(params: {
    exchange: AccountExchange;
    environment: AccountEnvironment;
  }) {
    const key = `market:venue-symbols:${params.exchange}:${params.environment}`;
    return globalRequestManager.deduplicateRequest(
      key,
      () =>
        httpClient
          .getClient()
          .get("/api/market/venue-symbols", { params })
          .then(r => r.data),
      "marketApi"
    );
  },
};
