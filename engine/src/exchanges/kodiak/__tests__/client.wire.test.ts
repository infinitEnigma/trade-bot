/**
 * Wire-contract tests (ledger 0): the OrderlyClient must POST the documented
 * snake_case create-order body, must sign exactly the serialized body it
 * sends, and must surface the exchange's duplicate `client_order_id`
 * rejection so the strategy's reconcile path can run.
 *
 * The exchange is a local `node:http` server standing in for the Orderly REST
 * API — zero new test dependencies. The private key is generated in-process
 * so the Ed25519 signature over the request can be verified byte-for-byte.
 *
 * Recorded wire-contract facts (orderly.network docs, "Create order" /
 * "Get orders", verified 2026-09-21):
 * - request body: { symbol, order_type, side, order_price, order_quantity,
 *   client_order_id } (snake_case)
 * - client_order_id: 36 length, accepts hyphen but cannot be the first
 *   character
 * - order status vocabulary: NEW / CANCELLED / PARTIAL_FILLED / FILLED /
 *   REJECTED / INCOMPLETE / COMPLETED
 * - create response data: order_id (numeric), client_order_id, order_type,
 *   order_price, order_quantity, error_message
 */

import * as http from "http";
import * as crypto from "crypto";
import type { AddressInfo } from "net";
import { OrderlyClient } from "../client";
import { OrderRequest } from "../../../types/strategy";
import { ClientOrderIdGenerator } from "../../../utils/client-order-id";

/**
 * Replace @noble/ed25519's signing primitive with node:crypto's Ed25519
 * (both are RFC 8032; signatures are interchangeable).
 *
 * Why: @noble/ed25519 v3 is a pure-ESM package that Jest's CJS runtime cannot
 * require, and no engine test had ever loaded it at runtime (the strategy
 * uses OrderlyClient as a type only, so TypeScript elides the import). This
 * mock keeps the wire test on the real client code — key decode/pad, message
 * assembly, hashing and headers — while swapping only the final Ed25519
 * primitive. The production signature path against the real exchange is
 * verified live by the Lighter/Orderly probes (Phase 0/1), not here.
 *
 * The mock must be self-contained (jest hoists factories), so node:crypto is
 * required inside it.
 */
jest.mock("@noble/ed25519", () => {
  const nodeCrypto = jest.requireActual("crypto") as typeof import("crypto");
  // PKCS#8 DER prefix for a 32-byte Ed25519 seed.
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

type RecordedRequest = {
  method: string;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type ScriptedResponse = { status: number; body: unknown };

async function startOrderlyStub(scripted: ScriptedResponse[] = []) {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method ?? "",
        url: req.url,
        headers: req.headers,
        body,
      });
      const path = (req.url ?? "").split("?")[0];
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (req.method === "GET" && path === "/v1/client/info") {
        return json(200, {
          success: true,
          data: { total_value: 1_000_000, max_leverage: 20 },
        });
      }
      if (req.method === "GET" && path === "/v1/positions") {
        return json(200, { success: true, data: { rows: [] } });
      }
      if (req.method === "GET" && path === "/v1/public/ticker") {
        return json(200, {
          success: true,
          data: { symbol: "PERP_BTC_USDC", price: 100 },
        });
      }
      if (req.method === "POST" && path === "/v1/order") {
        const next = scripted.shift();
        if (next) return json(next.status, next.body);
        return json(200, {
          success: true,
          data: {
            order_id: 12345,
            client_order_id: JSON.parse(body || "{}").client_order_id,
            order_type: "LIMIT",
            order_price: 100,
            order_quantity: 1,
            error_message: "none",
          },
        });
      }
      return json(404, {
        success: false,
        message: `unexpected ${req.method} ${req.url}`,
      });
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

// Deterministic in-test signing key (32 bytes = Ed25519 seed).
const PRIVATE_KEY = crypto
  .createHash("sha256")
  .update("wire-test-seed")
  .digest();
const PRIVATE_KEY_B64 = PRIVATE_KEY.toString("base64");
// PKCS#8 DER prefix for a 32-byte Ed25519 seed, used only to import the key
// into node:crypto for verification.
const ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex"
);
const PUBLIC_KEY = crypto.createPublicKey(
  crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, PRIVATE_KEY]),
    format: "der",
    type: "pkcs8",
  })
);

function makeRequest(clientOrderId: string): OrderRequest {
  return {
    symbol: "PERP_BTC_USDC",
    orderType: "LIMIT",
    side: "BUY",
    orderPrice: 100,
    orderQuantity: 1,
    clientOrderId,
  };
}

/** First recorded POST /v1/order (fails the test if none was made). */
function findOrderPost(requests: RecordedRequest[]): RecordedRequest {
  const posted = requests.find(
    r => r.method === "POST" && (r.url ?? "").split("?")[0] === "/v1/order"
  );
  if (!posted) throw new Error("no POST /v1/order was recorded");
  return posted;
}

