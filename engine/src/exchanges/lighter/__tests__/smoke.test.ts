/** @format */
/**
 * B5 testnet smoke — env-gated, skips without credentials.
 *
 * Drives the engine's own LighterClient through the Phase-0 flow:
 * market resolve -> resting LIMIT far from mark -> query by client
 * index -> polling-confirmed cancel. Uses a unique client index per
 * run and always cancels in finally so no order is left resting.
 */
import dotenv from "dotenv";
import * as path from "path";
import { LighterClient } from "../client";
import {
  LighterSidecarSigner,
  lighterSidecarConfigFromEnv,
} from "../../../infrastructure/signer/lighter-sidecar";

dotenv.config({ path: path.resolve(__dirname, "../../../../../.env") });

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function smokeConfig() {
  const accountIndex = Number(env("LIGHTER_ACCOUNT_INDEX"));
  const apiKeyIndex = Number(env("LIGHTER_API_KEY_INDEX"));
  const privateKey = env("LIGHTER_PRIVATE_KEY");
  const sidecarUrl = env("LIGHTER_SIDECAR_URL");
  if (
    !Number.isInteger(accountIndex) ||
    !Number.isInteger(apiKeyIndex) ||
    !privateKey ||
    !sidecarUrl
  ) {
    return null;
  }
  const environment = env("LIGHTER_ENV") === "mainnet" ? "mainnet" : "testnet";
  const baseUrl =
    environment === "mainnet"
      ? "https://mainnet.zklighter.elliot.ai"
      : "https://testnet.zklighter.elliot.ai";
  return {
    baseUrl,
    environment: environment as "testnet" | "mainnet",
    credentials: {
      accountIndex,
      apiKeyIndex,
      privateKey,
      env: environment as "testnet" | "mainnet",
    },
    symbol: env("LIGHTER_MARKET_SYMBOL") || "ETH",
  };
}

const cfg = smokeConfig();
const describeSmoke = cfg ? describe : describe.skip;

describeSmoke("B5 Lighter testnet smoke (engine client)", () => {
  it("places a resting limit, queries it by client index, cancels with confirmation", async () => {
    if (!cfg) throw new Error("skipped: no Lighter credentials");
    const signer = new LighterSidecarSigner(lighterSidecarConfigFromEnv());
    expect(await signer.isReachable()).toBe(true);
    const client = new LighterClient({
      baseUrl: cfg.baseUrl,
      credentials: cfg.credentials,
      signer,
    });
    const ticker = await client.getTicker(cfg.symbol);
    const mark = Number(ticker.mark_price ?? ticker.price);
    expect(Number.isFinite(mark) && mark > 0).toBe(true);
    // Probe-style small index (time-based, like the Python probe's
    // 800_000_000_000 + epoch): keeps the wire index exactly the placed
    // index without relying on >2^53 precision paths.
    const index = 800_000_000_000 + (Date.now() % 1_000_000_000);
    const price = mark * 0.5;
    const placed = await client.createOrder({
      symbol: cfg.symbol,
      side: "BUY",
      orderType: "LIMIT",
      orderPrice: price,
      orderQuantity: 0.01,
      clientOrderId: String(index),
    });
    try {
      expect(placed.orderId).toBeTruthy();
      // The handle handed back is the placed client index itself — the value
      // a grid slot stores and the only id cancel/getOrder accept here.
      expect(placed.orderId).toBe(String(index));
      const lookup = await client.queryOrderByClientOrderId(
        cfg.symbol,
        String(index)
      );
      expect(["FOUND_OPEN", "FOUND_FILLED"]).toContain(lookup.kind);
      // Poll through the same handle the grid's checkOrders() uses.
      const polled = await client.getOrder(placed.orderId);
      expect(polled.orderId).toBe(String(index));
      expect(polled.status).toBe("OPEN");
    } finally {
      // Cancel through `placed.orderId` — the exact path grid.stop() takes.
      const canceled = await client.cancelOrder(placed.orderId, cfg.symbol);
      expect(canceled.status).toBe("CANCELLED");
    }
  }, 120000);
});
