/** @format */

/**
 * Lighter exchange adapter (workstream B3).
 *
 * Implements the shared `ExchangeClient` contract over two transports,
 * mirroring exactly what the Phase-0 probe does (`session.py`): the
 * signing sidecar submits create/cancel L2 transactions, REST reads go
 * through axios with an `Authorization` token minted by the sidecar.
 *
 * Phase-0-verified semantics encoded here (not re-derived from docs):
 * - cancel/query are eventually consistent: a canceled order can read as
 *   missing once before settling on `canceled` — poll with bounded retries,
 *   and treat mid-flight results as UNRESOLVED/UNREACHABLE, never absent.
 * - duplicate `client_order_index` ⇒ adopt the live order the query
 *   returns, never double-place.
 * - unknown symbols ⇒ `CommandError`, never a guessed market.
 * - sidecar down ⇒ `UNREACHABLE` (slots freeze); signer refusals ⇒
 *   `CommandError` (business outcome).
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import {
  DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS,
  ExchangeAccountInfo,
  ExchangeClient,
  ExchangeOpenOrder,
  ExchangeOrderRequest,
  ExchangeOrderResponse,
  ExchangePosition,
  ExchangeTicker,
  OrderLookup,
} from "../../domain/exchange";
import {
  SignerCredentials,
  SignerError,
  SignerUnreachableError,
  TransactionSigner,
} from "../../domain/signer";
import { CommandError } from "../../application/command-error";
import { logger } from "../../utils/logger";
import { resolveLighterStatus, LighterResolution } from "./status-map";
import {
  LighterMarket,
  LighterMarketDirectory,
  UnknownMarketError,
} from "./market-map";
import { deriveLighterClientOrderIndexForKey } from "./client-order-id";

export interface LighterClientConfig {
  /** Lighter REST base URL (testnet or mainnet). */
  baseUrl: string;
  /** Venue credentials (per-request to the sidecar, held in memory only). */
  credentials: SignerCredentials;
  /** Signing sidecar (B2 `LighterSidecarSigner`). */
  signer: TransactionSigner;
  /** Per-request HTTP timeout (ms). Defaults to the shared exchange bound. */
  timeoutMs?: number;
  /**
   * Reader override for tests (stubbed market directory / REST).
   * Production omits it: REST and market reads share one axios instance.
   */
  rest?: AxiosInstance;
}

/** Cancel/query poll discipline (probe: cancel needs up to ~6 commits). */
const CONFIRM_ATTEMPTS = 6;
const CONFIRM_DELAY_MS = 1000;

/** Auth-token cache: minted tokens live well under the 8h sidecar cap. */
const AUTH_TOKEN_TTL_MS = 10 * 60 * 1000;

interface LighterOrderRow {
  order_id?: unknown;
  client_order_index?: unknown;
  client_order_id?: unknown;
  market_id?: unknown;
  market_index?: unknown;
  symbol?: unknown;
  status?: unknown;
  side?: unknown;
  is_ask?: unknown;
  price?: unknown;
  base_amount?: unknown;
  remaining_base_amount?: unknown;
  [key: string]: unknown;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function rowOrderId(row: LighterOrderRow): string {
  return String(row.order_id ?? row.client_order_index ?? "");
}

function rowClientIndex(row: LighterOrderRow): string | undefined {
  const raw = row.client_order_index ?? row.client_order_id;
  return raw === undefined || raw === null ? undefined : String(raw);
}

function rowSide(row: LighterOrderRow): "BUY" | "SELL" | undefined {
  if (typeof row.is_ask === "boolean") return row.is_ask ? "SELL" : "BUY";
  const side = String(row.side ?? "").toUpperCase();
  if (side === "SELL" || side === "ASK" || side === "SHORT") return "SELL";
  if (side === "BUY" || side === "BID" || side === "LONG") return "BUY";
  return undefined;
}

export class LighterClient implements ExchangeClient {
  private readonly rest: AxiosInstance;
  private readonly markets: LighterMarketDirectory;
  private readonly credentials: SignerCredentials;
  private readonly signer: TransactionSigner;
  private authToken: string | null = null;
  private authTokenAt = 0;

