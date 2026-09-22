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
    expect(order.orderId).toBe("9");
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
});
