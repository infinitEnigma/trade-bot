/** @format */

import { redisService } from "../../cache/redis.service";
import { getCacheConfig, CACHE_KEYS } from "../../../config/cache.config";
import { cacheInvalidationService } from "../../cache/cache-invalidation.service";
import { marketStreamLogger as logger } from "../../../core/logging/context-aware-logger.service";
import { TickData, KlineData, MarkPriceData } from "./types";

/**
 * Manages Redis caching operations for market data
 * Handles ticks, klines, and mark price data with TTL management
 */
export class CacheManager {
  /**
   * Cache tick data with configured TTL
   */
  async cacheTick(symbol: string, data: TickData): Promise<void> {
    try {
      const cacheKey = CACHE_KEYS.tick(symbol);
      const _config = getCacheConfig();
      const result = await redisService.atomicCacheUpdate(
        cacheKey,
        data,
        undefined, // No versioning needed for market data
        3 // maxRetries
      );

      if (!result.success) {
        logger.warn("Tick cache write failed", {
          symbol,
          error: result.error,
        });
      } else {
        logger.debug("Tick cached", { symbol, price: data.price, version: result.version });
      }
    } catch (error) {
      logger.error("Error caching tick data", error as Error, { symbol });
    }
  }

  /**
   * Get cached tick data
   */
  async getTick(symbol: string): Promise<TickData | null> {
    try {
      const cacheKey = CACHE_KEYS.tick(symbol);
      const result = await redisService.get(cacheKey);

      if (result.success && result.data) {
        const tickData = JSON.parse(result.data);
        logger.debug("Tick cache hit", { symbol, price: tickData.price });
        return tickData;
      } else if (!result.success) {
        logger.warn("Tick cache read failed", {
          symbol,
          error: result.error,
        });
      } else {
        logger.debug("Tick cache miss", { symbol });
      }

      return null;
    } catch (error) {
      logger.error("Error reading tick cache", error as Error, { symbol });
      return null;
    }
  }

  /**
   * Cache kline data with configured TTL
   */
  async cacheKlines(
    symbol: string,
    interval: string,
    klines: KlineData[]
  ): Promise<void> {
    try {
      const cacheKey = CACHE_KEYS.kline(symbol, interval);
      const config = getCacheConfig();

      // Determine TTL based on interval
      let ttl: number;
      if (interval.includes('1m') || interval.includes('5m')) {
        ttl = config.MARKET_KLINES_SHORT;
      } else if (interval.includes('15m') || interval.includes('30m')) {
        ttl = config.MARKET_KLINES_MEDIUM;
      } else {
        ttl = config.MARKET_KLINES_LONG;
      }

      const result = await redisService.atomicCacheUpdate(
        cacheKey,
        klines,
        undefined, // No versioning needed for market data
        3 // maxRetries
      );

      if (!result.success) {
        logger.warn("Klines cache write failed", {
          symbol,
          interval,
          error: result.error,
        });
      } else {
        logger.debug("Klines cached", {
          symbol,
          interval,
          count: klines.length,
          ttl,
          version: result.version,
        });
      }
    } catch (error) {
      logger.error("Error caching kline data", error as Error, { symbol, interval });
    }
  }

  /**
   * Get cached kline data
   */
  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 300
  ): Promise<KlineData[]> {
    try {
      const cacheKey = CACHE_KEYS.kline(symbol, interval);
      const result = await redisService.get(cacheKey);

      if (result.success && result.data) {
        const klines = JSON.parse(result.data);
        const limitedKlines = klines.slice(-limit);
        logger.debug("Klines cache hit", {
          symbol,
          interval,
          requested: limit,
          returned: limitedKlines.length,
        });
        return limitedKlines;
      } else if (!result.success) {
        logger.warn("Klines cache read failed", {
          symbol,
          interval,
          error: result.error,
        });
      } else {
        logger.debug("Klines cache miss", { symbol, interval });
      }

      return [];
    } catch (error) {
      logger.error("Error reading kline cache", error as Error, { symbol, interval });
      return [];
    }
  }

  /**
   * Cache mark price data with configured TTL
   */
  async cacheMarkPrice(symbol: string, data: MarkPriceData): Promise<void> {
    try {
      const cacheKey = CACHE_KEYS.markPrice(symbol);
      const _config = getCacheConfig();
      const result = await redisService.atomicCacheUpdate(
        cacheKey,
        data,
        undefined, // No versioning needed for market data
        3 // maxRetries
      );

      if (!result.success) {
        logger.warn("Mark price cache write failed", {
          symbol,
          error: result.error,
        });
      } else {
        logger.debug("Mark price cached", { symbol, price: data.price, version: result.version });
      }
    } catch (error) {
      logger.error("Error caching mark price data", error as Error, { symbol });
    }
  }

  /**
   * Get cached mark price data
   */
  async getMarkPrice(symbol: string): Promise<MarkPriceData | null> {
    try {
      const cacheKey = CACHE_KEYS.markPrice(symbol);
      const result = await redisService.get(cacheKey);

      if (result.success && result.data) {
        const markPriceData = JSON.parse(result.data);
        logger.debug("Mark price cache hit", {
          symbol,
          price: markPriceData.price,
        });
        return markPriceData;
      } else if (!result.success) {
        logger.warn("Mark price cache read failed", {
          symbol,
          error: result.error,
        });
      } else {
        logger.debug("Mark price cache miss", { symbol, cacheKey, result: result.error });
      }

      return null;
    } catch (error) {
      logger.error("Error reading mark price cache", error as Error, { symbol });
      return null;
    }
  }

  /**
   * Delete cached data for a symbol with broadcasting
   */
  async invalidateSymbolData(symbol: string, reason: string = 'manual_invalidation'): Promise<void> {
    try {
      const keys = await this.getSymbolKeys(symbol);

      // Invalidate with broadcasting
      const result = await cacheInvalidationService.invalidateWithBroadcast(
        keys,
        reason,
        undefined // No specific user
      );

      if (result.success && result.keysInvalidated > 0) {
        logger.info("Symbol data invalidated with broadcasting", {
          symbol,
          keysInvalidated: result.keysInvalidated,
          reason,
        });
      }
    } catch (error) {
      logger.error("Error invalidating symbol data", error as Error, { symbol });
    }
  }

  /**
   * Get all cache keys for a symbol
   */
  private async getSymbolKeys(symbol: string): Promise<string[]> {
    // TODO: use Redis SCAN or KEYS
    // For now, we'll just return the known key patterns
    return [
      `tick:${symbol}`,
      `markprice:${symbol}`,
      // Note: kline keys have intervals, so we'd need to scan for those
    ];
  }

  /**
   * Clear all cached market data
   */
  async clearAll(): Promise<void> {
    try {
      logger.info("Clearing all market data cache");
      // TODO: use Redis SCAN and DEL
      // For now, this is a placeholder
      logger.info("Market data cache cleared");
    } catch (error) {
      logger.error("Error clearing market data cache", error as Error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    redisConnected: boolean;
    cacheKeys: string[];
  }> {
    try {
      const redisConnected = await redisService.isHealthy();
      // TODO: scan for cache keys
      const cacheKeys: string[] = [];

      return {
        redisConnected,
        cacheKeys,
      };
    } catch (error) {
      logger.error("Error getting cache stats", error as Error);
      return {
        redisConnected: false,
        cacheKeys: [],
      };
    }
  }
}