  constructor(config: LighterClientConfig) {
    if (!config.baseUrl) {
      throw new CommandError(false, "LighterClient needs a baseUrl");
    }
    this.credentials = config.credentials;
    this.signer = config.signer;
    this.rest =
      config.rest ??
      axios.create({
        baseURL: config.baseUrl.replace(/\/+$/, ""),
        timeout: config.timeoutMs ?? DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS,
        headers: { "Content-Type": "application/json" },
      });
    const rest = this.rest;
    const authHeaders = (): Promise<Record<string, string>> =>
      this.authHeaders();
    this.markets = new LighterMarketDirectory({
      get: async (
        path: string,
        options?: { params?: Record<string, unknown> }
      ) => {
        const headers = await authHeaders();
        const response = await rest.get(path, {
          params: options?.params,
          headers,
        });
        return { data: response.data };
      },
    });
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.authToken || Date.now() - this.authTokenAt > AUTH_TOKEN_TTL_MS) {
      try {
        this.authToken = await this.signer.authToken(this.credentials);
      } catch (error) {
        if (error instanceof SignerUnreachableError) {
          throw new CommandError(
            true,
            `lighter unreachable (auth token): ${error.message}`
          );
        }
        throw new CommandError(
          false,
          `lighter auth failed: ${messageOf(error)}`
        );
      }
      this.authTokenAt = Date.now();
    }
    return { Authorization: this.authToken as string };
  }

  private async authorizedGet(path: string, params?: Record<string, unknown>) {
    try {
      const headers = await this.authHeaders();
      return await this.rest.get(path, { params, headers });
    } catch (error) {
      if (error instanceof CommandError) throw error;
      throw unreachable(`GET ${path}`, error);
    }
  }

  private marketOf(symbol: string): Promise<LighterMarket> {
    return this.markets.get(symbol).catch(error => {
      if (error instanceof UnknownMarketError) {
        throw new CommandError(false, error.message);
      }
      throw unreachable(`market resolution for ${symbol}`, error);
    });
  }

  private toOpenOrder(
    row: LighterOrderRow,
    symbol: string,
    market: LighterMarket
  ): ExchangeOpenOrder {
    // A row without a status field is treated as resting (Phase 0: the REST
    // listing can omit it). The status is rendered in the venue-neutral
    // contract vocabulary ("CANCELLED", matching the absence-confirmation
    // branch and what the grid's checks compare against) so callers never
    // see two spellings of the same state.
    const resolution =
      row.status === undefined || row.status === null
        ? "OPEN"
        : resolveLighterStatus(row.status);
    const status = CONTRACT_STATUS[resolution];
    // `price` / `base_amount` arrive as scaled integers in the market's
    // decimals (the sidecar does no decimal math); the contract exposes
    // human units, otherwise a caller comparing prices across venues gets a
    // 100x-wrong number.
    const price = toNumberOrUndefined(row.price);
    const quantity = toNumberOrUndefined(row.base_amount);
    return {
      orderId: rowOrderId(row),
      clientOrderId: rowClientIndex(row),
      symbol,
      status,
      side: rowSide(row),
      price:
        price === undefined ? undefined : price / 10 ** market.priceDecimals,
      quantity:
        quantity === undefined
          ? undefined
          : quantity / 10 ** market.sizeDecimals,
      marketIndex: market.marketIndex,
      resolution,
    };
  }

  async getTicker(symbol: string): Promise<ExchangeTicker> {
    const market = await this.marketOf(symbol);
    if (market.markPrice) {
      return { symbol, price: market.markPrice, mark_price: market.markPrice };
    }
    const response = await this.authorizedGet("/api/v1/orderBookDetails", {
      market_id: market.marketIndex,
    });
    const entries = response.data?.order_book_details;
    const entry = Array.isArray(entries) ? entries[0] : undefined;
    const price = Number(entry?.mark_price);
    if (!Number.isFinite(price)) {
      throw new CommandError(
        true,
        `lighter mark price unavailable for ${symbol}`
      );
    }
    return { symbol, price, mark_price: price };
  }

