/** GET /api/market/tv/* — public TradingView endpoints (no auth). */
import { Router, Request, Response } from "express";
import { kodiakIntegrationService } from "../../../infrastructure/external/kodiak-integration.service";
import { DataFreshnessUtils, FreshnessAwareResponse } from "@trade-bot/shared";
import { RateLimiters } from "../../../infrastructure/security/rate-limiter.service";
import {
  getCacheConfig,
  getFullCacheConfig,
} from "../../../config/cache.config";
import {
    DEFAULT_SYMBOL,
    errMessage,
    fail,
    marketLogger,
    ok,
    tvHistoryCacheKey,
} from "./market-helpers";
import { readCache, writeCache } from "./market-cache";

export const tvRoutes = Router();

tvRoutes.get(
  "/tv/config",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
        const cacheKey = "tv:config";
        const cacheConfig = getCacheConfig();
        const cached = await readCache<Record<string, unknown>>(cacheKey);
        if (cached) {
            marketLogger.debug("TV Config cache hit");
            return res.json(cached);
        }
      marketLogger.debug(
        "TV Config cache miss, fetching from centralized service"
      );
        const response = await kodiakIntegrationService.getTradingViewConfig();
        if (!response.success) {
            return res.status(400).json({
                success: false,
          error: response.error || "Failed to fetch TV config",
            });
        }
        const result = {
            success: true,
            data: response.data,
            timestamp: Date.now(),
            cached: false,
        };
        await writeCache(cacheKey, cacheConfig.MARKET_TRADINGVIEW_CONFIG, result);
        res.json(result);
    } catch (err: unknown) {
        fail(res, "tv_config_endpoint", "Failed to fetch TV config", {
            error: errMessage(err),
        });
    }
  }
);

tvRoutes.get(
  "/tv/symbols",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    try {
        const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const response =
        await kodiakIntegrationService.getTradingViewSymbols(symbol);
        if (!response.success) {
            return res.status(400).json({
                success: false,
          error: response.error || "Failed to fetch TV symbols",
            });
        }
        ok(res, response.data);
    } catch (err: unknown) {
        fail(res, "tv_symbols_endpoint", "Failed to fetch TV symbols", {
            error: errMessage(err),
        });
    }
  }
);

// MOST IMPORTANT (used every 5 seconds by charts)
tvRoutes.get(
  "/tv/history",
  RateLimiters.market,
  async (req: Request, res: Response) => {
    const { symbol, resolution, from, to } = req.query;
    const symbolStr = (symbol as string) || DEFAULT_SYMBOL;
    const resolutionStr = (resolution as string) || "1";
    const fromNum = from
        ? parseInt(from as string)
        : Math.floor(Date.now() / 1000) - 86400;
    const toNum = to ? parseInt(to as string) : Math.floor(Date.now() / 1000);

    try {
      const cacheKey = tvHistoryCacheKey(
        symbolStr,
        resolutionStr,
        fromNum,
        toNum
      );
        const cacheConfig = getFullCacheConfig();
      const cached = await readCache<
        Record<string, unknown> & { timestamp: number }
      >(cacheKey);
        if (cached) {
            cached.cached = true;
            cached.freshness = DataFreshnessUtils.createCacheMetadata(
                cacheConfig.MARKET_KLINES_SHORT,
                cached.timestamp
            );
            return res.json(cached);
        }
        // No cached data - use centralized service to get fresh chart data
      const response = await kodiakIntegrationService.getTradingViewHistory(
        symbolStr,
        resolutionStr,
        fromNum,
        toNum
      );
        if (!response.success) {
            return res.status(400).json({
                success: false,
          error: response.error || "Failed to fetch TV history",
            });
        }
        const result: FreshnessAwareResponse = {
            success: true,
            data: response.data,
            timestamp: Date.now(),
            cached: false,
        };
        // TradingView data updates vary by resolution:
        // 1m charts: every minute, 5m charts: every 5 minutes, etc.
      const updateFrequency =
        resolutionStr === "1"
          ? 60000 // 1 minute for 1m resolution
          : resolutionStr === "5"
            ? 300000 // 5 minutes for 5m resolution
            : 900000; // 15 minutes for longer resolutions
      result.freshness = DataFreshnessUtils.createApiMetadata(
        updateFrequency,
        Date.now()
      );
        await writeCache(cacheKey, cacheConfig.MARKET_KLINES_SHORT, result);
        marketLogger.debug("TV History cached successfully", {
            cacheKey,
            symbol: symbolStr,
            resolution: resolutionStr,
            ttl: cacheConfig.MARKET_KLINES_SHORT,
            updateFrequency,
        });
        res.json(result);
    } catch (err: unknown) {
        fail(res, "tv_history_endpoint", "Failed to fetch TV history", {
            symbol: symbolStr,
            resolution: resolutionStr,
            from: fromNum,
            to: toNum,
            error: errMessage(err),
        });
    }
  }
);
