/** @format */

import { Router, Request, Response } from "express";
import axios from "axios";
import { authService, TokenPayload } from "../core/auth/auth.service";
import { redisService } from "../infrastructure/cache/redis.service";
import { query } from "../database/pool"; // ✅ Import from centralized module
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth"; // ✅ Import centralized auth
import { createErrorResponse, ValidationError, NotFoundError, ExternalServiceError, DatabaseError } from "../shared/types/errors";
import { getCorrelationId } from "../shared/utils/context";
import logger from "../services/logger"; // ✅ Import structured logger
import { encryptionService } from "../infrastructure/security/encryption.service"; // ✅ Import encryption service
import { RateLimiters } from "../services/rate-limiter";
import { marketStreamService } from "../infrastructure/messaging/market-stream.service";
import { generateKodiakSignature } from "../shared/utils/orderly-signature"; // ✅ Import backend crypto utility
import { getCacheConfig } from "../config/cache.config"; // ✅ Import centralized cache config

const router = Router();

/*const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});*/

const KODIAK_API_BASE =
  process.env.KODIAK_API_URL || "https://api.orderly.org/v1";
const WS_BASE =
  process.env.KODIAK_WS_URL || "wss://ws-evm.orderly.org/ws/stream";

// ✅ Using centralized AuthenticatedRequest and authMiddleware