  async createOrder(
    request: ExchangeOrderRequest
  ): Promise<ExchangeOrderResponse> {
    const market = await this.marketOf(request.symbol);
    if (request.orderType !== "LIMIT") {
      throw new CommandError(
        false,
        `lighter adapter supports LIMIT orders only, got ${request.orderType}`
      );
    }
    if (
      request.orderPrice === undefined ||
      !Number.isFinite(request.orderPrice)
    ) {
      throw new CommandError(false, "LIMIT orders require a finite orderPrice");
    }
    if (!Number.isFinite(request.orderQuantity) || request.orderQuantity <= 0) {
      throw new CommandError(
        false,
        "orderQuantity must be a finite positive number"
      );
    }
    const price = Math.round(request.orderPrice * 10 ** market.priceDecimals);
    const baseAmount = Math.round(
      request.orderQuantity * 10 ** market.sizeDecimals
    );
    if (price <= 0 || baseAmount <= 0) {
      throw new CommandError(
        false,
        "scaled price/amount underflow the market decimals"
      );
    }
    // The grid always supplies a deterministic id (its `(bot, level, side)`
    // key, hashed below into an int64). Without one the adapter derives from
    // the slot's own identity — symbol + scaled price — so two resting levels
    // never share an index and a restart re-derives the same one.
    const index = request.clientOrderId
      ? clientIndexFromString(request.clientOrderId)
      : deriveLighterClientOrderIndexForKey(
          `${request.symbol}|${price}`,
          request.side
        );
    try {
      const { txHash } = await this.signer.createOrder(this.credentials, {
        marketIndex: market.marketIndex,
        clientOrderIndex: index,
        baseAmount,
        price,
        isAsk: request.side === "SELL",
      });
      logger.info("Lighter order submitted", {
        symbol: request.symbol,
        marketIndex: market.marketIndex,
        clientOrderIndex: index,
        txHash,
      });
    } catch (error) {
      if (error instanceof SignerUnreachableError) {
        throw new CommandError(
          true,
          `lighter unreachable (create): ${error.message}`
        );
      }
      if (error instanceof SignerError) {
        return this.adoptAfterRefusal(request.symbol, String(index), error);
      }
      throw error;
    }
    const confirmed = await this.pollForOrder(request.symbol, String(index));
    if (!confirmed) {
      throw new CommandError(
        true,
        `lighter create UNRESOLVED for ${index} (submitted, not yet visible)`
      );
    }
    return {
      orderId: confirmed.orderId,
      status: confirmed.status,
      executedPrice: confirmed.price,
      executedQuantity: confirmed.quantity,
    };
  }

  private async adoptAfterRefusal(
    symbol: string,
    index: string,
    cause: SignerError
  ): Promise<ExchangeOrderResponse> {
    const lookup = await this.queryOrderByClientOrderId(symbol, index);
    if (lookup.kind === "FOUND_OPEN" || lookup.kind === "FOUND_FILLED") {
      logger.info("Lighter duplicate index adopted", {
        symbol,
        clientOrderIndex: index,
      });
      return {
        orderId: lookup.order.orderId,
        status: lookup.order.status,
        executedPrice: lookup.order.price,
        executedQuantity: lookup.order.quantity,
      };
    }
    if (lookup.kind === "UNREACHABLE") {
      throw new CommandError(
        true,
        `lighter unreachable after refusal: ${lookup.reason}`
      );
    }
    throw new CommandError(false, `lighter create refused: ${cause.message}`);
  }

