/** @format */

/**
 * B3 adapter tests: `LighterClient` against stubbed REST + stubbed signer.
 *
 * Covers the Phase-0-verified semantics the plan requires:
 * - duplicate `client_order_index` ⇒ adopt, never double-place
 * - unknown symbol ⇒ CommandError, never a guessed market
 * - sidecar down ⇒ retryable (UNREACHABLE); refusal with no order ⇒ refusal
 * - cancel resolves only on confirmed CANCELED
 */

import axios from "axios";
import { LighterClient } from "../client";
import { CommandError } from "../../../application/command-error";
import {
  SignerError,
  SignerUnreachableError,
  TransactionSigner,
} from "../../../domain/signer";

const CREDS = {
  accountIndex: 5,
  apiKeyIndex: 2,
  privateKey: "test-key",
  env: "testnet" as const,
};

const BOOKS = { order_books: [{ symbol: "ETH", market_id: 1 }] };
const DETAILS = {
  order_book_details: [
    {
      symbol: "ETH",
      market_id: 1,
      supported_price_decimals: 2,
      supported_size_decimals: 3,
      min_base_amount: 1,
      mark_price: "2500.5",
    },
  ],
};

function restStub(handlers: Record<string, (params?: unknown) => unknown>) {
  const instance = axios.create();
  const calls: { path: string; params?: unknown }[] = [];
  instance.get = (async (path: string, options?: { params?: unknown }) => {
    calls.push({ path, params: options?.params });
    const handler = handlers[path];
    if (!handler) throw new Error(`no stub for ${path}`);
    return { data: handler(options?.params) };
  }) as typeof instance.get;
  return { instance, calls };
}

/**
 * Minimal axios-shaped failure (`isAxiosError` + `response.status/data`) so the
 * adapter's error mapping can be exercised without a live venue.
 */
function httpError(status: number, data: unknown) {
  const error = new Error(
    `Request failed with status code ${status}`
  ) as Error & {
    isAxiosError: boolean;
    response: { status: number; data: unknown };
  };
  error.isAxiosError = true;
  error.response = { status, data };
  return error;
}

function signerStub(
  overrides: Partial<TransactionSigner> = {}
): TransactionSigner {
  return {
    createOrder: async () => ({ txHash: "0x1", clientOrderIndex: 1 }),
    cancelOrder: async () => ({ txHash: "0xc", orderIndex: 1 }),
    authToken: async () => "token",
    isReachable: async () => true,
    ...overrides,
  };
}

function clientWith(
  handlers: Record<string, (params?: unknown) => unknown>,
  signer: TransactionSigner
) {
  const { instance } = restStub(handlers);
  return new LighterClient({
    baseUrl: "http://stub",
    credentials: CREDS,
    signer,
    rest: instance,
  });
}

const BASE_HANDLERS = {
  "/api/v1/orderBooks": () => BOOKS,
  "/api/v1/orderBookDetails": () => DETAILS,
  "/api/v1/accountActiveOrders": () => ({ orders: [] }),
  "/api/v1/accountOrders": () => ({ orders: [] }),
};

