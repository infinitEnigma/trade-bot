/** @format */

/**
 * B2 tests: `LighterSidecarSigner` against a local `node:http` stub.
 */

import * as http from "http";
import type { AddressInfo } from "net";
import {
  LighterSidecarSigner,
  lighterSidecarConfigFromEnv,
} from "../lighter-sidecar";
import {
  SignerCredentials,
  SignerError,
  SignerUnreachableError,
} from "../../../domain/signer";

type Handler = (
  req: http.IncomingMessage,
  body: string,
  headers: http.IncomingHttpHeaders,
  json: (status: number, payload: unknown) => void
) => void;

async function startStub(handler: Handler) {
  const requests: {
    url?: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ url: req.url, headers: req.headers, body });
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      handler(req, body, req.headers, json);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const CREDS: SignerCredentials = {
  accountIndex: 5,
  apiKeyIndex: 2,
  privateKey: "test-private-key-never-logged",
  env: "testnet",
};

describe("lighterSidecarConfigFromEnv", () => {
  it("throws a helpful error when LIGHTER_SIDECAR_URL is missing", () => {
    expect(() => lighterSidecarConfigFromEnv({})).toThrow(SignerError);
  });
});

describe("LighterSidecarSigner", () => {
  it("posts snake_case bodies with per-request credentials", async () => {
    const stub = await startStub((req, _body, _headers, json) => {
      if (req.url === "/v1/create-order") {
        return json(200, { ok: true, tx_hash: "0xabc", client_order_index: 7 });
      }
      return json(404, { ok: false });
    });
    try {
      const signer = new LighterSidecarSigner({ baseUrl: stub.baseUrl });
      const result = await signer.createOrder(CREDS, {
        marketIndex: 1,
        clientOrderIndex: 7,
        baseAmount: 100,
        price: 2500,
        isAsk: false,
      });
      expect(result).toEqual({ txHash: "0xabc", clientOrderIndex: 7 });
      const sent = JSON.parse(stub.requests[0].body);
      expect(sent).toMatchObject({
        account_index: 5,
        api_key_index: 2,
        private_key: "test-private-key-never-logged",
        env: "testnet",
        market_index: 1,
        client_order_index: 7,
        base_amount: 100,
        price: 2500,
        is_ask: false,
      });
    } finally {
      await stub.close();
    }
  });

  it("sends the bearer token when configured", async () => {
    const stub = await startStub((_req, _body, headers, json) =>
      json(200, { ok: true, token: "tok-123" })
    );
    try {
      const signer = new LighterSidecarSigner({
        baseUrl: stub.baseUrl,
        authToken: "secret",
      });
      await signer.authToken(CREDS);
      expect(stub.requests[0].headers.authorization).toBe("Bearer secret");
    } finally {
      await stub.close();
    }
  });

  it("maps {ok:false} to SignerError (business outcome, not unreachable)", async () => {
    const stub = await startStub((_req, _body, _headers, json) =>
      json(200, { ok: false, error: "bad nonce" })
    );
    try {
      const signer = new LighterSidecarSigner({ baseUrl: stub.baseUrl });
      await expect(
        signer.createOrder(CREDS, {
          marketIndex: 1,
          clientOrderIndex: 7,
          baseAmount: 100,
          price: 2500,
          isAsk: false,
        })
      ).rejects.toThrow(SignerError);
      await expect(
        signer.createOrder(CREDS, {
          marketIndex: 1,
          clientOrderIndex: 7,
          baseAmount: 100,
          price: 2500,
          isAsk: false,
        })
      ).rejects.not.toBeInstanceOf(SignerUnreachableError);
    } finally {
      await stub.close();
    }
  });

  it("maps 500 to SignerUnreachableError (freeze, never recreate)", async () => {
    const stub = await startStub((_req, _body, _headers, json) =>
      json(500, { detail: "boom" })
    );
    try {
      const signer = new LighterSidecarSigner({ baseUrl: stub.baseUrl });
      await expect(
        signer.cancelOrder(CREDS, { marketIndex: 1, orderIndex: 7 })
      ).rejects.toBeInstanceOf(SignerUnreachableError);
    } finally {
      await stub.close();
    }
  });

  it("isReachable returns false instead of throwing when down", async () => {
    const stub = await startStub(() => {
      // Never respond; use a short-timeout client so the test stays fast.
    });
    try {
      const signer = new LighterSidecarSigner({
        baseUrl: stub.baseUrl,
        timeoutMs: 100,
      });
      await expect(signer.isReachable()).resolves.toBe(false);
    } finally {
      await stub.close();
    }
  }, 10000);

  it("isReachable returns true on {status:ok}", async () => {
    const stub = await startStub((_req, _body, _headers, json) =>
      json(200, { status: "ok", service: "lighter-signer" })
    );
    try {
      const signer = new LighterSidecarSigner({ baseUrl: stub.baseUrl });
      await expect(signer.isReachable()).resolves.toBe(true);
    } finally {
      await stub.close();
    }
  });
});
