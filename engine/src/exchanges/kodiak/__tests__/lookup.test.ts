/** @format */

/**
 * B1 contract tests: `listOpenOrders` / `queryOrderByClientOrderId` on the
 * Kodiak reference implementation, plus the HTTP-timeout bound.
 *
 * The exchange is a local `node:http` stub (zero new dependencies), styled
 * after `client.wire.test.ts`.
 */

import * as http from "http";
import * as crypto from "crypto";
import type { AddressInfo } from "net";
import { OrderlyClient } from "../client";
import { DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS } from "../../../domain/exchange";

jest.mock("@noble/ed25519", () => {
  const nodeCrypto = jest.requireActual("crypto") as typeof import("crypto");
  const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
  const toPkcs8 = (seed: Uint8Array) =>
    Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]);
  return {
    signAsync: async (message: Uint8Array, privateKeyBytes: Uint8Array) =>
      new Uint8Array(
        nodeCrypto.sign(
          null,
          Buffer.from(message),
          nodeCrypto.createPrivateKey({
            key: toPkcs8(privateKeyBytes),
            format: "der",
            type: "pkcs8",
          })
        )
      ),
  };
});

const PRIVATE_KEY_B64 = crypto
  .createHash("sha256")
  .update("lookup-test-seed")
  .digest()
  .toString("base64");

type Handler = (
  req: http.IncomingMessage,
  body: string,
  json: (status: number, payload: unknown) => void
) => void;

async function startStub(handler: Handler) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      handler(req, Buffer.concat(chunks).toString("utf8"), json);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

function makeClient(baseUrl: string, timeoutMs?: number) {
  return new OrderlyClient({
    accountId: "account-id",
    orderlyKey: "orderly-key",
    orderlySecret: PRIVATE_KEY_B64,
    baseUrl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

const ROW = {
  order_id: 777,
  client_order_id: "bot1-00-B",
  symbol: "PERP_ETH_USDC",
  status: "NEW",
  side: "BUY",
  order_price: 100,
  order_quantity: 1,
};

describe("OrderlyClient.listOpenOrders", () => {
  it("maps GET /v1/orders rows onto the shared open-order shape", async () => {
    const stub = await startStub((req, _body, json) => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && path === "/v1/orders") {
        return json(200, { success: true, data: { rows: [ROW] } });
      }
      return json(404, { success: false });
    });
    try {
      const orders = await makeClient(stub.baseUrl).listOpenOrders(
        "PERP_ETH_USDC"
      );
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({
        orderId: "777",
        clientOrderId: "bot1-00-B",
        symbol: "PERP_ETH_USDC",
        status: "NEW",
        side: "BUY",
      });
    } finally {
      await stub.close();
    }
  });
});

describe("OrderlyClient.queryOrderByClientOrderId", () => {
  it("returns FOUND_OPEN when a listed row carries the id", async () => {
    const stub = await startStub((req, _body, json) => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && path === "/v1/orders") {
        return json(200, { success: true, data: { rows: [ROW] } });
      }
      return json(404, { success: false });
    });
    try {
      const lookup = await makeClient(stub.baseUrl).queryOrderByClientOrderId(
        "PERP_ETH_USDC",
        "bot1-00-B"
      );
      expect(lookup.kind).toBe("FOUND_OPEN");
      if (lookup.kind === "FOUND_OPEN") {
        expect(lookup.order.orderId).toBe("777");
      }
    } finally {
      await stub.close();
    }
  });

  it("returns NOT_FOUND (never null) when no row matches", async () => {
    const stub = await startStub((req, _body, json) => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && path === "/v1/orders") {
        return json(200, { success: true, data: { rows: [ROW] } });
      }
      return json(404, { success: false });
    });
    try {
      const lookup = await makeClient(stub.baseUrl).queryOrderByClientOrderId(
        "PERP_ETH_USDC",
        "bot1-ff-S"
      );
      expect(lookup).toEqual({ kind: "NOT_FOUND" });
    } finally {
      await stub.close();
    }
  });

  it("returns UNREACHABLE on a 500 instead of throwing", async () => {
    const stub = await startStub((_req, _body, json) =>
      json(500, { success: false, message: "boom" })
    );
    try {
      const lookup = await makeClient(stub.baseUrl).queryOrderByClientOrderId(
        "PERP_ETH_USDC",
        "bot1-00-B"
      );
      expect(lookup.kind).toBe("UNREACHABLE");
      if (lookup.kind === "UNREACHABLE") {
        expect(lookup.reason).toMatch(/500/);
      }
    } finally {
      await stub.close();
    }
  });

  it("returns UNREACHABLE on timeout instead of hanging", async () => {
    const stub = await startStub(() => {
      // Never respond — the client's timeout must fire.
    });
    try {
      const lookup = await makeClient(
        stub.baseUrl,
        100
      ).queryOrderByClientOrderId("PERP_ETH_USDC", "bot1-00-B");
      expect(lookup.kind).toBe("UNREACHABLE");
      if (lookup.kind === "UNREACHABLE") {
        expect(lookup.reason).toMatch(/timed out/);
      }
    } finally {
      await stub.close();
    }
  }, 10000);
});

describe("OrderlyClient timeout bound", () => {
  it("defaults every request to the shared exchange timeout", async () => {
    const stub = await startStub((_req, _body, json) =>
      json(200, { success: true, data: { rows: [] } })
    );
    try {
      const client = makeClient(stub.baseUrl);
      const axiosInstance = (
        client as unknown as { client: { defaults: { timeout?: number } } }
      ).client;
      expect(axiosInstance.defaults.timeout).toBe(
        DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS
      );
    } finally {
      await stub.close();
    }
  });
});

describe("OrderlyClient.cancelOrder confirmation", () => {
  it("polls until the exchange confirms CANCELLED", async () => {
    let orderGets = 0;
    const stub = await startStub((req, _body, json) => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "DELETE" && path === "/v1/order") {
        return json(200, { success: true, data: { status: "CANCELLING" } });
      }
      if (req.method === "GET" && path === "/v1/order/777") {
        orderGets += 1;
        if (orderGets < 2) {
          return json(200, {
            success: true,
            data: { order_id: 777, status: "CANCELLING" },
          });
        }
        return json(200, {
          success: true,
          data: { order_id: 777, status: "CANCELLED" },
        });
      }
      return json(404, { success: false });
    });
    try {
      const result = await makeClient(stub.baseUrl).cancelOrder(
        "777",
        "PERP_ETH_USDC"
      );
      expect(result).toEqual({ status: "CANCELLED" });
      expect(orderGets).toBeGreaterThanOrEqual(2);
    } finally {
      await stub.close();
    }
  });
});
