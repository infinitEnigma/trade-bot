/** @format */

import { Router, Request, Response } from "express";
import { kodiakIntegrationService, KodiakMarketTicker } from "../../../infrastructure/external/kodiak-integration.service";
import { redisService } from "../../../infrastructure/cache/redis.service";
import { query } from "../../../database/pool"; // ✅ Import from centralized module
import { authMiddleware, AuthenticatedRequest } from "../../middleware/auth"; // ✅ Import centralized auth
import { createErrorResponse, ExternalServiceError, DataFreshnessUtils, FreshnessAwareResponse } from "../../../shared/types/errors";
import { getCorrelationId } from "../../../shared/utils/context";
import logger from "../../../core/logging/logger.service"; // ✅ Import structured logger
import { RateLimiters } from "../../../infrastructure";
import { marketStreamService } from "../../../infrastructure/messaging/market-stream.service";
import { getCacheConfig, getFullCacheConfig } from "../../../config/cache.config"; // ✅ Import centralized cache config
import { AxiosError } from "axios";

const router = Router();


//const KODIAK_API_BASE = process.env.KODIAK_API_URL || "https://api.orderly.org/v1";
const WS_BASE =
  process.env.KODIAK_WS_URL || "wss://ws-evm.orderly.org/ws/stream";

// GET /api/market/ticker
router.get(
  "/ticker",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

      // Use centralized service to get market ticker data
      const response = await kodiakIntegrationService.getMarketTicker(symbol);

      if (!response.success) {
        logger.warn("Market ticker API failed", {
          symbol,
          error: response.error,
        });

        // Return clear error so user knows data is unavailable
        return res.status(503).json({
          success: false,
          error: "Market data temporarily unavailable. Please try again later.",
          symbol,
          timestamp: Date.now(),
          retryAfter: 30, // Suggest retry after 30 seconds
        });
      }

      // Transform futures data to ticker format
      const futuresData: KodiakMarketTicker = response.data || { symbol };

      // Calculate 24h change: current mark price vs 24h close
      const currentPrice = parseFloat(futuresData.mark_price?.toString() || "0");
      const prevClose = parseFloat(futuresData['24h_close']?.toString() || "0");
      const change24h = currentPrice - prevClose;

      // Format ticker response
      const tickerData = {
        symbol: futuresData.symbol || symbol,
        price: currentPrice.toFixed(2),
        change24h: change24h.toFixed(2),
        volume24h: futuresData['24h_volume']?.toString() || '0',
        high24h: futuresData['24h_high']?.toString() || '0',
        low24h: futuresData['24h_low']?.toString() || '0',
        // Additional data available from futures endpoint
        mark_price: futuresData.mark_price?.toString(),
        index_price: futuresData.index_price?.toString(),
        open_interest: futuresData.open_interest?.toString(),
        est_funding_rate: futuresData.est_funding_rate?.toString(),
      };

      res.json({
        success: true,
        data: tickerData,
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Ticker endpoint error", {
        symbol: req.query.symbol,
        error: errorMessage,
      });

      // Return clear error so user knows data is unavailable
      res.status(503).json({
        success: false,
        error: "Market data temporarily unavailable. Please try again later.",
        symbol: (req.query.symbol as string) || "PERP_BTC_USDC",
        timestamp: Date.now(),
        retryAfter: 30, // Suggest retry after 30 seconds
      });
    }
  }
);

// GET /api/market/tickers
router.get("/tickers", async (req: Request, res: Response) => {
  try {
    // Use centralized service to get all market tickers
    const response = await kodiakIntegrationService.getMarketTicker();

    if (!response.success) {
      const externalError = new ExternalServiceError("Kodiak API", { service: "Kodiak", operation: "fetch_tickers" });
      return res.status(externalError.statusCode).json(
        createErrorResponse(externalError, getCorrelationId())
      );
    }

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Tickers endpoint error", { error: errorMessage });
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
      const limitNum = parseInt(limit as string) || 500;

      // Get kline data from WebSocket cache
      const klines = await marketStreamService.getKlines(
        symbolStr,
        intervalStr,
        limitNum
      );

      // Check for duplicate timestamps before returning
      const timestamps = klines.map(k => k.startTime);
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
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Klines endpoint error", {
        symbol: req.query.symbol,
        interval: req.query.interval,
        limit: req.query.limit,
        error: errorMessage,
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

    // Use centralized service for orderbook
    const response = await kodiakIntegrationService.getOrderbook(symbol);

    if (!response.success) {
      return res.status(400).json({
        success: false,
        error: response.error || "Failed to fetch orderbook"
      });
    }

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Orderbook endpoint error", { error: errorMessage });
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch orderbook" });
  }
});

