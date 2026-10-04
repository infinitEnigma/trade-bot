/**
 * Phase 6 — shared scripted, fault-injecting fake exchange.
 *
 * One `ExchangeClient` implementation used by the reconciliation, grid and
 * failure-injection suites (promoted from the previously duplicated
 * `fakeExchange` helpers). It is a programmable venue:
 *
 * - every method has a boring happy-path default;
 * - `on(method, handler)` scripts a method's behaviour;
 * - `fail(method, error, times)` makes a method reject (transport faults);
 * - `calls` journals every invocation and `created` keeps every create
 *   request, so a test can assert what the engine did *to the venue*
 *   (e.g. "never placed a duplicate").
 *
 * @format
 */

import {
  ExchangeAccountInfo,
  ExchangeClient,
  ExchangeFeeRates,
  ExchangeOpenOrder,
  ExchangeOrderRequest,
  ExchangeOrderResponse,
  ExchangePosition,
  ExchangeTicker,
  OrderLookup,
} from "../../../domain/exchange";

/** Scriptable per-method behaviours (return `unknown`; cast on use). */
export interface FakeExchangeHandlers {
  getTicker?: (symbol: string) => unknown;
  createOrder?: (request: ExchangeOrderRequest) => unknown;
  cancelOrder?: (orderId: string, symbol: string) => unknown;
  getOrder?: (orderId: string) => unknown;
  getPositions?: () => unknown;
  getAccountInfo?: () => unknown;
  getFeeRates?: () => unknown;
  listOpenOrders?: (symbol: string) => unknown;
  queryOrderByClientOrderId?: (
    symbol: string,
    clientOrderId: string
  ) => unknown;
}

export type FakeMethod = keyof FakeExchangeHandlers;

export interface FakeCall {
  method: FakeMethod;
  args: unknown[];
}

export class FakeExchange implements ExchangeClient {
  /** Every call, in order — the "what did the engine do?" journal. */
  readonly calls: FakeCall[] = [];
  /** Every create request, in order — the double-placement probe. */
  readonly created: ExchangeOrderRequest[] = [];

  /** Happy-path defaults a test can retune. */
  ticker: ExchangeTicker = { symbol: "ETH", price: 2500 };
  positions: ExchangePosition[] = [];
  accountInfo: ExchangeAccountInfo = { total_value: 0, max_leverage: 1 };
  openOrders: ExchangeOpenOrder[] = [];
  scan: OrderLookup = { kind: "NOT_FOUND" };
  feeRates: ExchangeFeeRates = {
    makerRate: 0,
    takerRate: 0,
    tier: "fake",
    venueReported: false,
    exact: true,
  };

  private handlers: FakeExchangeHandlers = {};
  private failures = new Map<
    FakeMethod,
    { error: unknown; remaining: number }
  >();

  /** Script a method persistently. */
  on<K extends FakeMethod>(
    method: K,
    handler: NonNullable<FakeExchangeHandlers[K]>
  ): this {
    this.handlers[method] = handler;
    return this;
  }

  /** Make `method` reject with `error` for the next `times` calls (all by default). */
  fail(method: FakeMethod, error: unknown, times = Infinity): this {
    this.failures.set(method, { error, remaining: times });
    return this;
  }

  /** How many times `method` was called. */
  count(method: FakeMethod): number {
    return this.calls.filter(c => c.method === method).length;
  }

  private enter(method: FakeMethod, ...args: unknown[]): void {
    this.calls.push({ method, args });
    const f = this.failures.get(method);
    if (f && f.remaining > 0) {
      f.remaining -= 1;
      throw f.error;
    }
  }

  private scripted<K extends FakeMethod>(
    method: K,
    ...args: Parameters<NonNullable<FakeExchangeHandlers[K]>>
  ): unknown {
    const handler = this.handlers[method] as unknown as
      ((...a: unknown[]) => unknown) | undefined;
    return handler ? handler(...args) : undefined;
  }

  async getTicker(symbol: string): Promise<ExchangeTicker> {
    this.enter("getTicker", symbol);
    const s = this.scripted("getTicker", symbol);
    if (s !== undefined) return s as ExchangeTicker;
    return { ...this.ticker, symbol };
  }

  async createOrder(
    request: ExchangeOrderRequest
  ): Promise<ExchangeOrderResponse> {
    this.created.push(request);
    this.enter("createOrder", request);
    const s = this.scripted("createOrder", request);
    if (s !== undefined) return s as ExchangeOrderResponse;
    return { orderId: `ex-${this.created.length}`, status: "OPEN" };
  }

  async cancelOrder(
    orderId: string,
    symbol: string
  ): Promise<{ status: string }> {
    this.enter("cancelOrder", orderId, symbol);
    const s = this.scripted("cancelOrder", orderId, symbol);
    if (s !== undefined) return s as { status: string };
    return { status: "CANCELLED" };
  }

  async getOrder(orderId: string): Promise<ExchangeOrderResponse> {
    this.enter("getOrder", orderId);
    const s = this.scripted("getOrder", orderId);
    if (s !== undefined) return s as ExchangeOrderResponse;
    return { orderId, status: "OPEN" };
  }

  async getPositions(): Promise<ExchangePosition[]> {
    this.enter("getPositions");
    const s = this.scripted("getPositions");
    if (s !== undefined) return s as ExchangePosition[];
    return this.positions;
  }

  async getAccountInfo(): Promise<ExchangeAccountInfo> {
    this.enter("getAccountInfo");
    const s = this.scripted("getAccountInfo");
    if (s !== undefined) return s as ExchangeAccountInfo;
    return this.accountInfo;
  }

  async getFeeRates(): Promise<ExchangeFeeRates> {
    this.enter("getFeeRates");
    const s = this.scripted("getFeeRates");
    if (s !== undefined) return s as ExchangeFeeRates;
    return this.feeRates;
  }

  async listOpenOrders(symbol: string): Promise<ExchangeOpenOrder[]> {
    this.enter("listOpenOrders", symbol);
    const s = this.scripted("listOpenOrders", symbol);
    if (s !== undefined) return s as ExchangeOpenOrder[];
    return this.openOrders;
  }

  async queryOrderByClientOrderId(
    symbol: string,
    clientOrderId: string
  ): Promise<OrderLookup> {
    this.enter("queryOrderByClientOrderId", symbol, clientOrderId);
    const s = this.scripted("queryOrderByClientOrderId", symbol, clientOrderId);
    if (s !== undefined) return s as OrderLookup;
    return this.scan;
  }
}

/** An axios-shaped HTTP error (`axios.isAxiosError` only checks the flag). */
export function httpError(status: number): unknown {
  return {
    isAxiosError: true,
    message: `request failed with status ${status}`,
    response: { status },
  };
}

/** A transport timeout (a thrown `Error`, not an axios error). */
export function timeoutError(): Error {
  return new Error("timeout of 8000ms exceeded");
}
