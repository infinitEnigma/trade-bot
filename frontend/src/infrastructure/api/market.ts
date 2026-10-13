/** @format */

import { httpClient } from "./client";
import { globalRequestManager } from "../request-manager";
import type { AccountExchange, AccountEnvironment } from "./accounts";

/**
 * One row of `GET /api/market/orders` — the strategy workspace's open-orders
 * table (Phase 3).
 *
 * Mirrors `OpenOrderRow` in `backend/src/infrastructure/external/
 * open-orders.ts` — the venue-neutral contract both Kodiak/Orderly and
 * Lighter readers map onto. Re-declared here because the frontend never
 * imports backend modules (same pattern as `LedgerTradeRow` in trading.ts).
 */
export interface OpenOrderRow {
  /** Venue order handle — Orderly `order_id`; Lighter client order index. */
  orderId: string;
  /** Human-readable client id when the venue echoes one (else `null`). */
  clientOrderId: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  /** Venue-native order type uppercased (`LIMIT`, `MARKET`); `""` if absent. */
  orderType: string;
  /** Limit price in human units; `null` when the row carries no fixed price. */
  price: number | null;
  /** Order size in base units; `null` when the row carries none. */
  quantity: number | null;
  /** Venue cumulative fill in base units — never conflated with `quantity`. */
  filledQuantity: number;
  /** Venue-native status uppercased (`NEW`, `OPEN`, `PARTIALLY_FILLED`…). */
  status: string;
  /** Created-at epoch milliseconds; `null` when the venue omits it. */
  createdAtMs: number | null;
  /** Which venue answered — lets the table badge rows without a second call. */
  exchange: "kodiak" | "lighter";
}

/**
 * One row of `GET /api/market/positions` — the workspace's positions view
 * (Phase 3.1, review P2-4). Venue truth for ONE account (C3b scoping);
 * positions are account × market, NOT strategy-attributed — consumers must
 * label that distinction. Field names are the venue-normalised snake_case
 * the position readers emit (same shape the Dashboard's Position type
 * consumes); numeric fields are strings on the wire.
 */
export interface AccountPositionRow {
  symbol: string;
  /** Signed base quantity. */
  position_qty: string;
  /** Venue-exact unrealized PnL (empty string when unknown). */
  unsettled_pnl: string;
  mark_price: string;
  average_open_price: string;
}

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

  /**
   * Phase 3.1 (review P2-4): C3b account scoping (`?exchangeAccountId=`) —
   * the workspace's positions view reads ONE account's book; absent the
   * param the backend answers the caller's whole (legacy Kodiak default)
   * scope, exactly as before C3b.
   */
  async getPositions(exchangeAccountId?: string) {
    return globalRequestManager.deduplicateRequest(
      `market:positions:${exchangeAccountId ?? "all"}`,
      () =>
        httpClient
          .getClient()
          .get("/api/market/positions", {
            params: exchangeAccountId ? { exchangeAccountId } : undefined,
          })
          .then(r => r.data),
      "marketApi"
    );
  },

  /**
   * Phase 3: the workspace's open-orders read — venue-direct rows for one
   * account, optionally narrowed to `symbol`. The backend scopes by
   * `exchangeAccountId` (legacy Kodiak account when omitted) and dispatches
   * to the right venue reader. Both params participate in the dedupe key so
   * two accounts (or two symbols) never share one in-flight entry.
   */
  async getOpenOrders(
    params: { exchangeAccountId?: string; symbol?: string } = {}
  ) {
    const key = `market:orders:${params.exchangeAccountId ?? "default"}:${params.symbol ?? "all"}`;
    // Only present keys go on the query string — the backend reads blank/
    // absent values as "whole book", never as an empty-string filter.
    const query: { exchangeAccountId?: string; symbol?: string } = {};
    if (params.exchangeAccountId)
      query.exchangeAccountId = params.exchangeAccountId;
    if (params.symbol) query.symbol = params.symbol;
    return globalRequestManager.deduplicateRequest(
      key,
      () =>
        httpClient
          .getClient()
          .get("/api/market/orders", { params: query })
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