  private async pollForOrder(
    symbol: string,
    index: string
  ): Promise<ExchangeOpenOrder | null> {
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      const lookup = await this.queryOrderByClientOrderId(symbol, index);
      if (lookup.kind === "FOUND_OPEN" || lookup.kind === "FOUND_FILLED") {
        return lookup.order;
      }
      if (lookup.kind === "FOUND_CANCELED") return null;
      await sleep(CONFIRM_DELAY_MS);
    }
    return null;
  }

  async cancelOrder(
    orderId: string,
    symbol: string
  ): Promise<{ status: string }> {
    const market = await this.marketOf(symbol);
    const index = clientIndexFromString(orderId);
    try {
      await this.signer.cancelOrder(this.credentials, {
        marketIndex: market.marketIndex,
        orderIndex: index,
      });
    } catch (error) {
      if (error instanceof SignerUnreachableError) {
        throw new CommandError(
          true,
          `lighter unreachable (cancel): ${error.message}`
        );
      }
      throw new CommandError(
        false,
        `lighter cancel refused: ${messageOf(error)}`
      );
    }
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
      const lookup = await this.queryOrderByClientOrderId(
        symbol,
        String(index)
      );
      if (lookup.kind === "FOUND_CANCELED") {
        return { status: lookup.order.status };
      }
      if (lookup.kind === "UNREACHABLE") {
        // We could not ask whether the cancel committed. Reporting success
        // here would be a lie; the caller freezes the slot and retries.
        throw new CommandError(
          true,
          `lighter cancel UNREACHABLE for ${index}: ${lookup.reason}`
        );
      }
      if (lookup.kind === "NOT_FOUND") {
        const active = await this.queryActive(symbol, String(index));
        if (active.kind === "NOT_FOUND") {
          // Phase 0: a canceled order reads as missing (in both listings)
          // before it settles on `canceled` — absence is the confirmation.
          return { status: "CANCELLED" };
        }
        if (active.kind === "UNREACHABLE") {
          throw new CommandError(
            true,
            `lighter cancel UNREACHABLE for ${index}: ${active.reason}`
          );
        }
      }
      await sleep(CONFIRM_DELAY_MS);
    }
    throw new CommandError(
      true,
      `lighter cancel UNRESOLVED for ${index} (submitted, not confirmed)`
    );
  }

  async getOrder(orderId: string): Promise<ExchangeOrderResponse> {
    throw new CommandError(
      false,
      `lighter getOrder needs a symbol-qualified lookup (got ${orderId})`
    );
  }

  async getPositions(): Promise<ExchangePosition[]> {
    const response = await this.authorizedGet("/api/v1/account", {
      by: "index",
      value: String(this.credentials.accountIndex),
    });
    const accounts = response.data?.accounts;
    const account = Array.isArray(accounts) ? accounts[0] : undefined;
    const positions = account?.positions;
    if (!Array.isArray(positions)) return [];
    return positions.map(row => {
      const record = (row ?? {}) as Record<string, unknown>;
      return {
        symbol: String(record.symbol ?? record.market ?? ""),
        position_qty: Number(record.position ?? record.amount ?? 0),
        mark_price: Number(record.mark_price ?? 0),
      };
    });
  }

  async getAccountInfo(): Promise<ExchangeAccountInfo> {
    const response = await this.authorizedGet("/api/v1/account", {
      by: "index",
      value: String(this.credentials.accountIndex),
    });
    const accounts = response.data?.accounts;
    const account = Array.isArray(accounts) ? accounts[0] : undefined;
    if (!account) {
      throw new CommandError(
        true,
        "lighter account lookup returned no account"
      );
    }
    return {
      total_value: Number(account.collateral ?? account.equity ?? 0),
      max_leverage: Number(account.leverage ?? 0),
    };
  }

  async listOpenOrders(symbol: string): Promise<ExchangeOpenOrder[]> {
    const market = await this.marketOf(symbol);
    // Phase 0 verified `account_index` only for this endpoint, so the market
    // filter is applied to the returned rows rather than asserting an
    // unverified query parameter (a 400 here would look like an outage).
    const response = await this.authorizedGet("/api/v1/accountActiveOrders", {
      account_index: this.credentials.accountIndex,
    });
    const orders = response.data?.orders;
    const rows: unknown[] = Array.isArray(orders) ? orders : [];
    return rows
      .map(row => (row ?? {}) as LighterOrderRow)
      .filter(row => rowInMarket(row, market.marketIndex))
      .map(row => this.toOpenOrder(row, symbol, market));
  }

  async queryOrderByClientOrderId(
    symbol: string,
    clientOrderId: string
  ): Promise<OrderLookup> {
    if (!clientOrderId) return { kind: "NOT_FOUND" };
    let market: LighterMarket;
    try {
      market = await this.marketOf(symbol);
    } catch (error) {
      if (error instanceof CommandError && !error.retryable) {
        return { kind: "NOT_FOUND" };
      }
      return { kind: "UNREACHABLE", reason: messageOf(error) };
    }
    let response;
    try {
      response = await this.authorizedGet("/api/v1/accountOrders", {
        account_index: this.credentials.accountIndex,
        client_order_indexes: clientOrderId,
      });
    } catch (error) {
      return { kind: "UNREACHABLE", reason: messageOf(error) };
    }
    const orders = response.data?.orders;
    const rows: unknown[] = Array.isArray(orders) ? orders : [];
    const match = rows
      .map(row => (row ?? {}) as LighterOrderRow)
      .filter(row => rowInMarket(row, market.marketIndex))
      .find(row => rowClientIndex(row) === clientOrderId);
    if (!match) {
      const active = await this.queryActive(symbol, clientOrderId);
      if (active.kind !== "NOT_FOUND") return active;
      return { kind: "NOT_FOUND" };
    }
    return lookupOf(this.toOpenOrder(match, symbol, market));
  }

  private async queryActive(
    symbol: string,
    index: string
  ): Promise<OrderLookup> {
    let market: LighterMarket;
    try {
      market = await this.marketOf(symbol);
    } catch (error) {
      return { kind: "UNREACHABLE", reason: messageOf(error) };
    }
    let response;
    try {
      response = await this.authorizedGet("/api/v1/accountActiveOrders", {
        account_index: this.credentials.accountIndex,
      });
    } catch (error) {
      return { kind: "UNREACHABLE", reason: messageOf(error) };
    }
    const orders = response.data?.orders;
    const rows: unknown[] = Array.isArray(orders) ? orders : [];
    const match = rows
      .map(row => (row ?? {}) as LighterOrderRow)
      .filter(row => rowInMarket(row, market.marketIndex))
      .find(row => rowClientIndex(row) === index);
    if (!match) return { kind: "NOT_FOUND" };
    return lookupOf(this.toOpenOrder(match, symbol, market));
  }
}

