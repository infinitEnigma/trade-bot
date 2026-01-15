/** @format */

import { Router, Request, Response } from "express";
import axios from "axios";
import { authService, TokenPayload } from "../services/auth";
import { createHash } from "crypto";
import * as ed25519 from "@noble/ed25519";
import { redisService } from "../services/redis";
import { query } from "../database/pool";  // ✅ Import from centralized module
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";  // ✅ Import centralized auth
import logger from "../services/logger";  // ✅ Import structured logger
import { encryptionService } from "../services/encryption";  // ✅ Import encryption service
import { RateLimiters } from "../services/rate-limiter";
import { marketStreamService } from "../services/market-stream";

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
async function getKodiakCredentials(userId: string) {
  const result = await query(
    "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    accountId: result.rows[0].account_id,
    apiKey: encryptionService.decryptApiKey(result.rows[0].api_key_encrypted),
    secretKey: encryptionService.decryptSecretKey(
      result.rows[0].secret_key_encrypted
    ),
  };
}

// Generate Kodiak signature using Ed25519
async function generateKodiakSignature(
  timestamp: number,
  method: string,
  path: string,
  body: string,
  secretKey: string
): Promise<string> {
  const message = `${timestamp}${method}${path}${body}`;
  let privateKeyBytes = Buffer.from(secretKey, "base64");

  // Handle different key formats - Ed25519 expects 32 bytes
  if (privateKeyBytes.length > 32) {
    // If key is longer than 32 bytes, take first 32 bytes (private key part)
    privateKeyBytes = privateKeyBytes.subarray(0, 32);
  } else if (privateKeyBytes.length < 32) {
    // If key is shorter, pad with zeros (unlikely but defensive)
    const padded = Buffer.alloc(32);
    privateKeyBytes.copy(padded);
    privateKeyBytes = padded;
  }

  const messageBytes = new TextEncoder().encode(message);
  const hash = createHash("sha256").update(messageBytes).digest();
  const signature = await ed25519.sign(hash, privateKeyBytes);
  return Buffer.from(signature).toString("base64url");
}

// GET /api/market/ticker
router.get("/ticker", RateLimiters.market, async (req: Request, res: Response) => {
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
});

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
    res.status(500).json({ success: false, error: "Failed to fetch tickers" });
  }
});

// GET /api/market/klines - Public WebSocket-based kline data (Phase 4 requirement)
router.get("/klines", RateLimiters.market, async (req: Request, res: Response) => {
  try {
    const { symbol, interval, limit } = req.query;

    const symbolStr = (symbol as string) || "PERP_BTC_USDC";
    const intervalStr = (interval as string) || "1h";
    const limitNum = parseInt(limit as string) || 300;

    // Get kline data from WebSocket cache
    const klines = await marketStreamService.getKlines(symbolStr, intervalStr, limitNum);

    if (klines.length > 0) {
      res.json({
        success: true,
        data: klines,
        timestamp: Date.now(),
      });

      logger.debug("Klines served from WebSocket cache", {
        symbol: symbolStr,
        interval: intervalStr,
        count: klines.length
      });
    } else {
      // No cached data yet - WebSocket might still be connecting
      res.json({
        success: true,
        data: [],
        timestamp: Date.now(),
        message: "Kline data not available yet - WebSocket connecting"
      });

      logger.debug("Klines requested but no cached data available", {
        symbol: symbolStr,
        interval: intervalStr
      });
    }
  } catch (err: any) {
    logger.error("Klines endpoint error", {
      symbol: req.query.symbol,
      interval: req.query.interval,
      limit: req.query.limit,
      error: err.message,
    });
    res.status(500).json({
      success: false,
      error: "Failed to fetch kline data"
    });
  }
});

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
    const CACHE_TTL = 300; // 5 minutes (config doesn't change often)

    // Try Redis cache first
    const cached = await redisService.get(cacheKey);
    if (cached) {
      logger.debug("TV Config cache hit");
      return res.json(JSON.parse(cached));
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

    // Cache the result
    await redisService.setex(cacheKey, CACHE_TTL, JSON.stringify(result));

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
    const cached = await redisService.get(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      cachedData.cached = true;
      return res.json(cachedData);
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

    // Cache the result for 5 seconds
    const CACHE_TTL = 5; // 5 seconds - keeps data fresh but reduces API calls significantly
    await redisService.setex(cacheKey, CACHE_TTL, JSON.stringify(result));

    logger.debug("TV History cached successfully", {
      cacheKey,
      symbol: symbolStr,
      resolution: resolutionStr,
      ttl: CACHE_TTL,
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

export { router as marketRoutes };
