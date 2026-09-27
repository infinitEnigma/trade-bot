/** @format */

import request from "supertest";
import { Express } from "express";

// Mock dependencies before importing any other modules
jest.mock(
  "../../../src/infrastructure/external/kodiak-integration.service",
  () => ({
    kodiakIntegrationService: {
      getMarketTicker: jest.fn(),
      getOrderbook: jest.fn(),
      getPositions: jest.fn(),
      getBalance: jest.fn(),
      getTrades: jest.fn(),
      getTradingViewConfig: jest.fn(),
      getTradingViewSymbols: jest.fn(),
      getTradingViewHistory: jest.fn(),
    },
  })
);

jest.mock("../../../src/infrastructure/cache/redis.service", () => ({
  redisService: {
    get: jest.fn().mockResolvedValue({ success: false }),
    setex: jest.fn().mockResolvedValue({ success: true }),
  },
}));

// L11: a non-kodiak account is venue-dispatched to the Lighter portfolio
// reader (it used to be refused with a kodiak-only 400).
jest.mock("../../../src/infrastructure/external/lighter/portfolio", () => ({
  getLighterPositions: jest.fn(),
  getLighterBalance: jest.fn(),
  getLighterTrades: jest.fn(),
}));

jest.mock(
  "../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      listAccounts: jest.fn(),
      getAccountWithSecret: jest.fn(),
    },
  })
);

jest.mock(
  "../../../src/infrastructure/external/kodiak/credentials-provider",
  () => ({
    getUserCredentials: jest.fn(),
  })
);

jest.mock("../../../src/interfaces/middleware/auth.middleware", () => ({
  authMiddleware: jest
    .fn()
    .mockImplementation((req: any, res: any, next: any) => {
      req.user = {
        userId: "user-123",
        email: "test@example.com",
        userLevel: "VERIFIED",
        roles: [],
      };
      next();
    }),
  AuthenticatedRequest: jest.fn(),
}));

jest.mock("../../../src/infrastructure/security/rate-limiter.service", () => ({
  RateLimiters: {
    market: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
    kodiakApi: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
  },
}));

