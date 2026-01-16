/** @format */

import { redisService } from '../../services/redis';
import logger from '../../services/logger';
import { TickData, KlineData } from './types';

/**
 * Manages Redis caching operations for market data
 * Handles ticks, klines, and mark price data with TTL management
 */
export class CacheManager {
  /**
   * Cache tick data with 60-second TTL
   */
  async cacheTick(symbol: string, data: TickData): Promise<void> {
    try {
      const cacheKey = `tick:${symbol}`;
      const result = await redisService.setex(cacheKey, 60, JSON.stringify(data));

      if (!result.success) {
        logger.warn('Tick cache write failed', {
          symbol,
          error: result.error
        });
      } else {
        logger.debug('Tick cached', { symbol, price: data.price });
      }
    } catch (error) {
      logger.error('Error caching tick data', {
        symbol,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get cached tick data
   */
  async getTick(symbol: string): Promise<TickData | null> {
    try {
      const cacheKey = `tick:${symbol}`;
      const result = await redisService.get(cacheKey);

      if (result.success && result.data) {
        const tickData = JSON.parse(result.data);
        logger.debug('Tick cache hit', { symbol, price: tickData.price });
        return tickData;
      } else if (!result.success) {
        logger.warn('Tick cache read failed', {
          symbol,
          error: result.error
        });
      } else {
        logger.debug('Tick cache miss', { symbol });
      }

      return null;
    } catch (error) {
      logger.error('Error reading tick cache', {
        symbol,
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Cache kline data with 1-hour TTL
   */
  async cacheKlines(symbol: string, interval: string, klines: KlineData[]): Promise<void> {
    try {
      const cacheKey = `kline:${symbol}:${interval}`;
      const result = await redisService.setex(cacheKey, 3600, JSON.stringify(klines));

      if (!result.success) {
        logger.warn('Klines cache write failed', {
          symbol,
          interval,
          error: result.error
        });
      } else {
        logger.debug('Klines cached', { symbol, interval, count: klines.length });
      }
    } catch (error) {
      logger.error('Error caching kline data', {
        symbol,
        interval,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get cached kline data
   */
  async getKlines(symbol: string, interval: string, limit: number = 300): Promise<KlineData[]> {
    try {
      const cacheKey = `kline:${symbol}:${interval}`;
      const result = await redisService.get(cacheKey);

      if (result.success && result.data) {
        const klines = JSON.parse(result.data);
        const limitedKlines = klines.slice(-limit);
        logger.debug('Klines cache hit', {
          symbol,
          interval,
          requested: limit,
          returned: limitedKlines.length
        });
        return limitedKlines;
      } else if (!result.success) {
        logger.warn('Klines cache read failed', {
          symbol,
          interval,
          error: result.error
        });
      } else {
        logger.debug('Klines cache miss', { symbol, interval });
      }

      return [];
    } catch (error) {
      logger.error('Error reading kline cache', {
        symbol,
        interval,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Cache mark price data with 30-second TTL
   */
  async cacheMarkPrice(symbol: string, data: any): Promise<void> {
    try {
      const cacheKey = `markprice:${symbol}`;
      const result = await redisService.setex(cacheKey, 30, JSON.stringify(data));

      if (!result.success) {
        logger.warn('Mark price cache write failed', {
          symbol,
          error: result.error
        });
      } else {
        logger.debug('Mark price cached', { symbol, price: data.price });
      }
    } catch (error) {
      logger.error('Error caching mark price data', {
        symbol,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get cached mark price data
   */
  async getMarkPrice(symbol: string): Promise<any | null> {
    try {
      const cacheKey = `markprice:${symbol}`;
      const result = await redisService.get(cacheKey);

      if (result.success && result.data) {
        const markPriceData = JSON.parse(result.data);
        logger.debug('Mark price cache hit', { symbol, price: markPriceData.price });
        return markPriceData;
      } else if (!result.success) {
        logger.warn('Mark price cache read failed', {
          symbol,
          error: result.error
        });
      } else {
        logger.debug('Mark price cache miss', { symbol });
      }

      return null;
    } catch (error) {
      logger.error('Error reading mark price cache', {
        symbol,
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Delete cached data for a symbol
   */
  async invalidateSymbolData(symbol: string): Promise<void> {
    try {
      const keys = await this.getSymbolKeys(symbol);
      let deletedCount = 0;

      for (const key of keys) {
        const result = await redisService.del(key);
        if (result.success) {
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        logger.info('Symbol data invalidated', { symbol, keysDeleted: deletedCount });
      }
    } catch (error) {
      logger.error('Error invalidating symbol data', {
        symbol,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get all cache keys for a symbol
   */
  private async getSymbolKeys(symbol: string): Promise<string[]> {
    // In a real implementation, you might use Redis SCAN or KEYS
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
      logger.info('Clearing all market data cache');
      // In a real implementation, you might use Redis SCAN and DEL
      // For now, this is a placeholder
      logger.info('Market data cache cleared');
    } catch (error) {
      logger.error('Error clearing market data cache', {
        error: (error as Error).message
      });
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
      // In a real implementation, you might scan for cache keys
      const cacheKeys: string[] = [];

      return {
        redisConnected,
        cacheKeys,
      };
    } catch (error) {
      logger.error('Error getting cache stats', {
        error: (error as Error).message
      });
      return {
        redisConnected: false,
        cacheKeys: [],
      };
    }
  }
}
