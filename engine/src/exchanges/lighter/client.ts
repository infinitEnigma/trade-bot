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
 *
 * Live testnet facts recorded while driving this client end-to-end (B5):
 * - REST order rows carry **human-unit** strings (`price` "2745.14",
 *   `initial_base_amount` "0.0100"); `base_price` is the scaled wire integer.
 * - `accountOrders?client_order_indexes=` may return *several* rows for one
 *   index and lags a fill by seconds; liveness is answered by
 *   `accountActiveOrders`, and history rows are picked OPEN-first.
 * - the identifier cancel/`getOrder` accept is the **client order index**;
 *   the venue's `order_id` is exposed as `venueOrderId` for audit only.
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
  base_price?: unknown;
  base_amount?: unknown;
  initial_base_amount?: unknown;
  remaining_base_amount?: unknown;
  filled_base_amount?: unknown;
  transaction_time?: unknown;
  updated_at?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The contract handle for a Lighter order: the **client order index**.
 *
 * Live-verified (testnet, B5): cancel takes the client order index and
 * `getOrder` queries `accountOrders?client_order_indexes=` — neither accepts
 * the venue's own `order_id` (a 5.6e14 id). Emitting that id as `orderId`
 * would leave `grid.stop()` cancelling an id the venue cannot match, i.e. an
 * orphan order. The handle therefore is the identifier this adapter's own
 * cancel/query accept; the venue id stays on the row as `venueOrderId`.
 */