jest.mock("../../../src/core/logging/", () => ({
  ContextAwareLogger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("../../../src/config/cache.config", () => ({
  getCacheConfig: jest.fn().mockReturnValue({
    MARKET_TRADINGVIEW_CONFIG: 3600,
  }),
  getFullCacheConfig: jest.fn().mockReturnValue({
    MARKET_KLINES_SHORT: 300,
  }),
}));

jest.mock("../../../src/shared/utils/context", () => ({
  getCorrelationId: jest.fn().mockReturnValue("test-correlation-id"),
}));

// Get mock services
const mockKodiakService =
  require("../../../src/infrastructure/external/kodiak-integration.service").kodiakIntegrationService;
const mockRedisService =
  require("../../../src/infrastructure/cache/redis.service").redisService;
const mockAccountRepo =
  require("../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter").exchangeAccountRepositoryAdapter;
const mockGetUserCredentials =
  require("../../../src/infrastructure/external/kodiak/credentials-provider").getUserCredentials;
const mockLighterPortfolio = require("../../../src/infrastructure/external/lighter/portfolio");

/**
 * C2 credential gate: an ACTIVE account row plus a decryptable envelope.
 * Fixture mirrors `requireVerifiedCredentials` (market-cache.ts).
 */
function grantVerifiedCredentials(accountRef = "test-account-id"): void {
  mockAccountRepo.listAccounts.mockResolvedValue([
    { id: "account-1", status: "ACTIVE", accountRef, exchange: "kodiak" },
  ]);
  mockGetUserCredentials.mockResolvedValue({
    accountId: accountRef,
    apiKey: "ed25519:test",
    secretKey: "x".repeat(32),
  });
}

/** No usable account: either no ACTIVE row or an unreadable envelope. */
function denyVerifiedCredentials(): void {
  mockAccountRepo.listAccounts.mockResolvedValue([]);
  mockGetUserCredentials.mockResolvedValue(null);
}

// Create a test app
function createTestApp(): Express {
  const express = require("express");
  const app = express();

  // Add necessary middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Import and register routes
  const {
    marketRoutes,
  } = require("../../../src/interfaces/http/trading/market");
  app.use("/api/market", marketRoutes);

  return app;
}

describe("Market Controller", () => {
  let app: Express;

  beforeAll(() => {
    // Set necessary environment variables
    process.env.KODIAK_WS_URL = "wss://test-ws.example.com";
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create fresh app instance
    app = createTestApp();
  });

  describe("GET /api/market/ticker", () => {
    it("should return ticker data for default symbol", async () => {
      const mockTicker = {
        symbol: "PERP_BTC_USDC",
        mark_price: "45000",
        "24h_close": "44000",
        "24h_volume": "1000000",
        "24h_high": "46000",
        "24h_low": "43000",
        index_price: "44900",
        open_interest: "5000",
        est_funding_rate: "0.001",
      };

      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: true,
        data: mockTicker,
      });

      const response = await request(app).get("/api/market/ticker").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.symbol).toBe("PERP_BTC_USDC");
      expect(parseFloat(response.body.data.price)).toBe(45000);
      expect(parseFloat(response.body.data.change24h)).toBe(1000);
    });

    it("should return ticker data for specific symbol", async () => {
      const symbol = "PERP_ETH_USDC";
      const mockTicker = {
        symbol,
        mark_price: "2500",
        "24h_close": "2400",
        "24h_volume": "500000",
        "24h_high": "2600",
        "24h_low": "2300",
      };

      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: true,
        data: mockTicker,
      });

      const response = await request(app)
        .get(`/api/market/ticker?symbol=${symbol}`)
        .expect(200);

      expect(response.body.data.symbol).toBe(symbol);
      expect(mockKodiakService.getMarketTicker).toHaveBeenCalledWith(symbol);
    });

    it("should handle ticker API failure", async () => {
      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app).get("/api/market/ticker").expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain(
        "Market data temporarily unavailable"
      );
    });

    it("should handle internal server errors", async () => {
      mockKodiakService.getMarketTicker.mockRejectedValue(
        new Error("Network error")
      );

      const response = await request(app).get("/api/market/ticker").expect(503);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/market/tickers", () => {
    it("should return all tickers", async () => {
      const mockTickers = [
        { symbol: "PERP_BTC_USDC", mark_price: "45000" },
        { symbol: "PERP_ETH_USDC", mark_price: "2500" },
      ];

      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: true,
        data: mockTickers,
      });

      const response = await request(app)
        .get("/api/market/tickers")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(2);
    });

    it("should handle tickers API failure", async () => {
      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app)
        .get("/api/market/tickers")
        .expect(502);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/market/klines", () => {
    it("should return kline data from Kodiak", async () => {
      const mockHistory = {
        s: "ok",
        t: [1700000000, 1700003600],
        o: [45000, 45500],
        h: [46000, 46500],
        l: [44000, 45000],
        c: [45500, 46000],
        v: [100, 120],
      };
      mockKodiakService.getTradingViewHistory.mockResolvedValue({
        success: true,
        data: mockHistory,
      });

      const response = await request(app).get("/api/market/klines").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body.data[0]).toMatchObject({
        open: 45000,
        close: 45500,
      });
      expect(response.body.source).toBe("kodiak_rest");
    });

    it("should return empty data when Kodiak has no candles", async () => {
      mockKodiakService.getTradingViewHistory.mockResolvedValue({
        success: true,
        data: { s: "no_data", t: [], o: [], h: [], l: [], c: [], v: [] },
      });

      const response = await request(app).get("/api/market/klines").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should handle kline API failure", async () => {
      mockKodiakService.getTradingViewHistory.mockRejectedValue(
        new Error("Service error")
      );

      const response = await request(app).get("/api/market/klines").expect(502);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/market/orderbook", () => {
    it("should return orderbook data", async () => {
      const mockOrderbook = {
        bids: [
          [45000, 1],
          [44999, 2],
        ],
        asks: [
          [45001, 1],
          [45002, 2],
        ],
      };

      mockKodiakService.getOrderbook.mockResolvedValue({
        success: true,
        data: mockOrderbook,
      });

      const response = await request(app)
        .get("/api/market/orderbook")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockOrderbook);
    });

    it("should handle orderbook API failure", async () => {
      mockKodiakService.getOrderbook.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app)
        .get("/api/market/orderbook")
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/market/futures/:symbol", () => {
    it("should return futures data from cache if available", async () => {
      const symbol = "PERP_BTC_USDC";
      const cacheData = {
        success: true,
        data: { symbol, mark_price: "45000" },
        timestamp: Date.now(),
      };

      mockRedisService.get.mockResolvedValue({
        success: true,
        data: JSON.stringify(cacheData),
      });

      const response = await request(app)
        .get(`/api/market/futures/${symbol}`)
        .expect(200);

      expect(response.body).toEqual(cacheData);
      expect(mockKodiakService.getMarketTicker).not.toHaveBeenCalled();
    });

    it("should fetch and cache futures data", async () => {
      const symbol = "PERP_BTC_USDC";
      const mockData = { symbol, mark_price: "45000" };

      mockRedisService.get.mockResolvedValue({ success: false });
      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: true,
        data: mockData,
      });

      const response = await request(app)
        .get(`/api/market/futures/${symbol}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockData);
      expect(mockRedisService.setex).toHaveBeenCalled();
    });

    it("should handle futures API failure", async () => {
      const symbol = "PERP_BTC_USDC";

      mockRedisService.get.mockResolvedValue({ success: false });
      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app)
        .get(`/api/market/futures/${symbol}`)
        .expect(503);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/market/markprice/:symbol", () => {
    it("should return mark price from Kodiak ticker", async () => {
      const symbol = "PERP_BTC_USDC";

      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: true,
        data: { symbol, mark_price: "45000.5" },
      });

      const response = await request(app)
        .get(`/api/market/markprice/${symbol}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({ symbol, price: "45000.5" });
    });

    it("should handle no mark price available", async () => {
      const symbol = "PERP_BTC_USDC";

      mockKodiakService.getMarketTicker.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app)
        .get(`/api/market/markprice/${symbol}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeNull();
    });
  });

  describe("GET /api/market/positions (protected)", () => {
    it("should return user positions", async () => {
      const mockPositions = [
        { symbol: "PERP_BTC_USDC", size: 1, entryPrice: 45000 },
      ];

      mockKodiakService.getPositions.mockResolvedValue({
        success: true,
        data: mockPositions,
      });

      const response = await request(app)
        .get("/api/market/positions")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockPositions);
      expect(mockKodiakService.getPositions).toHaveBeenCalledWith(
        "user-123",
        undefined
      );
    });

    it("should handle positions API failure", async () => {
      mockKodiakService.getPositions.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app)
        .get("/api/market/positions")
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("C3b account scoping (?exchangeAccountId=)", () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    const activeKodiakAccount = {
      id: accountId,
      userId: "user-123",
      exchange: "kodiak",
      status: "ACTIVE",
      accountRef: "acc-1",
    };

    beforeEach(() => {
      mockAccountRepo.getAccountWithSecret.mockResolvedValue(
        activeKodiakAccount
      );
      mockKodiakService.getPositions.mockResolvedValue({
        success: true,
        data: [],
      });
      mockKodiakService.getBalance.mockResolvedValue({
        success: true,
        data: {},
      });
      mockKodiakService.getTrades.mockResolvedValue({
        success: true,
        data: [],
      });
    });

    it("scopes positions to the requested account", async () => {
      const response = await request(app)
        .get(`/api/market/positions?exchangeAccountId=${accountId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockKodiakService.getPositions).toHaveBeenCalledWith(
        "user-123",
        accountId
      );
      expect(mockAccountRepo.getAccountWithSecret).toHaveBeenCalledWith(
        "user-123",
        accountId
      );
    });

    it("scopes balance and trades to the requested account", async () => {
      await request(app)
        .get(`/api/market/balance?exchangeAccountId=${accountId}`)
        .expect(200);
      expect(mockKodiakService.getBalance).toHaveBeenCalledWith(
        "user-123",
        accountId
      );

      await request(app)
        .get(`/api/market/trades?exchangeAccountId=${accountId}`)
        .expect(200);
      expect(mockKodiakService.getTrades).toHaveBeenCalledWith(
        "user-123",
        50,
        accountId
      );
    });

    it("answers 400 for a malformed exchangeAccountId", async () => {
      const response = await request(app)
        .get("/api/market/positions?exchangeAccountId=not-a-uuid")
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: "Invalid exchangeAccountId format",
      });
      expect(mockAccountRepo.getAccountWithSecret).not.toHaveBeenCalled();
      expect(mockKodiakService.getPositions).not.toHaveBeenCalled();
    });

    it("answers 404 for an unknown or foreign account", async () => {
      mockAccountRepo.getAccountWithSecret.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/market/positions?exchangeAccountId=${accountId}`)
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: "Exchange account not found",
      });
      expect(mockKodiakService.getPositions).not.toHaveBeenCalled();
    });

    it("answers 409 for a non-ACTIVE account", async () => {
      mockAccountRepo.getAccountWithSecret.mockResolvedValue({
        ...activeKodiakAccount,
        status: "PENDING",
      });

      const response = await request(app)
        .get(`/api/market/balance?exchangeAccountId=${accountId}`)
        .expect(409);

      expect(response.body).toEqual({
        success: false,
        error: "Exchange account is not active",
      });
      expect(mockKodiakService.getBalance).not.toHaveBeenCalled();
    });

    it("dispatches a non-kodiak (lighter) account to the Lighter reader", async () => {
      mockAccountRepo.getAccountWithSecret.mockResolvedValue({
        ...activeKodiakAccount,
        exchange: "lighter",
      });
      mockLighterPortfolio.getLighterPositions.mockResolvedValue({
        success: true,
        data: { rows: [{ symbol: "ETH", size: 1 }] },
      });

      const response = await request(app)
        .get(`/api/market/positions?exchangeAccountId=${accountId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        rows: [{ symbol: "ETH", size: 1 }],
      });
      expect(mockLighterPortfolio.getLighterPositions).toHaveBeenCalledWith(
        "user-123",
        accountId
      );
      expect(mockKodiakService.getPositions).not.toHaveBeenCalled();
    });

    it("surfaces a Lighter reader failure as 400 with its error", async () => {
      mockAccountRepo.getAccountWithSecret.mockResolvedValue({
        ...activeKodiakAccount,
        exchange: "lighter",
      });
      mockLighterPortfolio.getLighterPositions.mockResolvedValue({
        success: false,
        error: "Sidecar unreachable",
      });

      const response = await request(app)
        .get(`/api/market/positions?exchangeAccountId=${accountId}`)
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: "Sidecar unreachable",
      });
      expect(mockKodiakService.getPositions).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/market/balance (protected)", () => {
    it("should return user balance", async () => {
      const mockBalance = { available: 1000, total: 1500 };

      mockKodiakService.getBalance.mockResolvedValue({
        success: true,
        data: mockBalance,
      });

      const response = await request(app)
        .get("/api/market/balance")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockBalance);
      expect(mockKodiakService.getBalance).toHaveBeenCalledWith(
        "user-123",
        undefined
      );
    });

    it("should handle balance API failure", async () => {
      mockKodiakService.getBalance.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app)
        .get("/api/market/balance")
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/market/trades (protected)", () => {
    it("should return user trades", async () => {
      const mockTrades = [
        { id: "t1", symbol: "PERP_BTC_USDC", side: "BUY", price: 50000 },
      ];

      mockKodiakService.getTrades.mockResolvedValue({
        success: true,
        data: mockTrades,
      });

      const response = await request(app).get("/api/market/trades").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockTrades);
      expect(mockKodiakService.getTrades).toHaveBeenCalledWith(
        "user-123",
        50,
        undefined
      );
    });

    it("should pass a custom limit through", async () => {
      mockKodiakService.getTrades.mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/market/trades?limit=10").expect(200);

      expect(mockKodiakService.getTrades).toHaveBeenCalledWith(
        "user-123",
        10,
        undefined
      );
    });

    it("should handle trades API failure", async () => {
      mockKodiakService.getTrades.mockResolvedValue({
        success: false,
        error: "API error",
      });

      const response = await request(app).get("/api/market/trades").expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/market/ws-url (protected)", () => {
    it("should return WebSocket URL for authenticated user", async () => {
      grantVerifiedCredentials();

      const response = await request(app).get("/api/market/ws-url").expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.publicWsUrl).toContain("test-account-id");
    });

    it("should reject request without an active exchange account", async () => {
      denyVerifiedCredentials();

      const response = await request(app).get("/api/market/ws-url").expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Exchange account required");
    });

    it("should reject request when the stored envelope is unreadable", async () => {
      mockAccountRepo.listAccounts.mockResolvedValue([
        { id: "account-1", status: "ACTIVE", accountRef: "test-account-id" },
      ]);
      mockGetUserCredentials.mockResolvedValue(null);

      const response = await request(app).get("/api/market/ws-url").expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Exchange account required");
    });
  });

  describe("TradingView endpoints", () => {
    describe("GET /api/market/tv/config", () => {
      it("should return TV config", async () => {
        const mockConfig = { symbols: ["PERP_BTC_USDC"] };

        mockKodiakService.getTradingViewConfig.mockResolvedValue({
          success: true,
          data: mockConfig,
        });

        const response = await request(app)
          .get("/api/market/tv/config")
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(mockConfig);
      });
    });

    describe("GET /api/market/tv/symbols", () => {
      it("should return TV symbols", async () => {
        const mockSymbols = ["PERP_BTC_USDC", "PERP_ETH_USDC"];

        mockKodiakService.getTradingViewSymbols.mockResolvedValue({
          success: true,
          data: mockSymbols,
        });

        const response = await request(app)
          .get("/api/market/tv/symbols")
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(mockSymbols);
      });
    });

    describe("GET /api/market/tv/history", () => {
      it("should return TV history data", async () => {
        const mockHistory = {
          t: [1640995200],
          o: ["45000"],
          h: ["46000"],
          l: ["44000"],
          c: ["45500"],
          v: ["100"],
        };

        mockKodiakService.getTradingViewHistory.mockResolvedValue({
          success: true,
          data: mockHistory,
        });

        const response = await request(app)
          .get("/api/market/tv/history")
          .query({
            symbol: "PERP_BTC_USDC",
            resolution: "1",
            from: "1640995200",
            to: "1641081600",
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(mockHistory);
      });
    });
  });

  describe("GET /api/market/kline-history (protected)", () => {
    it("should return historical kline data", async () => {
      grantVerifiedCredentials();

      const mockHistory = {
        t: [1640995200],
        o: ["45000"],
        h: ["46000"],
        l: ["44000"],
        c: ["45500"],
        v: ["100"],
      };

      mockKodiakService.getTradingViewHistory.mockResolvedValue({
        success: true,
        data: mockHistory,
      });

      const response = await request(app)
        .get("/api/market/kline-history")
        .query({
          symbol: "PERP_BTC_USDC",
          resolution: "60",
          from: "1640995200",
          to: "1641081600",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].startTime).toBe(1640995200000);
    });

    it("should reject request without an active exchange account", async () => {
      denyVerifiedCredentials();

      const response = await request(app)
        .get("/api/market/kline-history")
        .query({ symbol: "PERP_BTC_USDC", resolution: "60" })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Exchange account required");
    });

    it("should handle no data available", async () => {
      grantVerifiedCredentials();

      mockKodiakService.getTradingViewHistory.mockResolvedValue({
        success: true,
        data: { s: "no_data" },
      });

      const response = await request(app)
        .get("/api/market/kline-history")
        .query({ symbol: "PERP_BTC_USDC", resolution: "60" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });
  });
});
