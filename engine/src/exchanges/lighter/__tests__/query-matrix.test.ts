/** @format */
/**
 * B5 LighterClient query mapping — stubbed REST, no network.
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
  privateKey: "t",
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
function signer(): TransactionSigner {
  return {
    createOrder: async () => ({ txHash: "0x1", clientOrderIndex: 1 }),
    cancelOrder: async () => ({ txHash: "0xc", orderIndex: 1 }),
    authToken: async () => "token",
    isReachable: async () => true,
  };
}
function rest(
  handlers: Record<string, (p?: unknown) => unknown>,
  failures: Record<string, () => never> = {}
) {
  const instance = axios.create();
  instance.get = (async (u: string, o?: { params?: unknown }) => {
    const fail = failures[u];
    if (fail) return fail();
    const h = handlers[u];
    if (!h) throw new Error(`no stub for ${u}`);
    return { data: h(o?.params) };
  }) as typeof instance.get;
  return instance;
}
function queryClient(
  orders: (p?: unknown) => unknown,
  failures: Record<string, () => never> = {}
) {
  return new LighterClient({
    baseUrl: "http://stub",
    credentials: CREDS,
    signer: signer(),
    rest: rest(
      {
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({ orders: [] }),
        "/api/v1/accountOrders": orders,
      },
      failures
    ),
  });
}
describe("B5 query mapping", () => {
  it("partially_filled is FOUND_OPEN (live)", async () => {
    const c = queryClient(() => ({
      orders: [
        { order_id: "3", client_order_index: "3", status: "partially_filled" },
      ],
    }));
    expect((await c.queryOrderByClientOrderId("ETH", "3")).kind).toBe(
      "FOUND_OPEN"
    );
  });
  it("filled and canceled map to terminal kinds", async () => {
    const f = queryClient(() => ({
      orders: [{ order_id: "4", client_order_index: "4", status: "filled" }],
    }));
    expect((await f.queryOrderByClientOrderId("ETH", "4")).kind).toBe(
      "FOUND_FILLED"
    );
    const x = queryClient(() => ({
      orders: [{ order_id: "5", client_order_index: "5", status: "canceled" }],
    }));
    expect((await x.queryOrderByClientOrderId("ETH", "5")).kind).toBe(
      "FOUND_CANCELED"
    );
  });
  it("empty listings are NOT_FOUND", async () => {
    const c = queryClient(() => ({ orders: [] }));
    await expect(c.queryOrderByClientOrderId("ETH", "unused")).resolves.toEqual(
      { kind: "NOT_FOUND" }
    );
  });
  it("500 maps to UNREACHABLE", async () => {
    const boom = (): never => {
      throw new Error("responded 500");
    };
    const c = queryClient(() => ({ orders: [] }), {
      "/api/v1/accountOrders": boom,
      "/api/v1/accountActiveOrders": boom,
    });
    expect((await c.queryOrderByClientOrderId("ETH", "7")).kind).toBe(
      "UNREACHABLE"
    );
  });
  it("timeout maps to UNREACHABLE", async () => {
    const t = (): never => {
      throw new Error("timed out");
    };
    const c = queryClient(() => ({ orders: [] }), {
      "/api/v1/accountOrders": t,
      "/api/v1/accountActiveOrders": t,
    });
    expect((await c.queryOrderByClientOrderId("ETH", "7")).kind).toBe(
      "UNREACHABLE"
    );
  });
  it("sidecar downtime at create is retryable", async () => {
    const down: TransactionSigner = {
      ...signer(),
      createOrder: async () => {
        throw new SignerUnreachableError("down");
      },
    };
    const c = new LighterClient({
      baseUrl: "http://stub",
      credentials: CREDS,
      signer: down,
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({ orders: [] }),
        "/api/v1/accountOrders": () => ({ orders: [] }),
      }),
    });
    const err: unknown = await c
      .createOrder({
        symbol: "ETH",
        side: "BUY",
        orderType: "LIMIT",
        orderPrice: 2400,
        orderQuantity: 0.01,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).retryable).toBe(true);
  });
  it("duplicate index refusal adopts the live order", async () => {
    const dup: TransactionSigner = {
      ...signer(),
      createOrder: async () => {
        throw new SignerError("duplicate");
      },
    };
    const c = new LighterClient({
      baseUrl: "http://stub",
      credentials: CREDS,
      signer: dup,
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({ orders: [] }),
        "/api/v1/accountOrders": () => ({
          orders: [{ order_id: "9", client_order_index: "42", status: "open" }],
        }),
      }),
    });
    const order = await c.createOrder({
      symbol: "ETH",
      side: "BUY",
      orderType: "LIMIT",
      orderPrice: 2400,
      orderQuantity: 0.01,
      clientOrderId: "42",
    });
    // Handle = client order index (see `orderHandle`): usable with cancel
    // and getOrder, unlike the venue's own `order_id`.
    expect(order.orderId).toBe("42");
  });

  it("prefers the OPEN row over a stale FILLED ancestor of the same index", async () => {
    // Live B5 finding: one client index can carry several history rows (the
    // venue re-uses an index after a fill) and the listing order is not a
    // relevance order — a FILLED ancestor listed first must not mask the
    // live order (the grid would otherwise book a phantom fill).
    const c = queryClient(() => ({
      orders: [
        {
          order_id: "562949945880399",
          client_order_index: "42",
          status: "filled",
          price: "2756.14",
          transaction_time: 1790116529908440,
        },
        {
          order_id: "562949945880386",
          client_order_index: "42",
          status: "open",
          price: "1375.32",
          transaction_time: 1790116532908673,
        },
      ],
    }));
    expect((await c.queryOrderByClientOrderId("ETH", "42")).kind).toBe(
      "FOUND_OPEN"
    );
  });

  it("lets the active listing overrule a stale terminal history row", async () => {
    // Live B5 finding: history can still read `canceled` for an index that is
    // live again (the venue re-uses the index), so liveness is answered by
    // `accountActiveOrders` — never by the history query.
    const c = new LighterClient({
      baseUrl: "http://stub",
      credentials: CREDS,
      signer: signer(),
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({
          orders: [
            { order_id: "91", client_order_index: "42", status: "open" },
          ],
        }),
        "/api/v1/accountOrders": () => ({
          orders: [
            { order_id: "90", client_order_index: "42", status: "canceled" },
          ],
        }),
      }),
    });
    expect((await c.queryOrderByClientOrderId("ETH", "42")).kind).toBe(
      "FOUND_OPEN"
    );
  });

  it("exposes human units and the client-index handle from listings", async () => {
    // Live B5 finding: rows carry human-unit strings (`price` "1375.32",
    // `initial_base_amount` "0.0100") while `base_price` (137532) is the
    // scaled wire integer. Dividing the human fields by 10**decimals (the
    // previous mapping) reported 13.75 / 0.000001 — 100x/10000x wrong.
    const c = new LighterClient({
      baseUrl: "http://stub",
      credentials: CREDS,
      signer: signer(),
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({
          orders: [
            {
              order_id: "562949945880386",
              client_order_index: "42",
              market_index: 1,
              status: "open",
              is_ask: false,
              price: "1375.32",
              base_price: 137532,
              initial_base_amount: "0.0100",
              remaining_base_amount: "0.0100",
            },
          ],
        }),
      }),
    });
    const orders = await c.listOpenOrders("ETH");
    expect(orders).toHaveLength(1);
    const order = orders[0];
    expect(order.orderId).toBe("42"); // handle cancel/getOrder accept
    expect(order.venueOrderId).toBe("562949945880386");
    expect(order.price).toBe(1375.32);
    expect(order.quantity).toBe(0.01);
    expect(order.status).toBe("OPEN");
    expect(order.side).toBe("BUY");
  });

  it("getOrder polls by handle and speaks contract vocabulary", async () => {
    const base = {
      baseUrl: "http://stub",
      credentials: CREDS,
      signer: signer(),
    };
    const live = new LighterClient({
      ...base,
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({
          orders: [
            {
              order_id: "9",
              client_order_index: "42",
              status: "open",
              price: "1375.32",
            },
          ],
        }),
        "/api/v1/accountOrders": () => ({ orders: [] }),
      }),
    });
    await expect(live.getOrder("42")).resolves.toMatchObject({
      orderId: "42",
      status: "OPEN",
    });

    const filled = new LighterClient({
      ...base,
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({ orders: [] }),
        "/api/v1/accountOrders": () => ({
          orders: [
            {
              order_id: "9",
              client_order_index: "42",
              status: "filled",
              price: "2756.14",
              filled_base_amount: "0.0100",
            },
          ],
        }),
      }),
    });
    await expect(filled.getOrder("42")).resolves.toMatchObject({
      status: "FILLED",
      executedQuantity: 0.01,
    });

    const absent = new LighterClient({
      ...base,
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({ orders: [] }),
        "/api/v1/accountOrders": () => ({ orders: [] }),
      }),
    });
    const missing: unknown = await absent
      .getOrder("42")
      .catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(CommandError);
    expect((missing as CommandError).retryable).toBe(false); // definitively absent
    const malformed: unknown = await absent
      .getOrder("562949945880386-not-an-index")
      .catch((e: unknown) => e);
    expect(malformed).toBeInstanceOf(CommandError); // never silently hashed
  });

  it("looks a contract client order id up under the index it was placed with", async () => {
    // L23: the grid only knows its deterministic contract id
    // (`<botKey>-<levelIndex>-<side>`), while the venue indexes orders by
    // number. The query must therefore derive the same index `createOrder`
    // placed the order under; forwarding the contract id itself made the
    // venue answer 400 (`accountOrders?client_order_indexes=<contract id>`),
    // which the client reports as UNREACHABLE — every slot froze and the bot
    // never reached RUNNING.
    const contractId = "3da8db5ad3e05e38ed3b8ec191bd78-03-B";
    const placed: number[] = [];
    const asked: Record<string, unknown>[] = [];
    const params = (p?: unknown) => (p ?? {}) as Record<string, unknown>;
    const echo = new LighterClient({
      baseUrl: "http://stub",
      credentials: CREDS,
      signer: {
        ...signer(),
        createOrder: async (_credentials, request) => {
          placed.push(request.clientOrderIndex);
          return { txHash: "0x1", clientOrderIndex: request.clientOrderIndex };
        },
      },
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": p => {
          asked.push(params(p));
          return { orders: [] };
        },
        // Echo the index we were asked for, exactly as the venue does for a
        // live order: a client that asked with the contract id would get the
        // contract id back and find nothing.
        "/api/v1/accountOrders": p => {
          asked.push(params(p));
          return {
            orders: [
              {
                order_id: "562949945880386",
                client_order_index: params(p).client_order_indexes,
                status: "open",
              },
            ],
          };
        },
      }),
    });

    const placedOrder = await echo.createOrder({
      symbol: "ETH",
      side: "BUY",
      orderType: "LIMIT",
      orderPrice: 2500,
      orderQuantity: 0.01,
      clientOrderId: contractId,
    });
    const lookup = await echo.queryOrderByClientOrderId("ETH", contractId);

    expect(placed).toHaveLength(1);
    // The venue was asked by number, never by the contract id…
    expect(String(asked[asked.length - 1].client_order_indexes)).toMatch(
      /^\d+$/
    );
    expect(lookup).toMatchObject({ kind: "FOUND_OPEN" });
    // …and it is the same number the order was placed under.
    expect(placedOrder.orderId).toBe(String(placed[0]));
    if (lookup.kind === "FOUND_OPEN") {
      expect(lookup.order.orderId).toBe(String(placed[0]));
    }
  });

  it("forwards a numeric handle verbatim (no re-hash)", async () => {
    // The adapter's own callers (createOrder's confirmation poll,
    // cancelOrder's confirmation, adoptAfterRefusal) pass the index as a
    // numeric handle; the derivation must leave those untouched.
    const asked: Record<string, unknown>[] = [];
    const c = new LighterClient({
      baseUrl: "http://stub",
      credentials: CREDS,
      signer: signer(),
      rest: rest({
        "/api/v1/orderBooks": () => BOOKS,
        "/api/v1/orderBookDetails": () => DETAILS,
        "/api/v1/accountActiveOrders": () => ({ orders: [] }),
        "/api/v1/accountOrders": p => {
          asked.push((p ?? {}) as Record<string, unknown>);
          return {
            orders: [
              { order_id: "9", client_order_index: "42", status: "open" },
            ],
          };
        },
      }),
    });
    expect((await c.queryOrderByClientOrderId("ETH", "42")).kind).toBe(
      "FOUND_OPEN"
    );
    expect(asked[0].client_order_indexes).toBe("42");
  });
});
