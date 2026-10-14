/** @format */

/**
 * Kodiak/Orderly API Client for Engine
 *
 * NOTE: This client makes direct calls to Kodiak API. For full system centralization,
 * this engine should eventually call the backend's centralized Kodiak service instead:
 * - Backend service: backend/src/infrastructure/external/kodiak-integration.service.ts
 * - This would require the engine to make HTTP calls to backend API endpoints
 *
 * CURRENT ARCHITECTURE:
 * Engine (OrderlyClient) → Direct Kodiak API
 *
 * PLANNED ARCHITECTURE:
 * Engine (OrderlyClient) → Backend API Endpoints → Centralized Kodiak Service
 *
 * Benefits of planned approach:
 * - Single source of truth for all Kodiak API access
 * - Unified caching, rate limiting, and error handling
 * - Consistent authentication and signature generation
 * - Easier to audit and maintain API integration
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import { createHash } from "crypto";
import { signAsync } from "@noble/ed25519";
import { logger } from "../../utils/logger";
import { OrderRequest, OrderResponse } from "../../types/strategy";
import {
  DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS,
  ExchangeDepthLevel,
  ExchangeMarketDepth,
  ExchangeOpenOrder,
  MarketRules,
  OrderLookup,
} from "../../domain/exchange";
import {
  validateMarketRules,
  isValidTickSizeString,
} from "../../domain/market-rules";
import { numberToDecimalString } from "../../utils/price-quantization";
import { CommandError } from "../../application/command-error";
import { toOrderlyOrderPayload } from "./payload";

interface OrderlyPosition {
  symbol: string;
  position_qty: number;
  mark_price: number;
  [key: string]: unknown;
}

interface OrderlyAccountInfo {
  total_value: number;
  max_leverage: number;
  max_notional?: Record<string, number>;
  [key: string]: unknown;
}

interface OrderlyTicker {
  price: number;
  symbol: string;
  [key: string]: unknown;
}

interface OrderlyKline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [key: string]: unknown;
}

interface OrderlyConfig {
  accountId: string;
  orderlyKey: string;
  orderlySecret: string;
  baseUrl: string;
  /** Per-request HTTP timeout (ms). Defaults to the shared exchange bound. */
  timeoutMs?: number;
}

/** Cancel is eventually consistent: poll until the exchange confirms. */
const CANCEL_CONFIRM_ATTEMPTS = 6;
const CANCEL_CONFIRM_DELAY_MS = 500;

/** Depth snapshot discipline (P0.1): levels per side + accepted `limit`. */
const DEFAULT_DEPTH_LEVELS = 50;
const MAX_DEPTH_LEVELS = 100;