/** All recorded POST /v1/order requests. */
function filterOrderPosts(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter(
    r => r.method === "POST" && (r.url ?? "").split("?")[0] === "/v1/order"
  );
}

describe("OrderlyClient wire contract", () => {
  it("POSTs the documented snake_case body to /v1/order", async () => {
    const stub = await startOrderlyStub();
    try {
      const client = new OrderlyClient({
        accountId: "account-id",
        orderlyKey: "orderly-key",
        orderlySecret: PRIVATE_KEY_B64,
        baseUrl: stub.baseUrl,
      });

      const clientOrderId = new ClientOrderIdGenerator(
        "8f14e45f-ceea-467f-abf5-ee02d76df6b2"
      ).generate(0, "BUY");
      const response = await client.createOrder(makeRequest(clientOrderId));

      expect(response.orderId).toBe("12345");

      const posted = findOrderPost(stub.requests);

      const body = JSON.parse(posted.body);
      // Exact wire keys — camelCase remnants (orderType, orderPrice,
      // orderQuantity, clientOrderId) must never reach the exchange.
      expect(Object.keys(body).sort()).toEqual(
        [
          "symbol",
          "order_type",
          "side",
          "order_price",
          "order_quantity",
          "client_order_id",
        ].sort()
      );
      expect(body).toEqual({
        symbol: "PERP_BTC_USDC",
        order_type: "LIMIT",
        side: "BUY",
        order_price: 100,
        order_quantity: 1,
        client_order_id: clientOrderId,
      });
      expect(posted.body).not.toContain('"orderType"');
      expect(posted.body).not.toContain('"clientOrderId"');

      // The id must satisfy the exchange's documented constraints.
      expect(clientOrderId.length).toBeLessThanOrEqual(36);
      expect(clientOrderId).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
    } finally {
      await stub.close();
    }
  });

  it("signs exactly the serialized body it sends", async () => {
    const stub = await startOrderlyStub();
    try {
      const client = new OrderlyClient({
        accountId: "account-id",
        orderlyKey: "orderly-key",
        orderlySecret: PRIVATE_KEY_B64,
        baseUrl: stub.baseUrl,
      });

      const clientOrderId = new ClientOrderIdGenerator("bot-1").generate(
        0,
        "BUY"
      );
      await client.createOrder(makeRequest(clientOrderId));

      const posted = findOrderPost(stub.requests);

      const timestamp = posted.headers["orderly-timestamp"] as string;
      const signatureHeader = posted.headers["orderly-signature"] as string;
      expect(timestamp).toBeTruthy();
      expect(signatureHeader).toBeTruthy();

      // Reconstruct the signed message: {timestamp}{method}{path}{body} and
      // verify with node:crypto's Ed25519 — an implementation independent of
      // the @noble/ed25519 the client signs with. Byte-for-byte: the signed
      // string must be the exact body that reached the wire.
      const message = `${timestamp}POST/v1/order${posted.body}`;
      const messageHash = crypto.createHash("sha256").update(message).digest();
      const signature = Buffer.from(signatureHeader, "base64url");
      expect(crypto.verify(null, messageHash, PUBLIC_KEY, signature)).toBe(
        true
      );
      // Sanity: an altered body must not verify.
      const tampered = `${timestamp}POST/v1/order${posted.body} `;
      expect(
        crypto.verify(
          null,
          crypto.createHash("sha256").update(tampered).digest(),
          PUBLIC_KEY,
          signature
        )
      ).toBe(false);
    } finally {
      await stub.close();
    }
  });
});

describe("OrderlyClient duplicate client_order_id rejection", () => {
  it("propagates the exchange's duplicate-key rejection (same id on both posts)", async () => {
    // The exact rejection body/status must still be recorded from the live
    // testnet (ledger 0's probe step); the wire-level shape used here is the
    // documented error envelope { success: false, code, message }.
    const stub = await startOrderlyStub([
      { status: 200, body: { success: true, data: { order_id: 1 } } },
      {
        status: 400,
        body: {
          success: false,
          code: -1013,
          message: "client_order_id duplicated",
        },
      },
    ]);
    try {
      const client = new OrderlyClient({
        accountId: "account-id",
        orderlyKey: "orderly-key",
        orderlySecret: PRIVATE_KEY_B64,
        baseUrl: stub.baseUrl,
      });

      // Same deterministic key on both submissions — the exchange must be
      // able to reject the second one.
      const request = makeRequest(
        new ClientOrderIdGenerator("bot-1").generate(0, "BUY")
      );
      await client.createOrder(request);
      await expect(client.createOrder(request)).rejects.toMatchObject({
        response: {
          status: 400,
          data: { success: false, code: -1013 },
        },
      });

      const posts = filterOrderPosts(stub.requests);
      expect(posts).toHaveLength(2);
      const firstId = JSON.parse(posts[0].body).client_order_id;
      const secondId = JSON.parse(posts[1].body).client_order_id;
      expect(firstId).toBe(secondId);
      expect(secondId.length).toBeLessThanOrEqual(36);
    } finally {
      await stub.close();
    }
  });
});
