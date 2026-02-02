/** @format */

import { CacheManager } from '../../src/infrastructure/messaging/market-stream/cache-manager';
import { TickData, KlineData, MarkPriceData } from '../../src/infrastructure/messaging/market-stream/types';

// Mock dependencies
jest.mock('../../src/core/logging/logger.service');
jest.mock('../../src/infrastructure/cache/redis.service');
jest.mock('../../src/infrastructure/cache/cache-invalidation.service');
jest.mock('../../src/config/cache.config');

describe('CacheManager', () => {
    let cacheManager: CacheManager;

    // Mock data
    const mockSymbol = 'BTC/USDT';
    const mockTickData: TickData = {
        symbol: mockSymbol,
        price: 50000,
        volume: 1000,
        timestamp: Date.now(),
        bid: 49999,
        ask: 50001,
        change24h: 2.5
    };

    const mockKlineData: KlineData = {
        symbol: mockSymbol,
        type: '1m',
        open: 49000,
        close: 50000,
        high: 51000,
        low: 48000,
        volume: 10000,
        amount: 500000000,
        startTime: Date.now() - 60000,
        endTime: Date.now()
    };

    const mockMarkPriceData: MarkPriceData = {
        symbol: mockSymbol,
        price: 50005,
        timestamp: Date.now(),
        fundingRate: 0.001
    };

    beforeEach(() => {
        // Mock getCacheConfig
        const mockGetCacheConfig = jest.fn().mockReturnValue({
            MARKET_KLINES_SHORT: 300,
            MARKET_KLINES_MEDIUM: 900,
            MARKET_KLINES_LONG: 3600
        });
        require('../../src/config/cache.config').getCacheConfig = mockGetCacheConfig;

        cacheManager = new CacheManager();
    });

    describe('instance creation', () => {
        it('should create an instance of CacheManager', () => {
            expect(cacheManager).toBeInstanceOf(CacheManager);
        });
    });

    describe('cacheTick', () => {
        it('should cache tick data successfully', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: true, version: 1 });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            await cacheManager.cacheTick(mockSymbol, mockTickData);

            expect(mockAtomicCacheUpdate).toHaveBeenCalled();
        });

        it('should handle cacheTick failure', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: false, error: 'Redis connection error' });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.cacheTick(mockSymbol, mockTickData);

            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle cacheTick exception', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.cacheTick(mockSymbol, mockTickData);

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getTick', () => {
        it('should get cached tick data successfully', async () => {
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(mockTickData)
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await cacheManager.getTick(mockSymbol);

            expect(result).toEqual(mockTickData);
            expect(mockGet).toHaveBeenCalled();
        });

        it('should handle getTick cache miss', async () => {
            const mockGet = jest.fn().mockResolvedValue({ success: true, data: null });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await cacheManager.getTick(mockSymbol);

            expect(result).toBeNull();
        });

        it('should handle getTick failure', async () => {
            const mockGet = jest.fn().mockResolvedValue({ success: false, error: 'Redis connection error' });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            const result = await cacheManager.getTick(mockSymbol);

            expect(result).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle getTick exception', async () => {
            const mockGet = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            const result = await cacheManager.getTick(mockSymbol);

            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('cacheKlines', () => {
        it('should cache kline data successfully with short interval', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: true, version: 1 });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            await cacheManager.cacheKlines(mockSymbol, '1m', [mockKlineData]);

            expect(mockAtomicCacheUpdate).toHaveBeenCalled();
        });

        it('should cache kline data successfully with medium interval', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: true, version: 1 });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            await cacheManager.cacheKlines(mockSymbol, '15m', [mockKlineData]);

            expect(mockAtomicCacheUpdate).toHaveBeenCalled();
        });

        it('should cache kline data successfully with long interval', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: true, version: 1 });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            await cacheManager.cacheKlines(mockSymbol, '4h', [mockKlineData]);

            expect(mockAtomicCacheUpdate).toHaveBeenCalled();
        });

        it('should cache kline data successfully with other interval types', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: true, version: 1 });
            const mockGetCacheConfig = jest.fn().mockReturnValue({
                MARKET_KLINES_SHORT: 300,
                MARKET_KLINES_MEDIUM: 900,
                MARKET_KLINES_LONG: 3600
            });
            require('../../src/config/cache.config').getCacheConfig = mockGetCacheConfig;

            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            await cacheManager.cacheKlines(mockSymbol, '1d', [mockKlineData]);

            expect(mockAtomicCacheUpdate).toHaveBeenCalled();
            expect(mockGetCacheConfig).toHaveBeenCalled();
        });

        it('should use long TTL for unsupported intervals', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: true, version: 1 });
            const mockConfig = {
                MARKET_KLINES_SHORT: 300,
                MARKET_KLINES_MEDIUM: 900,
                MARKET_KLINES_LONG: 3600
            };
            const mockGetCacheConfig = jest.fn().mockReturnValue(mockConfig);
            require('../../src/config/cache.config').getCacheConfig = mockGetCacheConfig;

            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            await cacheManager.cacheKlines(mockSymbol, 'invalid-interval', [mockKlineData]);

            expect(mockAtomicCacheUpdate).toHaveBeenCalled();
            expect(mockGetCacheConfig).toHaveBeenCalled();
        });

        it('should handle cacheKlines failure', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: false, error: 'Redis connection error' });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.cacheKlines(mockSymbol, '1m', [mockKlineData]);

            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle cacheKlines exception', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.cacheKlines(mockSymbol, '1m', [mockKlineData]);

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getKlines', () => {
        it('should get cached kline data successfully', async () => {
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify([mockKlineData])
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await cacheManager.getKlines(mockSymbol, '1m');

            expect(result).toEqual([mockKlineData]);
            expect(mockGet).toHaveBeenCalled();
        });

        it('should handle getKlines cache miss', async () => {
            const mockGet = jest.fn().mockResolvedValue({ success: true, data: null });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await cacheManager.getKlines(mockSymbol, '1m');

            expect(result).toEqual([]);
        });

        it('should handle getKlines failure', async () => {
            const mockGet = jest.fn().mockResolvedValue({ success: false, error: 'Redis connection error' });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            const result = await cacheManager.getKlines(mockSymbol, '1m');

            expect(result).toEqual([]);
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle getKlines exception', async () => {
            const mockGet = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            const result = await cacheManager.getKlines(mockSymbol, '1m');

            expect(result).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('cacheMarkPrice', () => {
        it('should cache mark price data successfully', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: true, version: 1 });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            await cacheManager.cacheMarkPrice(mockSymbol, mockMarkPriceData);

            expect(mockAtomicCacheUpdate).toHaveBeenCalled();
        });

        it('should handle cacheMarkPrice failure', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockResolvedValue({ success: false, error: 'Redis connection error' });
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.cacheMarkPrice(mockSymbol, mockMarkPriceData);

            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle cacheMarkPrice exception', async () => {
            const mockAtomicCacheUpdate = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.atomicCacheUpdate = mockAtomicCacheUpdate;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.cacheMarkPrice(mockSymbol, mockMarkPriceData);

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getMarkPrice', () => {
        it('should get cached mark price data successfully', async () => {
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(mockMarkPriceData)
            });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await cacheManager.getMarkPrice(mockSymbol);

            expect(result).toEqual(mockMarkPriceData);
            expect(mockGet).toHaveBeenCalled();
        });

        it('should handle getMarkPrice cache miss', async () => {
            const mockGet = jest.fn().mockResolvedValue({ success: true, data: null });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const result = await cacheManager.getMarkPrice(mockSymbol);

            expect(result).toBeNull();
        });

        it('should handle getMarkPrice failure', async () => {
            const mockGet = jest.fn().mockResolvedValue({ success: false, error: 'Redis connection error' });
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            const result = await cacheManager.getMarkPrice(mockSymbol);

            expect(result).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle getMarkPrice exception', async () => {
            const mockGet = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.get = mockGet;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            const result = await cacheManager.getMarkPrice(mockSymbol);

            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('invalidateSymbolData', () => {
        it('should invalidate symbol data successfully', async () => {
            const mockInvalidateWithBroadcast = jest.fn().mockResolvedValue({
                success: true,
                keysInvalidated: 2
            });
            require('../../src/infrastructure/cache/cache-invalidation.service').cacheInvalidationService.invalidateWithBroadcast = mockInvalidateWithBroadcast;

            await cacheManager.invalidateSymbolData(mockSymbol);

            expect(mockInvalidateWithBroadcast).toHaveBeenCalled();
        });

        it('should handle invalidateSymbolData exception', async () => {
            const mockInvalidateWithBroadcast = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/cache-invalidation.service').cacheInvalidationService.invalidateWithBroadcast = mockInvalidateWithBroadcast;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.invalidateSymbolData(mockSymbol);

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('clearAll', () => {
        it('should clear all cached data', async () => {
            const mockLogger = require('../../src/core/logging/logger.service').default;

            await cacheManager.clearAll();

            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should handle clearAll exception', async () => {
            const mockLogger = require('../../src/core/logging/logger.service').default;
            // Mock console.log to throw an error
            const originalInfo = mockLogger.info;
            mockLogger.info = jest.fn().mockImplementation(() => {
                throw new Error('Unexpected error');
            });

            await cacheManager.clearAll();

            expect(mockLogger.error).toHaveBeenCalled();
            mockLogger.info = originalInfo;
        });
    });

    describe('getStats', () => {
        it('should get cache statistics', async () => {
            const mockIsHealthy = jest.fn().mockResolvedValue(true);
            require('../../src/infrastructure/cache/redis.service').redisService.isHealthy = mockIsHealthy;

            const result = await cacheManager.getStats();

            expect(result.redisConnected).toBe(true);
            expect(Array.isArray(result.cacheKeys)).toBe(true);
            expect(mockIsHealthy).toHaveBeenCalled();
        });

        it('should handle getStats exception', async () => {
            const mockIsHealthy = jest.fn().mockRejectedValue(new Error('Unexpected error'));
            require('../../src/infrastructure/cache/redis.service').redisService.isHealthy = mockIsHealthy;

            const mockLogger = require('../../src/core/logging/logger.service').default;

            const result = await cacheManager.getStats();

            expect(result.redisConnected).toBe(false);
            expect(result.cacheKeys).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});