// GET /api/market/futures/:symbol - Futures market data (more detailed than ticker)
/*router.get(
  "/futures/:symbol",
  RateLimiters.kodiakApi, // STRICT: 10 req/sec to match API limits
  RateLimiters.market,    // PERMISSIVE: 10,000 req/min for users
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

      // Cache for 10 minutes to reduce API calls (was using MARKET_FUTURES config)
      await redisService.setex(cacheKey, 600, JSON.stringify(result)); // 10 minutes

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
);*/

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
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Mark price endpoint error", {
        symbol: req.params.symbol,
        error: errorMessage,
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
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required"
        });
      }

      // Use centralized service to get positions
      const positionsResponse = await kodiakIntegrationService.getPositions(userId);

      if (!positionsResponse.success) {
        return res.status(400).json({
          success: false,
          error: positionsResponse.error || "Failed to fetch positions"
        });
      }

      res.json({
        success: true,
        data: positionsResponse.data,
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Positions endpoint error", {
        userId: req.user?.userId,
        error: errorMessage,
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
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required"
        });
      }

      // Use centralized service to get account balance
      const balanceResponse = await kodiakIntegrationService.getBalance(userId);

      if (!balanceResponse.success) {
        return res.status(400).json({
          success: false,
          error: balanceResponse.error || "Failed to fetch balance"
        });
      }

      res.json({
        success: true,
        data: balanceResponse.data,
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Balance endpoint error", {
        userId: req.user?.userId,
        error: errorMessage,
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
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required"
        });
      }

      // Get account ID for WebSocket connection
      const result = await query<{ account_id: string }>(
        "SELECT account_id FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
        [userId]
      );

      if (result.rows.length === 0) {
        return res
          .status(403)
          .json({ success: false, error: "Kodiak credentials required" });
      }

      const accountId = result.rows[0].account_id;

      res.json({
        success: true,
        data: {
          publicWsUrl: `${WS_BASE}/${accountId}`,
          timestamp: Date.now(),
        },
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("WS URL endpoint error", {
        userId: req.user?.userId,
        error: errorMessage,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to get WebSocket URL" });
    }
  }
);

// TradingView Public Endpoints (No authentication required)

// GET /api/market/tv/config
router.get("/tv/config", RateLimiters.market, async (req: Request, res: Response) => {
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

    logger.debug("TV Config cache miss, fetching from centralized service");
    // Use centralized service instead of direct axios call
    const response = await kodiakIntegrationService.getTradingViewConfig();

    if (!response.success) {
      return res.status(400).json({
        success: false,
        error: response.error || "Failed to fetch TV config"
      });
    }

    const result = {
      success: true,
      data: response.data,
      timestamp: Date.now(),
      cached: false,
    };

    // Cache the result using centralized configuration
    await redisService.setex(cacheKey, cacheConfig.MARKET_TRADINGVIEW_CONFIG, JSON.stringify(result));

    res.json(result);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("TV Config endpoint error", { error: errorMessage });
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV config" });
  }
});

// GET /api/market/tv/symbols
router.get("/tv/symbols", RateLimiters.market, async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || "PERP_BTC_USDC";

    // Use centralized service instead of direct axios call
    const response = await kodiakIntegrationService.getTradingViewSymbols(symbol);

    if (!response.success) {
      return res.status(400).json({
        success: false,
        error: response.error || "Failed to fetch TV symbols"
      });
    }

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("TV Symbols endpoint error", { error: errorMessage });
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch TV symbols" });
  }
});