describe("LighterClient", () => {
  it("adopts the live order on duplicate index instead of double-placing", async () => {
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountOrders": () => ({
          orders: [{ order_id: "9", client_order_index: "42", status: "open" }],
        }),
      },
      signerStub({
        createOrder: async () => {
          throw new SignerError("duplicate");
        },
      })
    );
    const order = await client.createOrder({
      symbol: "ETH",
      side: "BUY",
      orderType: "LIMIT",
      orderPrice: 2400,
      orderQuantity: 0.01,
      clientOrderId: "42",
    });
    // The handle handed back is the client order index — what this adapter's
    // cancel/getOrder accept (the venue's own `order_id` "9" is not a usable
    // id for either, live-verified in B5).
    expect(order.orderId).toBe("42");
  });

  it("rejects unknown symbols without guessing a market", async () => {
    const client = clientWith(
      {
        "/api/v1/orderBooks": () => ({ order_books: [] }),
        "/api/v1/orderBookDetails": () => ({}),
      },
      signerStub()
    );
    await expect(
      client.createOrder({
        symbol: "NOPE",
        side: "BUY",
        orderType: "LIMIT",
        orderPrice: 1,
        orderQuantity: 1,
      })
    ).rejects.toBeInstanceOf(CommandError);
  });

  it("maps sidecar downtime to retryable (UNREACHABLE semantics)", async () => {
    const client = clientWith(
      BASE_HANDLERS,
      signerStub({
        createOrder: async () => {
          throw new SignerUnreachableError("down");
        },
      })
    );
    const error: unknown = await client
      .createOrder({
        symbol: "ETH",
        side: "BUY",
        orderType: "LIMIT",
        orderPrice: 2400,
        orderQuantity: 0.01,
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).retryable).toBe(true);
  });

  it("confirms cancel only when the query settles on canceled", async () => {
    let polls = 0;
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountOrders": () => {
          polls += 1;
          if (polls < 2) {
            // Eventual consistency: the order still reads open right after
            // the cancel was accepted (Phase 0).
            return {
              orders: [
                { order_id: "7", client_order_index: "7", status: "open" },
              ],
            };
          }
          return {
            orders: [
              { order_id: "7", client_order_index: "7", status: "canceled" },
            ],
          };
        },
      },
      signerStub()
    );
    const result = await client.cancelOrder("7", "ETH");
    // Contract vocabulary (canonicalLighterStatus), not the raw REST string.
    expect(result.status).toBe("CANCELLED");
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  it("fills a MARKET request as an IOC limit crossed below the mark (SELL)", async () => {
    // The panic flatten asks for a MARKET order. This venue signs LIMIT orders
    // only, so the adapter crosses the mark price: SELL below it, IOC so the
    // remainder dies instead of resting. Without this the emergency stop could
    // not close exposure at all (live P4: "supports LIMIT orders only").
    const signed: Array<{
      price: number;
      isAsk: boolean;
      timeInForce?: number;
      baseAmount: number;
    }> = [];
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountOrders": () => ({
          orders: [
            {
              order_id: "11",
              client_order_index: "11",
              status: "filled",
              is_ask: true,
              price: "2475.49",
              initial_base_amount: "2.5",
            },
          ],
        }),
      },
      signerStub({
        createOrder: async (_credentials, request) => {
          signed.push({
            price: request.price,
            isAsk: request.isAsk,
            timeInForce: request.timeInForce,
            baseAmount: request.baseAmount,
          });
          return { txHash: "0xm", clientOrderIndex: request.clientOrderIndex };
        },
      })
    );

    const order = await client.createOrder({
      symbol: "ETH",
      side: "SELL",
      orderType: "MARKET",
      orderQuantity: 2.5,
      clientOrderId: "11",
    });

    // mark 2500.5 × (1 − 1%) = 2475.495 → scaled by the 2 price decimals.
    expect(signed).toHaveLength(1);
    expect(signed[0].price).toBe(247550);
    expect(signed[0].isAsk).toBe(true);
    // 0 = IOC: fills what it can, cancels the rest (no resting residue).
    expect(signed[0].timeInForce).toBe(0);
    // 2.5 scaled by the 3 size decimals.
    expect(signed[0].baseAmount).toBe(2500);
    expect(order.orderId).toBe("11");
  });

  it("fills a MARKET request crossed above the mark (BUY)", async () => {
    const signed: Array<{
      price: number;
      isAsk: boolean;
      timeInForce?: number;
    }> = [];
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountActiveOrders": () => ({
          orders: [
            {
              order_id: "12",
              client_order_index: "12",
              status: "open",
              is_ask: false,
              price: "2525.51",
              initial_base_amount: "0.5",
            },
          ],
        }),
      },
      signerStub({
        createOrder: async (_credentials, request) => {
          signed.push({
            price: request.price,
            isAsk: request.isAsk,
            timeInForce: request.timeInForce,
          });
          return { txHash: "0xm", clientOrderIndex: request.clientOrderIndex };
        },
      })
    );

    await client.createOrder({
      symbol: "ETH",
      side: "BUY",
      orderType: "MARKET",
      orderQuantity: 0.5,
      clientOrderId: "12",
    });

    // mark 2500.5 × (1 + 1%) = 2525.505 → 252551 scaled.
    expect(signed).toHaveLength(1);
    expect(signed[0].price).toBe(252551);
    expect(signed[0].isAsk).toBe(false);
    expect(signed[0].timeInForce).toBe(0);
  });

  it("keeps LIMIT orders on the signer default (resting GTT)", async () => {
    let timeInForce: number | undefined = -1;
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountOrders": () => ({
          orders: [
            {
              order_id: "21",
              client_order_index: "21",
              status: "open",
              price: "2400",
              initial_base_amount: "0.01",
            },
          ],
        }),
      },
      signerStub({
        createOrder: async (_credentials, request) => {
          timeInForce = request.timeInForce;
          return { txHash: "0x1", clientOrderIndex: request.clientOrderIndex };
        },
      })
    );

    await client.createOrder({
      symbol: "ETH",
      side: "BUY",
      orderType: "LIMIT",
      orderPrice: 2400,
      orderQuantity: 0.01,
      clientOrderId: "21",
    });

    // Undefined lets the signer fall back to GTT — grid levels must rest.
    expect(timeInForce).toBeUndefined();
  });

  it("cancelOrder forwards the client index the venue accepts", async () => {
    // The contract hands cancel the handle `createOrder` returned. For this
    // venue the signer takes the client order index as `order_index` — the
    // venue's own `order_id` (5.6e14) is not accepted (live-verified in B5),
    // so sending it would leave `grid.stop()` with an orphan order.
    let sent: number | undefined;
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountOrders": () => ({
          orders: [
            {
              order_id: "562949945880386",
              client_order_index: "7",
              status: "canceled",
            },
          ],
        }),
      },
      signerStub({
        cancelOrder: async (_credentials, request) => {
          sent = request.orderIndex;
          return { txHash: "0xc", orderIndex: request.orderIndex };
        },
      })
    );
    await client.cancelOrder("7", "ETH");
    expect(sent).toBe(7);
  });

  // A flatten request carries no `clientOrderId`, so it takes the DERIVED
  // index path — the one live P4 broke (2^62 index refused by the venue).
  const VENUE_MAX_CLIENT_ORDER_INDEX = 281474976710655; // 2^48 - 1

  it("derives a flatten index inside the venue's accepted range", async () => {
    let index: number | undefined;
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        // Echo back whatever index the signer was handed: the poll that
        // follows the signature looks the order up by that same index.
        "/api/v1/accountActiveOrders": () => ({
          orders:
            index === undefined
              ? []
              : [
                  {
                    order_id: String(index),
                    client_order_index: String(index),
                    status: "open",
                    is_ask: true,
                    price: "2475.49",
                    initial_base_amount: "2.5",
                  },
                ],
        }),
      },
      signerStub({
        createOrder: async (_credentials, request) => {
          index = request.clientOrderIndex;
          return { txHash: "0xm", clientOrderIndex: request.clientOrderIndex };
        },
      })
    );

    const order = await client.createOrder({
      symbol: "ETH",
      side: "SELL",
      orderType: "MARKET",
      orderQuantity: 2.5,
    });

    // Live P4: a 2^62 index made the venue refuse the signed order
    // ("ClientOrderIndex should not be larger than 281474976710655") and
    // 400 the follow-up history query, so the panic flatten never cleared
    // exposure. The derived index must stay at or below the venue bound.
    expect(index).toBeDefined();
    expect(Number.isInteger(index)).toBe(true);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThanOrEqual(VENUE_MAX_CLIENT_ORDER_INDEX);
    expect(order.orderId).toBe(String(index));
  });

  it("surfaces the refusal cause even when the follow-up lookup also fails", async () => {
    // Live P4 sequence: the venue refused the flatten, then the history query
    // for that same index answered 400 — the adapter used to report only
    // "lighter unreachable after refusal", hiding the actionable reason.
    const refused =
      "ClientOrderIndex should not be larger than 281474976710655";
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountOrders": () => {
          throw httpError(400, {
            code: 20001,
            message: "invalid param : invalid client order index",
          });
        },
      },
      signerStub({
        createOrder: async () => {
          throw new SignerError(refused);
        },
      })
    );

    const error = (await client
      .createOrder({
        symbol: "ETH",
        side: "SELL",
        orderType: "MARKET",
        orderQuantity: 0.1,
      })
      .catch(reason => reason)) as CommandError;

    expect(error).toBeInstanceOf(CommandError);
    expect(error.message).toContain(`create refused (${refused})`);
    // The venue's own body rides along: status 400 alone reads as an outage.
    expect(error.message).toContain(
      "venue: 20001 invalid param : invalid client order index"
    );
    expect(error.retryable).toBe(true);
  });

  it("carries the venue's error body in a plain transport failure", async () => {
    const client = clientWith(
      {
        ...BASE_HANDLERS,
        "/api/v1/accountActiveOrders": () => {
          throw httpError(400, {
            code: 20001,
            message: "invalid param : invalid client order index",
          });
        },
      },
      signerStub()
    );

    const error = (await client
      .getOrder("42")
      .catch(reason => reason)) as CommandError;

    expect(error).toBeInstanceOf(CommandError);
    expect(error.message).toContain(
      "getOrder 42: lighter request failed (GET /api/v1/accountActiveOrders)"
    );
    expect(error.message).toContain(
      "venue: 20001 invalid param : invalid client order index"
    );
    // A malformed request is a business failure (no blind retry).
    expect(error.retryable).toBe(false);
  });
});