function orderHandle(row: LighterOrderRow): string {
  const client = rowClientIndex(row);
  return client ?? String(row.order_id ?? "");
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

/**
 * Scale a wire integer (`base_price`) down into human units. `undefined`
 * passes through so a missing field stays missing instead of becoming 0.
 */
function scaleDown(
  value: number | undefined,
  decimals: number
): number | undefined {
  return value === undefined ? undefined : value / 10 ** decimals;
}

/**
 * Parse a strict digit string into an int64-safe index. Anything else is
 * refused (`null`) rather than hashed: `getOrder` must never act on an id
 * that silently mapped onto an unrelated index.
 */
function numericIndexOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Preference order when one client index carries several history rows. */
const RESOLUTION_RANK: Record<LighterResolution, number> = {
  OPEN: 3,
  FILLED: 2,
  CANCELED: 1,
  UNRESOLVED: 0,
};

function rowTimestamp(row: LighterOrderRow): number {
  return (
    toNumberOrUndefined(row.transaction_time) ??
    toNumberOrUndefined(row.updated_at) ??
    toNumberOrUndefined(row.timestamp) ??
    0
  );
}

/**
 * Pick the row that best answers "what state is this client index in":
 * OPEN beats FILLED beats CANCELED beats UNRESOLVED — the venue re-uses an
 * index after a fill, so `accountOrders?client_order_indexes=` can return
 * several rows and its order is not a relevance order (`rows[0]` may be the
 * stale FILLED ancestor of a live order). Ties resolve to the newest row.
 */
function pickBestRow(rows: LighterOrderRow[]): LighterOrderRow | undefined {
  let best: LighterOrderRow | undefined;
  let bestRank = -1;
  let bestTime = -1;
  for (const row of rows) {
    const rank = RESOLUTION_RANK[resolveLighterStatus(row.status)];
    const time = rowTimestamp(row);
    if (rank > bestRank || (rank === bestRank && time > bestTime)) {
      best = row;
      bestRank = rank;
      bestTime = time;
    }
  }
  return best;
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
    // Live venue rows are human-unit strings (`price` "2745.14",
    // `initial_base_amount` "0.0100"); `base_price` (137532) is the scaled
    // integer the *wire* uses. Dividing the human fields by 10**decimals
    // reported prices 100x too small, so read them as-is and scale only the
    // `base_price` fallback. `quantity` is the order's size — a full fill of
    // it is what the grid books; a partial fill still reads as OPEN.
    const price =
      toNumberOrUndefined(row.price) ??
      scaleDown(toNumberOrUndefined(row.base_price), market.priceDecimals);
    const quantity =
      toNumberOrUndefined(row.initial_base_amount) ??
      toNumberOrUndefined(row.remaining_base_amount) ??
      toNumberOrUndefined(row.filled_base_amount) ??
      toNumberOrUndefined(row.base_amount);
    return {
      orderId: orderHandle(row),
      clientOrderId: rowClientIndex(row),
      symbol,
      status,
      side: rowSide(row),
      price,
      quantity,
      marketIndex: market.marketIndex,
      resolution,
      venueOrderId:
        row.order_id === undefined || row.order_id === null
          ? undefined
          : String(row.order_id),
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
      // Hand back the client order index — the identifier `cancelOrder` and
      // `getOrder` accept for this venue (see `orderHandle`), so a slot that
      // stores this value can always be cancelled/polled after a restart.
      orderId: String(index),
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

  /**
   * Poll one order by its contract handle (the client order index — see
   * `orderHandle`). No symbol is carried by the contract, and none is needed:
   * the handle indexes both listings account-wide, and row prices are already
   * human units. An unknown handle is a business outcome (`retryable=false`);
   * an UNRESOLVED status is "look again" (`retryable=true`), never "absent".
   */
  async getOrder(orderId: string): Promise<ExchangeOrderResponse> {
    const index = numericIndexOrNull(orderId);
    if (index === null) {
      throw new CommandError(
        false,
        `lighter getOrder expects the client order index handle (got ${orderId})`
      );
    }
    const key = String(index);
    const active = await this.fetchRows(
      `/api/v1/accountActiveOrders`,
      { account_index: this.credentials.accountIndex },
      `getOrder ${key}`
    );
    let match = pickBestRow(active.filter(row => rowClientIndex(row) === key));
    if (!match) {
      const history = await this.fetchRows(
        `/api/v1/accountOrders`,
        {
          account_index: this.credentials.accountIndex,
          client_order_indexes: key,
        },
        `getOrder ${key}`
      );
      match = pickBestRow(history.filter(row => rowClientIndex(row) === key));
    }
    if (!match) {
      throw new CommandError(false, `lighter order not found: ${orderId}`);
    }
    const resolution =
      match.status === undefined || match.status === null
        ? "OPEN"
        : resolveLighterStatus(match.status);
    if (resolution === "UNRESOLVED") {
      throw new CommandError(
        true,
        `lighter order status UNRESOLVED for ${orderId}: ${String(match.status)}`
      );
    }
    return {
      orderId: key,
      status: CONTRACT_STATUS[resolution],
      executedPrice: toNumberOrUndefined(match.price) ?? undefined,
      executedQuantity: toNumberOrUndefined(match.filled_base_amount),
    };
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
    // Liveness first: `accountActiveOrders` is the listing that knows what
    // is live, and history can still show a stale terminal row for an index
    // the venue has already re-used — so history must never overrule it.
    const active = await this.queryActive(symbol, clientOrderId);
    if (active.kind !== "NOT_FOUND") return active;
    let response;
    try {
      response = await this.authorizedGet("/api/v1/accountOrders", {
        account_index: this.credentials.accountIndex,
        // Verified against testnet: the venue reads the PLURAL key
        // (`client_order_indexes`); the singular form 400s.
        client_order_indexes: clientOrderId,
      });
    } catch (error) {
      return { kind: "UNREACHABLE", reason: messageOf(error) };
    }
    const orders = response.data?.orders;
    const rows: unknown[] = Array.isArray(orders) ? orders : [];
    const matches = rows
      .map(row => (row ?? {}) as LighterOrderRow)
      .filter(row => rowInMarket(row, market.marketIndex))
      .filter(row => rowClientIndex(row) === clientOrderId);
    // One index can carry several rows (the venue re-uses it after a fill,
    // live-verified) and history lags a fill by seconds — pick OPEN-first
    // instead of taking `rows[0]`.
    const best = pickBestRow(matches);
    if (best) return lookupOf(this.toOpenOrder(best, symbol, market));
    // Nothing live and nothing in history. Phase 0 verified an empty result
    // as a definitive NOT_FOUND for an unknown id; a just-submitted order may
    // still be indexing, but the venue accepts a re-submitted live index
    // idempotently (adopts, never duplicates), so a stale NOT_FOUND that
    // triggers a re-place cannot create a second live order.
    return { kind: "NOT_FOUND" };
  }

  /**
   * GET rows from a listing endpoint with the shared unreachable mapping.
   * Transport failures surface as `UNREACHABLE` via the caller, not as an
   * empty list — "could not ask" must never read as "absent".
   */
  private async fetchRows(
    path: string,
    params: Record<string, unknown>,
    what: string
  ): Promise<LighterOrderRow[]> {
    let response;
    try {
      response = await this.authorizedGet(path, params);
    } catch (error) {
      throw unreachable(what, error);
    }
    const orders = response.data?.orders;
    const rows: unknown[] = Array.isArray(orders) ? orders : [];
    return rows.map(row => (row ?? {}) as LighterOrderRow);
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
  const trimmed = value.trim();
  // Smoke + grid paths pass through stringified int64 indices: keep them
  // verbatim (no lossy re-hash) so query/cancel hit the same index the
  // venue indexed the order under.
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n) && n >= 0) return n;
  }
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