// GET /api/market/tv/history - MOST IMPORTANT (used every 5 seconds by charts)
router.get("/tv/history", RateLimiters.market, async (req: Request, res: Response) => {
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

    const fullCacheConfig = getFullCacheConfig();
    const cacheConfig = fullCacheConfig;

    // Always allow TV History calls - charts should work regardless of WebSocket connections
    // Check for cached data first (always preferable)
    const cacheResult = await redisService.get(cacheKey);
    if (cacheResult.success && cacheResult.data) {
      const cachedData = JSON.parse(cacheResult.data);
      cachedData.cached = true;

      // Add freshness metadata for cached data
      const freshness = DataFreshnessUtils.createCacheMetadata(
        cacheConfig.MARKET_KLINES_SHORT,
        cachedData.timestamp
      );
      cachedData.freshness = freshness;

      return res.json(cachedData);
    } else if (!cacheResult.success) {
      logger.warn("TV History cache read failed, falling back to API", {
        cacheKey,
        error: cacheResult.error,
      });
    }

    // No cached data - use centralized service to get fresh chart data
    const response = await kodiakIntegrationService.getTradingViewHistory(symbolStr, resolutionStr, fromNum, toNum);

    if (!response.success) {
      return res.status(400).json({
        success: false,
        error: response.error || "Failed to fetch TV history"
      });
    }

    const result: FreshnessAwareResponse = {
      success: true,
      data: response.data,
      timestamp: Date.now(),
      cached: false,
    };

    // Add freshness metadata indicating this is fresh API data
    // TradingView data updates vary by resolution:
    // 1m charts: every minute, 5m charts: every 5 minutes, etc.
    const updateFrequency = resolutionStr === "1" ? 60000 : // 1 minute for 1m resolution
      resolutionStr === "5" ? 300000 : // 5 minutes for 5m resolution
        900000; // 15 minutes for longer resolutions

    const freshness = DataFreshnessUtils.createApiMetadata(updateFrequency, Date.now());
    result.freshness = freshness;

    // Cache the result using centralized configuration
    await redisService.setex(cacheKey, cacheConfig.MARKET_KLINES_SHORT, JSON.stringify(result));

    logger.debug("TV History cached successfully", {
      cacheKey,
      symbol: symbolStr,
      resolution: resolutionStr,
      ttl: cacheConfig.MARKET_KLINES_SHORT,
      updateFrequency,
    });

    res.json(result);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("TV History endpoint error", {
      symbol: symbolStr,
      resolution: resolutionStr,
      from: fromNum,
      to: toNum,
      error: errorMessage,
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
      const { symbol, resolution, from, to, _limit } = req.query;

      const symbolStr = (symbol as string) || "PERP_BTC_USDC";
      const resolutionStr = (resolution as string) || "60"; // TradingView format: 60 = 1 hour
      // Request only 7 days of data instead of 30 to avoid "no_data" response
      const fromNum = from
        ? parseInt(from as string)
        : Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60; // 7 days ago
      const toNum = to ? parseInt(to as string) : Math.floor(Date.now() / 1000);

      // SECURITY REQUIREMENT: Only allow access to historical data if user has verified Kodiak credentials
      // This ensures trading features are only available to properly connected users
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required"
        });
      }

      // Check if user has verified Kodiak credentials (without decrypting)
      const result = await query(
        "SELECT id FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error:
            "Kodiak credentials required. Please connect your trading account.",
        });
      }

      logger.debug(
        "Fetching historical kline data with credential verification",
        {
          userId,
          symbol: symbolStr,
          resolution: resolutionStr,
          from: fromNum,
          to: toNum,
          hasVerifiedCredentials: true,
        }
      );

      // Use centralized service to get historical kline data
      // but maintain security by requiring verified credentials
      const response = await kodiakIntegrationService.getTradingViewHistory(symbolStr, resolutionStr, fromNum, toNum);

      if (!response.success) {
        return res.status(400).json({
          success: false,
          error: response.error || "Failed to fetch historical kline data"
        });
      }

      logger.debug("Historical kline data response received", {
        responseKeys: Object.keys(response.data || {}),
        dataType: typeof response.data,
        symbol: symbolStr,
      });

      // Handle TradingView format - separated OHLC arrays
      const tvData = response.data;

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
          open: parseFloat(tvData.o[i].toString()),
          high: parseFloat(tvData.h[i].toString()),
          low: parseFloat(tvData.l[i].toString()),
          close: parseFloat(tvData.c[i].toString()),
          volume: parseFloat((tvData.v?.[i] || 0).toString()),
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
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const axiosError = err as AxiosError;
      logger.error("Historical kline data error", {
        userId: req.user?.userId,
        symbol: req.query.symbol,
        error: errorMessage,
        status: axiosError.response?.status,
        response: axiosError.response?.data,
      });

      // Handle specific error cases
      if (axiosError.response?.status === 429) {
        return res.status(429).json({
          success: false,
          error: "Rate limit exceeded. Please try again later.",
          retryAfter: axiosError.response.headers?.["retry-after"] || 10,
        });
      }

      if (axiosError.code === "ECONNABORTED" || axiosError.code === "ENOTFOUND") {
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
