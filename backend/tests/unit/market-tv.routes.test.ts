/** @format */

/**
 * X3: `/api/market/tv/history` venue dispatch.
 *
 * Contract pinned here:
 * - no venue params → the Kodiak reader exactly as before (zero behaviour
 *   change for PriceChart/Dashboard/analytics), un-prefixed cache key;
 * - `exchange=lighter&environment=…` → the Lighter candles reader with a
 *   `tv:history:lighter:{env}:…` cache key;
 * - an explicit `exchange=kodiak` stays on the Kodiak reader (environment
 *   is informational for Kodiak);
 * - partial/unknown venue params → 400 with the `/venue-symbols` wording,
 *   neither reader called;
 * - a reader failure → 400 with its error (same as the pre-X3 failure path);
 * - a cached window short-circuits before any reader.
 */

import request from "supertest";
import express, { Express } from "express";

jest.mock("../../src/infrastructure/security/rate-limiter.service", () => ({
  RateLimiters: {
    market: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  },
}));

jest.mock("../../src/config/cache.config", () => ({
  getCacheConfig: jest.fn(() => ({ MARKET_TRADINGVIEW_CONFIG: 60 })),
  getFullCacheConfig: jest.fn(() => ({ MARKET_KLINES_SHORT: 60 })),
}));

jest.mock("../../src/interfaces/http/trading/market-cache", () => ({
  readCache: jest.fn().mockResolvedValue(null),
  writeCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock(
  "../../src/infrastructure/external/kodiak-integration.service",
  () => ({
    kodiakIntegrationService: {
      getTradingViewHistory: jest.fn(),
      getTradingViewConfig: jest.fn(),
      getTradingViewSymbols: jest.fn(),
    },
  })
);

jest.mock("../../src/infrastructure/external/lighter/market-data", () => ({
  getLighterCandles: jest.fn(),
}));

import { tvRoutes } from "../../src/interfaces/http/trading/market-tv.routes";
import {
  readCache,
  writeCache,
} from "../../src/interfaces/http/trading/market-cache";
import { kodiakIntegrationService } from "../../src/infrastructure/external/kodiak-integration.service";
import { getLighterCandles } from "../../src/infrastructure/external/lighter/market-data";

const kodiakHistoryMock =
  kodiakIntegrationService.getTradingViewHistory as jest.Mock;
const lighterCandlesMock = getLighterCandles as jest.Mock;
const readCacheMock = readCache as jest.Mock;
const writeCacheMock = writeCache as jest.Mock;

const HISTORY = {
  s: "ok",
  t: [1791500000],
  o: [1],
  h: [2],
  l: [0.5],
  c: [1.5],
  v: [10],
};
const WINDOW =
  "symbol=PERP_BTC_USDC&resolution=60&from=1791500000&to=1791503600";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/market", tvRoutes);
  return app;
}

describe("market tv-history venue dispatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readCacheMock.mockResolvedValue(null);
    kodiakHistoryMock.mockResolvedValue({ success: true, data: HISTORY });
    lighterCandlesMock.mockResolvedValue({ success: true, data: HISTORY });
  });

  it("defaults to the Kodiak reader when no venue params are given", async () => {
    const res = await request(createApp()).get(
      `/api/market/tv/history?${WINDOW}`
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(kodiakHistoryMock).toHaveBeenCalledWith(
      "PERP_BTC_USDC",
      "60",
      1791500000,
      1791503600
    );
    expect(lighterCandlesMock).not.toHaveBeenCalled();
    // Un-prefixed key — byte-identical to the pre-X3 cache key
    // (timestamps rounded to the 5-minute bucket).
    expect(writeCacheMock.mock.calls[0][0]).toBe(
      "tv:history:PERP_BTC_USDC:60:1791499800:1791503400"
    );
  });

  it("dispatches to the Lighter reader with a venue-prefixed cache key", async () => {
    const res = await request(createApp()).get(
      `/api/market/tv/history?${WINDOW}&exchange=lighter&environment=testnet`
    );

    expect(res.status).toBe(200);
    expect(lighterCandlesMock).toHaveBeenCalledWith({
      symbol: "PERP_BTC_USDC",
      resolution: "60",
      from: 1791500000,
      to: 1791503600,
      environment: "testnet",
    });
    expect(kodiakHistoryMock).not.toHaveBeenCalled();
    expect(writeCacheMock.mock.calls[0][0]).toBe(
      "tv:history:lighter:testnet:PERP_BTC_USDC:60:1791499800:1791503400"
    );
  });

  it("keeps the Kodiak reader for an explicit kodiak venue", async () => {
    const res = await request(createApp()).get(
      `/api/market/tv/history?${WINDOW}&exchange=kodiak&environment=mainnet`
    );

    expect(res.status).toBe(200);
    expect(kodiakHistoryMock).toHaveBeenCalledTimes(1);
    expect(lighterCandlesMock).not.toHaveBeenCalled();
    expect(writeCacheMock.mock.calls[0][0]).toBe(
      "tv:history:PERP_BTC_USDC:60:1791499800:1791503400"
    );
  });

  it("400s on partial or unknown venue params without calling a reader", async () => {
    const app = createApp();
    const cases = [
      `${WINDOW}&exchange=lighter`, // environment missing
      `${WINDOW}&environment=testnet`, // exchange missing
      `${WINDOW}&exchange=coinbase&environment=testnet`, // unknown exchange
      `${WINDOW}&exchange=lighter&environment=staging`, // unknown environment
      `${WINDOW}&exchange=&environment=testnet`, // empty exchange
    ];
    for (const query of cases) {
      const res = await request(app).get(`/api/market/tv/history?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "exchange (kodiak|lighter) and environment (testnet|mainnet) are required"
      );
    }
    expect(kodiakHistoryMock).not.toHaveBeenCalled();
    expect(lighterCandlesMock).not.toHaveBeenCalled();
  });

  it("400s with the reader's error when the venue lookup fails", async () => {
    lighterCandlesMock.mockResolvedValue({
      success: false,
      error: 'symbol "ETH" not listed on Lighter',
    });

    const res = await request(createApp()).get(
      `/api/market/tv/history?symbol=ETH&resolution=60&from=1791500000&to=1791503600&exchange=lighter&environment=testnet`
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'symbol "ETH" not listed on Lighter',
    });
    expect(writeCacheMock).not.toHaveBeenCalled();
  });

  it("serves a cached window without calling any reader", async () => {
    readCacheMock.mockResolvedValueOnce({
      success: true,
      data: HISTORY,
      timestamp: Date.now(),
    });

    const res = await request(createApp()).get(
      `/api/market/tv/history?${WINDOW}&exchange=lighter&environment=mainnet`
    );

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(lighterCandlesMock).not.toHaveBeenCalled();
    expect(kodiakHistoryMock).not.toHaveBeenCalled();
  });
});