/** Map an Orderly `GET /v1/orders` row onto the shared open-order shape. */
function toExchangeOpenOrder(
  row: Record<string, unknown>,
  fallbackSymbol: string
): ExchangeOpenOrder {
  const side = String(row.side ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  return {
    orderId: String(row.order_id),
    clientOrderId:
      row.client_order_id != null ? String(row.client_order_id) : undefined,
    symbol: String(row.symbol ?? fallbackSymbol),
    status: String(row.status ?? "OPEN"),
    side: side as "BUY" | "SELL",
    price: row.order_price != null ? Number(row.order_price) : undefined,
    quantity:
      row.order_quantity != null ? Number(row.order_quantity) : undefined,
    /**
     * Phase 4: the venue's cumulative for the order, the field the
     * reconciliation service books segments from. `order_quantity` is the
     * order's *size* — on a partly executed order the two differ, and on a
     * terminal cancel the size is exactly the wrong number to book.
     */
    executedQuantity:
      row.executed_quantity != null ? Number(row.executed_quantity) : undefined,
  };
}

/** Classify an axios/transport failure for the UNREACHABLE arm. */
function toUnreachableReason(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError;
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      return `orderly request timed out: ${err.message}`;
    }
    const status = err.response?.status;
    if (status !== undefined && status >= 500) {
      return `orderly responded ${status}`;
    }
    return `orderly request failed: ${err.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export class OrderlyClient {
  private client: AxiosInstance;
  private config: OrderlyConfig;

  constructor(config: OrderlyConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      // Bound every request: a hung socket must never stall the
      // single-flight strategy tick forever (plan §B1).
      timeout: config.timeoutMs ?? DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private async generateSignature(
    timestamp: number,
    method: string,
    path: string,
    body?: string
  ): Promise<string> {
    try {
      // Create the message string as required by Kodiak API
      const message = `${timestamp}${method}${path}${body || ""}`;

      // Decode base64 secret key to bytes
      let privateKeyBytes = Buffer.from(this.config.orderlySecret, "base64");

      // Handle different key formats - Ed25519 expects 32 bytes
      if (privateKeyBytes.length > 32) {
        // If key is longer than 32 bytes, take first 32 bytes (private key part)
        privateKeyBytes = privateKeyBytes.subarray(0, 32);
      } else if (privateKeyBytes.length < 32) {
        // If key is shorter, pad with zeros (defensive programming)
        const padded = Buffer.alloc(32);
        privateKeyBytes.copy(padded);
        privateKeyBytes = padded;
      }

      // Convert message to bytes
      const messageBytes = new TextEncoder().encode(message);

      // Hash the message with SHA256 as required by Kodiak API
      const hash = createHash("sha256").update(messageBytes).digest();

      // Sign the hash using Ed25519
      const signature = await signAsync(hash, privateKeyBytes);

      // Return base64url-encoded signature
      return Buffer.from(signature).toString("base64url");
    } catch (error) {
      throw new Error(
        `Failed to generate Kodiak signature: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async signRequest(
    method: string,
    path: string,
    body?: object
  ): Promise<Record<string, string>> {
    const timestamp = Date.now();
    const bodyStr = body ? JSON.stringify(body) : "";
    const signature = await this.generateSignature(
      timestamp,
      method,
      path,
      bodyStr
    );

    return {
      "orderly-account-id": this.config.accountId,
      "orderly-key": this.config.orderlyKey,
      "orderly-signature": signature,
      "orderly-timestamp": timestamp.toString(),
    };
  }

  async validatePositionSize(request: OrderRequest): Promise<void> {
    try {
      // Get account info for balance and limits
      const accountInfo = await this.getAccountInfo();
      const positions = await this.getPositions();

      // Calculate current exposure
      const currentExposure = positions.reduce((total, position) => {
        return total + Math.abs(position.position_qty * position.mark_price);
      }, 0);

      // Get current price for notional calculation
      const ticker = await this.getTicker(request.symbol);
      const currentPrice = ticker.price;

      // Calculate order notional value
      const orderNotional = request.orderQuantity * currentPrice;

      // Validation rules from docs
      const maxLeverage = accountInfo.max_leverage || 20;
      const accountBalance = accountInfo.total_value || 0; // Assuming this field exists
      const maxExposurePercent = 0.8; // 80% of account balance

      // Rule 1: Notional amount <= account_balance * max_leverage
      const maxAllowedNotional = accountBalance * maxLeverage;
      if (orderNotional > maxAllowedNotional) {
        throw new Error(
          `Order too large. Notional: ${orderNotional}, Max allowed: ${maxAllowedNotional}`
        );
      }

      // Rule 2: Total exposure <= 80% of account balance
      const newTotalExposure = currentExposure + orderNotional;
      const maxTotalExposure = accountBalance * maxExposurePercent;
      if (newTotalExposure > maxTotalExposure) {
        throw new Error(
          `Total exposure too high. New exposure: ${newTotalExposure}, Max allowed: ${maxTotalExposure}`
        );
      }

      // Rule 3: Check position limits per symbol
      const symbolPosition = positions.find(p => p.symbol === request.symbol);
      if (symbolPosition) {
        const symbolExposure = Math.abs(
          symbolPosition.position_qty * symbolPosition.mark_price
        );
        const newSymbolExposure = symbolExposure + orderNotional;
        const maxSymbolExposure = accountBalance * 0.5; // 50% per symbol limit

        if (newSymbolExposure > maxSymbolExposure) {
          throw new Error(
            `Symbol exposure too high. Symbol: ${request.symbol}, New exposure: ${newSymbolExposure}, Max allowed: ${maxSymbolExposure}`
          );
        }
      }

      // Rule 4: Validate against Orderly max_notional limits
      const maxNotionalLimits = accountInfo.max_notional || {};
      const symbolMaxNotional = maxNotionalLimits[request.symbol];
      if (symbolMaxNotional && orderNotional > symbolMaxNotional) {
        throw new Error(
          `Order exceeds Orderly max notional limit for ${request.symbol}. Order: ${orderNotional}, Limit: ${symbolMaxNotional}`
        );
      }

      logger.info("Position size validation passed", {
        orderNotional,
        symbol: request.symbol,
      });
    } catch (error) {
      logger.error("Position size validation failed", {
        error: error instanceof Error ? error.message : String(error),
        symbol: request.symbol,
      });
      throw error;
    }
  }

  async createOrder(request: OrderRequest): Promise<OrderResponse> {
    // Validate position size before placing order
    await this.validatePositionSize(request);

    // The exchange contract is snake_case; the domain model is camelCase.
    // Map first, then sign and send exactly the same serialized body.
    const payload = toOrderlyOrderPayload(request);

    const path = "/v1/order";
    const body = JSON.stringify(payload);
    const headers = await this.signRequest("POST", path, payload);

    const response = await this.client.post(path, body, {
      headers: { ...headers, "Content-Type": "application/json" },
    });
    return {
      orderId: response.data.data.order_id.toString(),
      status: response.data.data.status || "SUBMITTED",
    };
  }

  /**
   * Cancel an order and resolve only when the exchange confirms the
   * cancellation. Cancel/query are eventually consistent, so after the
   * DELETE is accepted the order is polled with bounded retries until it
   * reads back CANCELLED (or disappears — a 404 after an accepted cancel
   * is also confirmation). Transport failures during confirmation reject
   * so the caller treats the outcome as unknown, never as "absent".
   */
  async cancelOrder(
    orderId: string,
    symbol: string
  ): Promise<{ status: string }> {
    const path = `/v1/order?order_id=${orderId}&symbol=${symbol}`;
    const headers = await this.signRequest("DELETE", path);

    const response = await this.client.delete(path, { headers });
    const accepted = String(response.data?.data?.status ?? "CANCELLED");

    for (let attempt = 0; attempt < CANCEL_CONFIRM_ATTEMPTS; attempt++) {
      try {
        const order = await this.getOrder(orderId);
        if (
          order.status === "CANCELLED" ||
          order.status === "CANCELLED_BY_USER"
        ) {
          return { status: order.status };
        }
      } catch (error) {
        if (
          axios.isAxiosError(error) &&
          (error as AxiosError).response?.status === 404
        ) {
          return { status: "CANCELLED" };
        }
        throw error;
      }
      await new Promise(resolve =>
        setTimeout(resolve, CANCEL_CONFIRM_DELAY_MS)
      );
    }

    return { status: accepted };
  }

  async getOrder(orderId: string): Promise<OrderResponse> {
    const path = `/v1/order/${orderId}`;
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data.data;
    return {
      orderId: data.order_id.toString(),
      status: data.status,
      executedPrice: data.average_executed_price,
      executedQuantity: data.executed_quantity,
    };
  }

  /**
   * List open orders for a symbol — the startup orphan cross-check source
   * for the `ExchangeClient` contract. Transport failures reject; the
   * `queryOrderByClientOrderId` wrapper maps them to `UNREACHABLE`.
   */
  async listOpenOrders(symbol: string): Promise<ExchangeOpenOrder[]> {
    const path = `/v1/orders?symbol=${encodeURIComponent(symbol)}`;
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    const rows: unknown[] = response.data?.data?.rows ?? [];
    return rows.map(row =>
      toExchangeOpenOrder((row ?? {}) as Record<string, unknown>, symbol)
    );
  }

  /**
   * Look up one order by client order id. Never returns `null`:
   * - FOUND_OPEN when a listed row carries the id (Orderly's listing only
   *   reports open orders, so the FILLED/CANCELED arms exist for venues
   *   whose lookups resolve history — e.g. Lighter in workstream B3).
   * - NOT_FOUND when the listing succeeds and carries no such id, or the
   *   listing reports an empty book.
   * - UNREACHABLE on timeouts, 5xx, or network errors — the order may
   *   still be live, so the caller must freeze the slot, never recreate.
   */
  async queryOrderByClientOrderId(
    symbol: string,
    clientOrderId: string
  ): Promise<OrderLookup> {
    if (!clientOrderId) return { kind: "NOT_FOUND" };
    try {
      const orders = await this.listOpenOrders(symbol);
      const match = orders.find(o => o.clientOrderId === clientOrderId);
      if (!match) return { kind: "NOT_FOUND" };
      const status = match.status.toUpperCase();
      if (status === "FILLED" || status === "COMPLETED") {
        return { kind: "FOUND_FILLED", order: match };
      }
      if (status === "CANCELLED" || status === "REJECTED") {
        return { kind: "FOUND_CANCELED", order: match };
      }
      return { kind: "FOUND_OPEN", order: match };
    } catch (error) {
      return { kind: "UNREACHABLE", reason: toUnreachableReason(error) };
    }
  }

  /**
   * Idempotency reconcile: find an existing OPEN order that carries the given
   * clientOrderId on the symbol.
   *
   * Orderly enforces that a client_order_id is unique among open orders, so a
   * duplicate submission is rejected by the exchange. If the engine lost the
   * create-order response (network drop) but the exchange accepted the order,
   * listing open orders and matching by clientOrderId lets the grid adopt the
   * already-live order instead of re-submitting.
   *
   * Returns `null` when no open order matches (callers then place a new order).
   *
   * Kept for the grid strategy until workstream B4 rewires it onto
   * `queryOrderByClientOrderId` (which never returns `null`).
   */
  async findOrderByClientOrderId(
    symbol: string,
    clientOrderId: string
  ): Promise<OrderResponse | null> {
    if (!clientOrderId) return null;

    const path = `/v1/orders?symbol=${encodeURIComponent(symbol)}`;
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    const rows: unknown[] = response.data?.data?.rows ?? [];

    for (const row of rows) {
      const r = (row ?? {}) as Record<string, unknown>;
      if (String(r.client_order_id) === clientOrderId) {
        return {
          orderId: String(r.order_id),
          status: String(r.status || "OPEN"),
          executedPrice:
            r.average_executed_price != null
              ? Number(r.average_executed_price)
              : undefined,
          executedQuantity:
            r.executed_quantity != null
              ? Number(r.executed_quantity)
              : undefined,
        };
      }
    }

    return null;
  }

  async getPositions(): Promise<OrderlyPosition[]> {
    const path = "/v1/positions";
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    return response.data.data.rows || [];
  }

  async getAccountInfo(): Promise<OrderlyAccountInfo> {
    const path = "/v1/client/info";
    const headers = await this.signRequest("GET", path);

    const response = await this.client.get(path, { headers });
    return response.data.data;
  }

  async getTicker(symbol: string): Promise<OrderlyTicker> {
    const path = `/v1/public/ticker?symbol=${symbol}`;
    const response = await this.client.get(path);
    return response.data.data;
  }

  /**
   * Resting book depth via Orderly's PUBLIC orderbook — no signature (the
   * same unauthenticated family as `getTicker`). Wire shape: `{ bids, asks }`
   * of `[price, qty]` tuples (backend `KodiakOrderbook`), optionally nested
   * in the Orderly `{ success, data }` envelope — both are accepted.
   *
   * A body carrying NEITHER side is not an "empty book", it is an unreadable
   * answer — fail closed: the caller's flatten sizing must never be steered
   * by fiction. Transport failures are retryable (a gateway blip is not a
   * venue verdict).
   */
  async getMarketDepth(
    symbol: string,
    options?: { limit?: number }
  ): Promise<ExchangeMarketDepth> {
    const limit = options?.limit ?? DEFAULT_DEPTH_LEVELS;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DEPTH_LEVELS) {
      throw new CommandError(
        false,
        `kodiak depth limit must be an integer in [1, ${MAX_DEPTH_LEVELS}] (got ${String(limit)})`
      );
    }
    let payload: unknown;
    try {
      const response = await this.client.get(
        `/v1/public/orderbook?symbol=${encodeURIComponent(symbol)}`
      );
      payload = response.data?.data ?? response.data;
    } catch (error) {
      throw new CommandError(
        true,
        `kodiak depth unreachable for ${symbol}: ${toUnreachableReason(error)}`
      );
    }
    const body = (payload ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.bids) && !Array.isArray(body.asks)) {
      throw new CommandError(
        false,
        `kodiak depth malformed for ${symbol} (no bids/asks arrays)`
      );
    }
    const toLevels = (
      raw: unknown,
      side: "bids" | "asks"
    ): ExchangeDepthLevel[] => {
      const levels: ExchangeDepthLevel[] = [];
      if (!Array.isArray(raw)) return levels; // a missing side reads as empty
      for (const entry of raw) {
        // Orderly answers `[price, qty]` string tuples; anything else is
        // skipped (D1 — never guess a size).
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const price = Number(entry[0]);
        const quantity = Number(entry[1]);
        if (!Number.isFinite(price) || price <= 0) continue;
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        levels.push({ price, quantity });
      }
      levels.sort((a, b) =>
        side === "bids" ? b.price - a.price : a.price - b.price
      );
      return levels.slice(0, limit);
    };
    return {
      symbol,
      bids: toLevels(body.bids, "bids"),
      asks: toLevels(body.asks, "asks"),
    };
  }

  /**
   * Authoritative price rules from `GET /v1/public/info/{symbol}`.
   *
   * The venue's rule is `quote_tick` with the price filter
   * `(price - quote_min) % quote_tick == 0`. The engine models the zero-origin
   * case (`price % quote_tick == 0`), which is verified against live metadata:
   * every market on both public Orderly environments (`api.orderly.org` and
   * `testnet-api.orderly.org`) currently reports `quote_min === 0`. That is
   * observed live metadata, not a venue guarantee — a nonzero `quote_min`
   * would require offset-aware quantization, so this adapter fails closed
   * loudly rather than silently pricing against the wrong origin.
   *
   * The tick is normalized to a canonical decimal string *before* validation:
   * the venue returns `quote_tick` as a JSON number, and a fine tick like
   * `1e-7` (`PERP_1000PEPE_USDC`) stringifies to scientific notation
   * (`String(1e-7) === "1e-7"`), which the plain-decimal tick validator
   * rejects. `numberToDecimalString` recovers `"0.0000001"` so the market is
   * not wrongly refused. A missing/unparseable `quote_tick` fails closed
   * (never guessed).
   */
  async getMarketRules(symbol: string): Promise<MarketRules> {
    const path = `/v1/public/info/${encodeURIComponent(symbol)}`;
    let payload: unknown;
    try {
      const response = await this.client.get(path);
      payload = response.data?.data ?? response.data;
    } catch (error) {
      throw new CommandError(
        false,
        `Market rules unavailable for kodiak:${symbol}: ${messageOf(error)}`
      );
    }
    const row = (payload ?? {}) as Record<string, unknown>;
    // Zero-origin guard: the engine quantizes `price % quote_tick == 0`. A
    // nonzero quote_min would need offset-aware arithmetic the contract does
    // not model, so refuse rather than price against the wrong origin.
    const quoteMin = row.quote_min;
    if (quoteMin !== undefined && quoteMin !== null && Number(quoteMin) !== 0) {
      throw new CommandError(
        false,
        `kodiak:${symbol} reports nonzero quote_min ${JSON.stringify(
          quoteMin
        )} (offset price filter ` +
          `(price - quote_min) % quote_tick == 0); the engine models only the ` +
          `zero-origin tick grid and refuses to guess the price origin`
      );
    }
    const quoteTick = row.quote_tick;
    // Normalize a numeric tick to a canonical decimal string so scientific
    // notation (e.g. 1e-7) becomes "0.0000001" before the tick-shape check.
    let tickStr: string;
    try {
      tickStr =
        typeof quoteTick === "number"
          ? numberToDecimalString(quoteTick)
          : typeof quoteTick === "string"
            ? quoteTick.trim()
            : "";
    } catch {
      tickStr = "";
    }
    if (!isValidTickSizeString(tickStr)) {
      throw new CommandError(
        false,
        `Invalid quote_tick ${JSON.stringify(quoteTick)} for kodiak:${symbol} (no guessed precision)`
      );
    }
    return validateMarketRules({
      exchange: "kodiak",
      symbol: String(row.symbol ?? symbol),
      priceTickSize: tickStr,
    });
  }

  async getKlines(
    symbol: string,
    interval: string = "1m",
    limit: number = 100
  ): Promise<OrderlyKline[]> {
    const path = `/v1/kline?symbol=${symbol}&type=${interval}&limit=${limit}`;
    const response = await this.client.get(path);
    return response.data.data.rows || [];
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createOrderlyClient(
  accountId: string,
  orderlyKey: string,
  orderlySecret: string,
  isTestnet: boolean = false
): OrderlyClient {
  const baseUrl = isTestnet
    ? "https://testnet-api.orderly.org"
    : "https://api.orderly.org";

  return new OrderlyClient({
    accountId,
    orderlyKey,
    orderlySecret,
    baseUrl,
  });
}
