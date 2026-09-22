/**
 * Exchange client factory — dispatch is the discriminator, nothing else.
 *
 * `@noble/ed25519` (imported transitively via the kodiak client) is a
 * pure-ESM package Jest's CJS runtime cannot load — same mock as the wire
 * test; signing is irrelevant here, only dispatch is exercised.
 *
 * @format
 */

jest.mock("@noble/ed25519", () => ({
  signAsync: jest.fn(),
}));

import { isEngineCredentials } from "@trade-bot/shared";
import type { EngineCredentials } from "@trade-bot/shared";
import { createExchangeClient } from "../factory";
import { OrderlyClient } from "../kodiak/client";
import { CommandError } from "../../application/command-error";

const KODIAK: EngineCredentials = {
  exchange: "kodiak",
  environment: "testnet",
  accountRef: "0xabc",
  credentials: {
    accountId: "0xabc",
    accessKey: "key",
    secretKey: "secret",
  },
};

describe("createExchangeClient", () => {
  it("accepts the same kodiak envelope the backend issues (guard + factory agree)", () => {
    // Mirrors backend/tests/unit/controllers/bots.controller.test.ts: the
    // envelope `withCredentials` decrypts must survive the engine's own
    // validation and dispatch to the venue client.
    const issued = {
      exchange: "kodiak",
      environment: "testnet",
      accountRef: "test-value",
      credentials: {
        accountId: "test-value",
        accessKey: "test-value",
        secretKey: "test-value",
      },
    };

    expect(isEngineCredentials(issued)).toBe(true);
    if (isEngineCredentials(issued)) {
      expect(createExchangeClient(issued)).toBeInstanceOf(OrderlyClient);
    }
  });

  it.each([
    ["unknown exchange", { ...KODIAK, exchange: "binance" }],
    ["bad environment", { ...KODIAK, environment: "devnet" }],
    [
      "crossed payload (kodiak envelope, lighter creds)",
      {
        ...KODIAK,
        credentials: { accountIndex: 1, apiKeyIndex: 0, privateKey: "0x1" },
      },
    ],
    ["null", null],
  ])(
    "rejects a malformed envelope (%s) before it reaches exchange code",
    (_label, value) => {
      expect(isEngineCredentials(value)).toBe(false);
    }
  );

  it("returns an OrderlyClient for a kodiak envelope (testnet base URL)", () => {
    const client = createExchangeClient(KODIAK);

    expect(client).toBeInstanceOf(OrderlyClient);
    // The client must point at testnet for a testnet envelope — a mainnet
    // leak would route paper trades at real liquidity.
    expect(
      (client as unknown as { config: { baseUrl: string } }).config.baseUrl
    ).toBe("https://testnet-api.orderly.org");
  });

  it("returns an OrderlyClient for a kodiak envelope (mainnet base URL)", () => {
    const client = createExchangeClient({
      ...KODIAK,
      environment: "mainnet",
    });

    expect(client).toBeInstanceOf(OrderlyClient);
    expect(
      (client as unknown as { config: { baseUrl: string } }).config.baseUrl
    ).toBe("https://api.orderly.org");
  });

  it("fails cleanly (non-retryable COMMAND_FAILED) for a lighter envelope until workstream B", () => {
    const lighter: EngineCredentials = {
      exchange: "lighter",
      environment: "testnet",
      accountRef: "42",
      credentials: {
        accountIndex: 42,
        apiKeyIndex: 0,
        privateKey: "0xdeadbeef",
      },
    };

    let thrown: unknown;
    try {
      createExchangeClient(lighter);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandError);
    const err = thrown as CommandError;
    expect(err.retryable).toBe(false);
    // The BotManager path publishes COMMAND_FAILED and moves the bot to
    // ERROR for non-retryable CommandErrors — never an unhandled throw.
    expect(err.message).toMatch(/UNSUPPORTED_EXCHANGE/);
  });
});