// Helper to get Kodiak credentials for user
async function getKodiakCredentials(userId: string): Promise<{
  accountId: string;
  apiKey: string;
  secretKey: string;
  verified: boolean;
} | null> {
  try {
    const result = await query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      logger.debug("No Kodiak credentials found for user", { userId });
      return null;
    }

    const row = result.rows[0];
    if (!row.verified) {
      logger.debug("Kodiak credentials found but not verified", { userId });
      return null;
    }

    const apiKey = encryptionService.decryptApiKey(row.api_key_encrypted);
    const secretKey = encryptionService.decryptSecretKey(
      row.secret_key_encrypted
    );

    return {
      accountId: row.account_id,
      apiKey,
      secretKey,
      verified: row.verified,
    };
  } catch (error) {
    logger.error("Failed to get Kodiak credentials", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// GET /api/market/ticker
router.get(
  "/ticker",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

      // Try to get real ticker data
      let response;
      try {
        response = await axios.get(`${KODIAK_API_BASE}/public/ticker`, {
          params: { symbol },
          timeout: 5000,
        });
      } catch (apiError: any) {
        logger.warn("Ticker API failed, using mock data", {
          symbol,
          error: apiError.message,
          status: apiError.response?.status,
        });

        // Return mock ticker data so dashboard can load
        const mockPrice = 50000 + (Math.random() - 0.5) * 1000;
        return res.json({
          success: true,
          data: {
            symbol: symbol,
            price: mockPrice.toFixed(2),
            change24h: ((Math.random() - 0.5) * 10).toFixed(2),
            volume24h: (Math.random() * 1000000).toFixed(0),
            high24h: (mockPrice * 1.05).toFixed(2),
            low24h: (mockPrice * 0.95).toFixed(2),
          },
          timestamp: Date.now(),
          mock: true, // Indicate this is mock data
        });
      }

      res.json({
        success: true,
        data: response.data.data || response.data,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      logger.error("Ticker endpoint error", {
        symbol: req.query.symbol,
        error: err.message,
      });

      // Fallback to mock data even on other errors
      const mockPrice = 50000 + (Math.random() - 0.5) * 1000;
      res.json({
        success: true,
        data: {
          symbol: (req.query.symbol as string) || "PERP_BTC_USDC",
          price: mockPrice.toFixed(2),
          change24h: ((Math.random() - 0.5) * 10).toFixed(2),
          volume24h: (Math.random() * 1000000).toFixed(0),
          high24h: (mockPrice * 1.05).toFixed(2),
          low24h: (mockPrice * 0.95).toFixed(2),
        },
        timestamp: Date.now(),
        mock: true,
      });
    }
  }
);

// GET /api/market/tickers
router.get("/tickers", async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${KODIAK_API_BASE}/public/tickers`);

    res.json({
      success: true,
      data: response.data.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    logger.error("Tickers endpoint error", { error: err.message });
    const externalError = new ExternalServiceError("Kodiak API", { service: "Kodiak", operation: "fetch_tickers" });
    res.status(externalError.statusCode).json(
      createErrorResponse(externalError, getCorrelationId())
    );
  }
});

// GET /api/market/klines - Public WebSocket-based kline data (Phase 4 requirement)
router.get(
  "/klines",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
      const { symbol, interval, limit } = req.query;

      const symbolStr = (symbol as string) || "PERP_BTC_USDC";
      const intervalStr = (interval as string) || "1h";
      const limitNum = parseInt(limit as string) || 300;

      // Get kline data from WebSocket cache
      const klines = await marketStreamService.getKlines(
        symbolStr,
        intervalStr,
        limitNum
      );

      // Check for duplicate timestamps before returning
      const timestamps = klines.map(k => k.time);
      const uniqueTimestamps = new Set(timestamps);
      const hasDuplicates = timestamps.length !== uniqueTimestamps.size;

      logger.debug("Klines endpoint returning data", {
        symbol: symbolStr,
        interval: intervalStr,
        requestedLimit: limitNum,
        actualCount: klines.length,
        hasDuplicates,
        firstCandle: klines[0],
        secondCandle: klines[1], // Check second candle for duplicates
        lastCandle: klines[klines.length - 1],
        allTimestamps: timestamps.slice(0, 10), // First 10 timestamps
      });

      if (klines.length > 0) {
        res.json({
          success: true,
          data: klines,
          timestamp: Date.now(),
        });

        logger.debug("Klines served from WebSocket cache", {
          symbol: symbolStr,
          interval: intervalStr,
          count: klines.length,
        });
      } else {
        // No cached data yet - WebSocket might still be connecting
        res.json({
          success: true,
          data: [],
          timestamp: Date.now(),
          message: "Kline data not available yet - WebSocket connecting",
        });

        logger.debug("Klines requested but no cached data available", {
          symbol: symbolStr,
          interval: intervalStr,
        });
      }
    } catch (err: any) {
      logger.error("Klines endpoint error", {
        symbol: req.query.symbol,
        interval: req.query.interval,
        limit: req.query.limit,
        error: err.message,
      });
      const externalError = new ExternalServiceError("Market Stream Service", { service: "WebSocket", operation: "get_klines" });
      res.status(externalError.statusCode).json(
        createErrorResponse(externalError, getCorrelationId())
      );
    }
  }
);

// GET /api/market/orderbook
router.get("/orderbook", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

    const response = await axios.get(`${KODIAK_API_BASE}/public/orderbook`, {
      params: { symbol },
    });

    res.json({
      success: true,
      data: response.data.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    logger.error("Orderbook endpoint error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch orderbook" });
  }
});

// GET /api/market/futures/:symbol - Futures market data (more detailed than ticker)
router.get(
  "/futures/:symbol",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const cacheKey = `futures:${symbol}`;

      // Try Redis cache first (5 minute TTL for futures data)
      const cacheResult = await redisService.get(cacheKey);
      if (cacheResult.success && cacheResult.data) {
        logger.debug("Futures data cache hit", { symbol });
        return res.json(JSON.parse(cacheResult.data));
      } else if (!cacheResult.success) {
        logger.warn("Futures data cache read failed", {
          symbol,
          error: cacheResult.error,
        });
      }

      logger.debug("Futures data cache miss, fetching from Kodiak", { symbol });
      const response = await axios.get(
        `${KODIAK_API_BASE}/public/futures/${symbol}`,
        {
          timeout: 5000,
        }
      );

      const result = {
        success: true,
        data: response.data.data || response.data,
        timestamp: Date.now(),
        cached: false,
      };

      // Cache using centralized configuration
      const cacheConfig = getCacheConfig();
      await redisService.setex(cacheKey, cacheConfig.MARKET_FUTURES, JSON.stringify(result));

      res.json(result);
    } catch (err: any) {
      logger.error("Futures endpoint error", {
        symbol: req.params.symbol,
        error: err.message,
        status: err.response?.status,
      });

      // Return cached data if available, even if stale
      const cacheKey = `futures:${req.params.symbol}`;
      const cacheResult = await redisService.get(cacheKey);
      if (cacheResult.success && cacheResult.data) {
        logger.debug("Returning stale futures data due to API error", {
          symbol: req.params.symbol,
        });
        const staleData = JSON.parse(cacheResult.data);
        staleData.stale = true;
        return res.json(staleData);
      } else if (!cacheResult.success) {
        logger.warn("Stale futures cache read failed", {
          symbol: req.params.symbol,
          error: cacheResult.error,
        });
      }

      res.status(500).json({
        success: false,
        error: "Failed to fetch futures data",
      });
    }
  }
);

// GET /api/market/markprice/:symbol - Mark price data (real-time via WebSocket)
router.get(
  "/markprice/:symbol",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const symbolStr = symbol as string;

      // Get mark price from market stream service (includes WebSocket subscription)
      const markPriceData =
        await marketStreamService.getLatestMarkPrice(symbolStr);

      if (markPriceData) {
        res.json({
          success: true,
          data: markPriceData,
          timestamp: Date.now(),
          cached: true, // Always from cache/WebSocket
        });
        logger.debug("Mark price served from cache", {
          symbol,
          price: markPriceData.price,
        });
      } else {
        // No cached data yet - WebSocket might still be connecting
        res.json({
          success: true,
          data: null,
          timestamp: Date.now(),
          message: "Mark price data not available yet - WebSocket connecting",
        });
        logger.debug("Mark price requested but no cached data available", {
          symbol,
        });
      }
    } catch (err: any) {
      logger.error("Mark price endpoint error", {
        symbol: req.params.symbol,
        error: err.message,
      });
      res.status(500).json({
        success: false,
        error: "Failed to fetch mark price data",
      });
    }
  }
);

// GET /api/market/positions (requires authentication and Kodiak credentials)
router.get(
  "/positions",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const credentials = await getKodiakCredentials(req.user!.userId);

      if (!credentials) {
        return res
          .status(403)
          .json({ success: false, error: "Kodiak credentials required" });
      }

      const timestamp = Date.now();
      const path = "/v1/positions";
      const signature = await generateKodiakSignature(
        timestamp,
        "GET",
        path,
        "",
        credentials.secretKey
      );

      const response = await axios.get(`${KODIAK_API_BASE}${path}`, {
        headers: {
          "orderly-account-id": credentials.accountId,
          "orderly-key": credentials.apiKey,
          "orderly-signature": signature,
          "orderly-timestamp": timestamp.toString(),
        },
      });

      res.json({
        success: true,
        data: response.data.data,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      logger.error("Positions endpoint error", {
        userId: req.user!.userId,
        error: err.message,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch positions" });
    }
  }
);

// GET /api/market/balance (requires authentication and Kodiak credentials)
router.get(
  "/balance",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const credentials = await getKodiakCredentials(req.user!.userId);

      if (!credentials) {
        return res
          .status(403)
          .json({ success: false, error: "Kodiak credentials required" });
      }

      const timestamp = Date.now();
      const path = "/v1/client/info";
      const signature = await generateKodiakSignature(
        timestamp,
        "GET",
        path,
        "",
        credentials.secretKey
      );

      const response = await axios.get(`${KODIAK_API_BASE}${path}`, {
        headers: {
          "orderly-account-id": credentials.accountId,
          "orderly-key": credentials.apiKey,
          "orderly-signature": signature,
          "orderly-timestamp": timestamp.toString(),
        },
      });

      res.json({
        success: true,
        data: response.data.data,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      logger.error("Balance endpoint error", {
        userId: req.user!.userId,
        error: err.message,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch balance" });
    }
  }
);

// GET /api/market/ws-url
router.get(
  "/ws-url",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const credentials = await getKodiakCredentials(req.user!.userId);

      if (!credentials) {
        return res
          .status(403)
          .json({ success: false, error: "Kodiak credentials required" });
      }

      res.json({
        success: true,
        data: {
          publicWsUrl: `${WS_BASE}/${credentials.accountId}`,
          timestamp: Date.now(),
        },
      });
    } catch (err: any) {
      logger.error("WS URL endpoint error", {
        userId: req.user!.userId,
        error: err.message,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to get WebSocket URL" });
    }
  }
);

// TradingView Public Endpoints (No authentication required)

// GET /api/market/tv/config
router.get("/tv/config", async (req: Request, res: Response) => {
  try {
    const cacheKey = "tv:config";
    const cacheConfig = getCacheConfig();

    // Try Redis cache first
    const cacheResult = await redisService.get(cacheKey);
    if (cacheResult.success && cacheResult.data) {
      logger.debug("TV Config cache hit");
      return res.json(JSON.parse(cacheResult.data));
    } else if (!cacheResult.success) {
      logger.warn("TV Config cache read failed", {
        error: cacheResult.error,
      });
    }

    logger.debug("TV Config cache miss, fetching from Kodiak");
    const response = await axios.get(`${KODIAK_API_BASE}/tv/config`);

    // Log the actual response structure for debugging
    logger.debug("TV History API response structure", {
      dataKeys: Object.keys(response.data),
      data: response.data,
    });

    const result = {
      success: true,
      data: response.data.data || response.data, // Handle both response.data.data and response.data formats
      timestamp: Date.now(),
      cached: false,
    };

    // Cache the result using centralized configuration
    await redisService.setex(cacheKey, cacheConfig.MARKET_TRADINGVIEW_CONFIG, JSON.stringify(result));

    res.json(result);
  } catch (err: any) {
    logger.error("TV Config endpoint error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV config" });
  }
});

// GET /api/market/tv/symbols
router.get("/tv/symbols", async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

    const response = await axios.get(`${KODIAK_API_BASE}/tv/symbols`, {
      params: { symbol },
    });

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    logger.error("TV Symbols endpoint error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV symbols" });
  }
});

// GET /api/market/tv/history - MOST IMPORTANT (used every 5 seconds by charts)
router.get("/tv/history", async (req: Request, res: Response) => {
  const { symbol, resolution, from, to } = req.query;
  const symbolStr = (symbol as string) || "PERP_BTC_USDC";
  const resolutionStr = (resolution as string) || "1";
  const fromNum = from
    ? parseInt(from as string)
    : Math.floor(Date.now() / 1000) - 86400;
  const toNum = to ? parseInt(to as string) : Math.floor(Date.now() / 1000);

  try {
    // Round timestamps to 5-minute intervals for stable cache keys
    // This allows requests within the same 5-minute window to share cache
    const roundTo5Minutes = (timestamp: number) => {
      return Math.floor(timestamp / 300) * 300; // 300 seconds = 5 minutes
    };

    const fromRounded = roundTo5Minutes(fromNum);
    const toRounded = roundTo5Minutes(toNum);

    // Create cache key: tv:history:BTCUSDC:1:1640995200:1641081600 (rounded to 5-min intervals)
    const cacheKey = `tv:history:${symbolStr}:${resolutionStr}:${fromRounded}:${toRounded}`;

    // Always allow TV History calls - charts should work regardless of WebSocket connections
    // Check for cached data first (always preferable)
    const cacheResult = await redisService.get(cacheKey);
    if (cacheResult.success && cacheResult.data) {
      const cachedData = JSON.parse(cacheResult.data);
      cachedData.cached = true;
      return res.json(cachedData);
    } else if (!cacheResult.success) {
      logger.warn("TV History cache read failed, falling back to API", {
        cacheKey,
        error: cacheResult.error,
      });
    }

    // No cached data - make external API call to get fresh chart data
    const response = await axios.get(`${KODIAK_API_BASE}/tv/history`, {
      params: {
        symbol: symbolStr,
        resolution: resolutionStr,
        from: fromNum, // Use original timestamps for API call
        to: toNum,
      },
    });

    const result = {
      success: true,
      data: response.data,
      timestamp: Date.now(),
      cached: false,
    };

    // Cache the result using centralized configuration
    const cacheConfig = getCacheConfig();
    await redisService.setex(cacheKey, cacheConfig.MARKET_KLINES_SHORT, JSON.stringify(result));

    logger.debug("TV History cached successfully", {
      cacheKey,
      symbol: symbolStr,
      resolution: resolutionStr,
      ttl: cacheConfig.MARKET_KLINES_SHORT,
    });

    res.json(result);
  } catch (err: any) {
    logger.error("TV History endpoint error", {
      symbol: symbolStr,
      resolution: resolutionStr,
      from: fromNum,
      to: toNum,
      error: err.message,
    });
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV history" });
  }
});

// GET /api/market/kline-history - Historical kline data with credential verification (security requirement)
router.get(
  "/kline-history",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { symbol, resolution, from, to, limit } = req.query;

      const symbolStr = (symbol as string) || "PERP_BTC_USDC";
      const resolutionStr = (resolution as string) || "60"; // TradingView format: 60 = 1 hour
      // Request only 7 days of data instead of 30 to avoid "no_data" response
      const fromNum = from
        ? parseInt(from as string)
        : Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60; // 7 days ago
      const toNum = to ? parseInt(to as string) : Math.floor(Date.now() / 1000);

      // SECURITY REQUIREMENT: Only allow access to historical data if user has verified Kodiak credentials
      // This ensures trading features are only available to properly connected users
      const credentials = await getKodiakCredentials(req.user!.userId);

      if (!credentials) {
        return res.status(403).json({
          success: false,
          error:
            "Kodiak credentials required. Please connect your trading account.",
        });
      }

      if (!credentials.verified) {
        return res.status(403).json({
          success: false,
          error:
            "Kodiak credentials not verified. Please reconnect your account.",
        });
      }

      logger.debug(
        "Fetching historical kline data with credential verification",
        {
          userId: req.user!.userId,
          symbol: symbolStr,
          resolution: resolutionStr,
          from: fromNum,
          to: toNum,
          hasVerifiedCredentials: true,
        }
      );

      // Since authenticated kline history endpoint doesn't exist, use public TV history
      // but maintain security by requiring verified credentials
      const response = await axios.get(`${KODIAK_API_BASE}/tv/history`, {
        params: {
          symbol: symbolStr,
          resolution: resolutionStr,
          from: fromNum,
          to: toNum,
        },
        timeout: 10000, // 10 second timeout
      });

      logger.debug("Historical kline data response received", {
        status: response.status,
        responseKeys: Object.keys(response.data || {}),
        dataType: typeof response.data,
        dataLength: Array.isArray(response.data)
          ? response.data.length
          : "not array",
        symbol: symbolStr,
        fullResponse: JSON.stringify(response.data).substring(0, 500),
      });

      // Handle TradingView format - separated OHLC arrays
      let tvData = response.data;

      if (typeof tvData !== "object" || !tvData) {
        logger.error("Invalid TradingView response - not an object", {
          tvData,
          dataType: typeof tvData,
        });
        return res.status(500).json({
          success: false,
          error: "Market data API returned invalid format",
        });
      }

      // Check if there's no data available
      if (tvData.s === "no_data" || !tvData.t || tvData.t.length === 0) {
        logger.debug("No historical data available for the requested period", {
          symbol: symbolStr,
          resolution: resolutionStr,
          from: fromNum,
          to: toNum,
          status: tvData.s,
        });

        // Return empty data array instead of error
        return res.json({
          success: true,
          data: [],
          timestamp: Date.now(),
          meta: {
            symbol: symbolStr,
            resolution: resolutionStr,
            from: fromNum,
            to: toNum,
            actualCount: 0,
            source: "tv_history_with_verification",
            note: "No historical data available for this time period",
          },
        });
      }

      // Validate that we have all required OHLC arrays
      if (!tvData.t || !tvData.o || !tvData.h || !tvData.l || !tvData.c) {
        logger.error("Missing required OHLC arrays in TradingView response", {
          hasTimestamps: !!tvData.t,
          hasOpens: !!tvData.o,
          hasHighs: !!tvData.h,
          hasLows: !!tvData.l,
          hasCloses: !!tvData.c,
          hasVolumes: !!tvData.v,
        });
        return res.status(500).json({
          success: false,
          error: "Market data API returned incomplete OHLC data",
        });
      }

      // Ensure all arrays have the same length
      const length = tvData.t.length;
      if (
        tvData.o.length !== length ||
        tvData.h.length !== length ||
        tvData.l.length !== length ||
        tvData.c.length !== length
      ) {
        logger.error("OHLC arrays have different lengths", {
          timestamps: tvData.t.length,
          opens: tvData.o.length,
          highs: tvData.h.length,
          lows: tvData.l.length,
          closes: tvData.c.length,
        });
        return res.status(500).json({
          success: false,
          error: "Market data API returned inconsistent OHLC data",
        });
      }

      // Transform TradingView separated arrays to our kline format
      const transformedData = [];
      for (let i = 0; i < length; i++) {
        transformedData.push({
          startTime: tvData.t[i] * 1000, // Convert seconds to milliseconds
          open: parseFloat(tvData.o[i]),
          high: parseFloat(tvData.h[i]),
          low: parseFloat(tvData.l[i]),
          close: parseFloat(tvData.c[i]),
          volume: parseFloat(tvData.v?.[i] || 0),
          symbol: symbolStr,
          type: resolutionStr === "60" ? "1h" : resolutionStr,
        });
      }

      logger.debug("Successfully transformed TradingView data", {
        symbol: symbolStr,
        candleCount: transformedData.length,
        firstCandle: transformedData[0],
        lastCandle: transformedData[transformedData.length - 1],
      });

      res.json({
        success: true,
        data: transformedData,
        timestamp: Date.now(),
        meta: {
          symbol: symbolStr,
          resolution: resolutionStr,
          from: fromNum,
          to: toNum,
          actualCount: transformedData.length,
          source: "tv_history_with_verification",
        },
      });
    } catch (err: any) {
      logger.error("Historical kline data error", {
        userId: req.user?.userId,
        symbol: req.query.symbol,
        error: err.message,
        status: err.response?.status,
        response: err.response?.data,
      });

      // Handle specific error cases
      if (err.response?.status === 429) {
        return res.status(429).json({
          success: false,
          error: "Rate limit exceeded. Please try again later.",
          retryAfter: err.response.headers?.["retry-after"] || 10,
        });
      }

      if (err.code === "ECONNABORTED" || err.code === "ENOTFOUND") {
        return res.status(503).json({
          success: false,
          error:
            "Market data service temporarily unavailable. Please try again later.",
        });
      }

      res.status(500).json({
        success: false,
        error: "Failed to fetch historical kline data",
      });
    }
  }
);

export { router as marketRoutes };