/**
 * Does a listing row belong to the given market? Rows that expose no market
 * field cannot be filtered and are kept — the client-order-index match is
 * what identifies the order, and dropping rows on a guess could hide a live
 * order (which would then be double-placed).
 */
function rowInMarket(row: LighterOrderRow, marketIndex: number): boolean {
  const raw = row.market_id ?? row.market_index;
  if (raw === undefined || raw === null) return true;
  return Number(raw) === marketIndex;
}

/** Resolution bucket → venue-neutral contract status string. */
const CONTRACT_STATUS: Record<LighterResolution, string> = {
  OPEN: "OPEN",
  FILLED: "FILLED",
  CANCELED: "CANCELLED",
  UNRESOLVED: "UNRESOLVED",
};

function lookupOf(order: ExchangeOpenOrder): OrderLookup {
  switch (resolveLighterStatus(order.status)) {
    case "FILLED":
      return { kind: "FOUND_FILLED", order };
    case "CANCELED":
      return { kind: "FOUND_CANCELED", order };
    case "OPEN":
      return { kind: "FOUND_OPEN", order };
    default:
      return {
        kind: "UNREACHABLE",
        reason: `lighter status UNRESOLVED: ${order.status}`,
      };
  }
}

function clientIndexFromString(value: string): number {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return n;
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function unreachable(what: string, error: unknown): CommandError {
  if (error instanceof CommandError) return error;
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError;
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      return new CommandError(true, `lighter unreachable (${what} timed out)`);
    }
    const status = err.response?.status;
    if (status !== undefined && status >= 500) {
      return new CommandError(
        true,
        `lighter unreachable (${what} responded ${status})`
      );
    }
    return new CommandError(
      false,
      `lighter request failed (${what}): ${err.message}`
    );
  }
  return new CommandError(
    true,
    `lighter unreachable (${what}): ${messageOf(error)}`
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
