/** @format */

import { ConnectionCacheService, connectionCache, ConnectionCacheEntry } from '../../src/infrastructure/cache/connection-cache.service';
import { redisService } from '../../src/infrastructure/cache/redis.service';
import logger from '../../src/core/logging/logger.service';

// Mock dependencies
jest.mock('../../src/infrastructure/cache/redis.service');
jest.mock('../../src/core/logging/logger.service');

describe('ConnectionCacheService', () => {
    let service: ConnectionCacheService;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Create fresh instance for each test with short TTL for testing
        service = new ConnectionCacheService({
            successTtlSeconds: 1, // 1 second for testing
            failureTtlSeconds: 1, // 1 second for testing
            maxEntriesPerUser: 2,
            cleanupIntervalMs: 60000 // 1 minute for testing
        });
    });

    describe('instance creation', () => {
        it('should create an instance of ConnectionCacheService', () => {
            expect(service).toBeInstanceOf(ConnectionCacheService);
        });

        it('should export a singleton instance', () => {
            expect(connectionCache).toBeInstanceOf(ConnectionCacheService);
            expect(connectionCache).toBeDefined();
        });
    });

    describe('constructor', () => {
        it('should initialize with default configuration when no config provided', () => {
            const defaultService = new ConnectionCacheService();
            const stats = defaultService.getStats();

            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.sets).toBe(0);
            expect(stats.evictions).toBe(0);
            expect(stats.cleanups).toBe(0);
            expect(stats.hitRate).toBe(0);
        });

        it('should initialize with custom configuration when provided', () => {
            const customConfig = {
                successTtlSeconds: 300,
                failureTtlSeconds: 60,
                maxEntriesPerUser: 5,
                cleanupIntervalMs: 30000
            };

            const customService = new ConnectionCacheService(customConfig);
            expect(customService).toBeInstanceOf(ConnectionCacheService);
        });

        it('should log initialization info', () => {
            expect(logger.info).toHaveBeenCalled();
        });
    });

    describe('getCachedResult', () => {
        it('should return null and increment misses for cache miss', async () => {
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: null
            });
            (redisService.get as jest.Mock) = mockGet;

            const result = await service.getCachedResult('user-123', 'account-456');

            expect(result).toBeNull();
            expect(mockGet).toHaveBeenCalled();
            expect(service.getStats().misses).toBe(1);
        });

        it('should return cached entry for cache hit', async () => {
            const mockEntry: ConnectionCacheEntry = {
                userId: 'user-123',
                accountId: 'account-456',
                success: true,
                timestamp: Date.now(),
                ttl: 600
            };

            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(mockEntry)
            });
            (redisService.get as jest.Mock) = mockGet;

            const result = await service.getCachedResult('user-123', 'account-456');

            expect(result).toEqual(mockEntry);
            expect(service.getStats().hits).toBe(1);
            expect(logger.debug).toHaveBeenCalledWith('Connection cache hit', expect.any(Object));
        });

        it('should evict and return null for expired entry', async () => {
            const expiredEntry: ConnectionCacheEntry = {
                userId: 'user-123',
                accountId: 'account-456',
                success: true,
                timestamp: Date.now() - (601 * 1000), // Expired by 1 second
                ttl: 600
            };

            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(expiredEntry)
            });
            (redisService.get as jest.Mock) = mockGet;

            const mockDel = jest.fn().mockResolvedValue(true);
            (redisService.del as jest.Mock) = mockDel;

            const result = await service.getCachedResult('user-123', 'account-456');

            expect(result).toBeNull();
            expect(mockDel).toHaveBeenCalled();
            expect(service.getStats().evictions).toBe(1);
            expect(logger.debug).toHaveBeenCalledWith('Connection cache entry expired and removed', expect.any(Object));
        });

        it('should return null and log error when Redis operation fails', async () => {
            const mockGet = jest.fn().mockRejectedValue(new Error('Redis connection error'));
            (redisService.get as jest.Mock) = mockGet;

            const result = await service.getCachedResult('user-123', 'account-456');

            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalled();
            expect(service.getStats().misses).toBe(1);
        });
    });

    describe('setCachedResult', () => {
        it('should set successful connection result in cache', async () => {
            const mockSetex = jest.fn().mockResolvedValue(true);
            (redisService.setex as jest.Mock) = mockSetex;

            await service.setCachedResult('user-123', 'account-456', true);

            expect(mockSetex).toHaveBeenCalled();
            expect(service.getStats().sets).toBe(1);
            expect(logger.debug).toHaveBeenCalledWith('Connection cache entry set', expect.any(Object));
        });

        it('should set failed connection result in cache', async () => {
            const mockSetex = jest.fn().mockResolvedValue(true);
            (redisService.setex as jest.Mock) = mockSetex;

            await service.setCachedResult('user-123', 'account-456', false, 'Connection failed');

            expect(mockSetex).toHaveBeenCalled();
            expect(service.getStats().sets).toBe(1);
        });

        it('should use custom TTL when provided', async () => {
            const customTtl = 1800; // 30 minutes
            const mockSetex = jest.fn().mockResolvedValue(true);
            (redisService.setex as jest.Mock) = mockSetex;

            await service.setCachedResult('user-123', 'account-456', true, undefined, customTtl);

            expect(mockSetex).toHaveBeenCalledWith(
                expect.anything(),
                customTtl,
                expect.anything()
            );
        });

        it('should log error when setting cache fails', async () => {
            const mockSetex = jest.fn().mockRejectedValue(new Error('Redis connection error'));
            (redisService.setex as jest.Mock) = mockSetex;

            await service.setCachedResult('user-123', 'account-456', true);

            expect(logger.error).toHaveBeenCalled();
        });

        it('should evict oldest entry when cache limit reached', async () => {
            const mockGetUserCacheEntries = jest.fn().mockResolvedValue([
                { userId: 'user-123', accountId: 'account-456', timestamp: Date.now() - 30000 },
                { userId: 'user-123', accountId: 'account-789', timestamp: Date.now() - 20000 },
                { userId: 'user-123', accountId: 'account-012', timestamp: Date.now() - 10000 }
            ]);

            const mockDel = jest.fn().mockResolvedValue(true);
            const mockSetex = jest.fn().mockResolvedValue(true);

            (redisService.setex as jest.Mock) = mockSetex;
            (redisService.del as jest.Mock) = mockDel;

            // Spy on private methods
            jest.spyOn(service as any, 'getUserCacheEntries').mockImplementation(mockGetUserCacheEntries);

            await service.setCachedResult('user-123', 'account-345', true);

            expect(redisService.del).toHaveBeenCalled();
            expect(service.getStats().evictions).toBeGreaterThan(0);
        });
    });

    describe('invalidateUserCache', () => {
        it('should clear user cache entries', async () => {
            const mockGetUserCacheEntries = jest.fn().mockResolvedValue([
                { userId: 'user-123', accountId: 'account-456' },
                { userId: 'user-123', accountId: 'account-789' }
            ]);

            const mockDel = jest.fn().mockResolvedValue(true);
            (redisService.del as jest.Mock) = mockDel;

            jest.spyOn(service as any, 'getUserCacheEntries').mockImplementation(mockGetUserCacheEntries);

            const result = await service.invalidateUserCache('user-123');

            expect(result).toBe(2);
            expect(mockDel).toHaveBeenCalledTimes(2);
            expect(logger.info).toHaveBeenCalledWith('User connection cache cleared', expect.any(Object));
        });

        it('should log error when cache invalidation fails', async () => {
            const mockError = new Error('Redis connection error');
            const mockGetUserCacheEntries = jest.fn().mockRejectedValue(mockError);

            const spy = jest.spyOn(service as any, 'getUserCacheEntries').mockImplementation(mockGetUserCacheEntries);

            await service.invalidateUserCache('user-123');

            expect(logger.error).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe('getStats', () => {
        it('should return cache statistics with hit rate calculation', async () => {
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify({
                    userId: 'user-123',
                    accountId: 'account-456',
                    success: true,
                    timestamp: Date.now(),
                    ttl: 600
                })
            });
            (redisService.get as jest.Mock) = mockGet;

            // Perform cache hits
            await service.getCachedResult('user-123', 'account-456');
            await service.getCachedResult('user-123', 'account-456');

            // Perform cache miss
            (redisService.get as jest.Mock) = jest.fn().mockResolvedValue({
                success: true,
                data: null
            });
            await service.getCachedResult('user-123', 'account-789');

            const stats = service.getStats();

            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.hitRate).toBe(2 / 3);
        });

        it('should return 0 hit rate when no requests', () => {
            const stats = service.getStats();
            expect(stats.hitRate).toBe(0);
        });
    });

    describe('private methods', () => {
        it('should generate cache key with correct format', () => {
            const cacheKey = (service as any).getCacheKey('user-123', 'account-456');
            expect(cacheKey).toBe('connection:cache:user-123:account-456');
        });

        it('should evict oldest entries when cache limit reached', async () => {
            const mockGetUserCacheEntries = jest.fn().mockResolvedValue([
                { userId: 'user-123', accountId: 'account-456', timestamp: Date.now() - 30000 },
                { userId: 'user-123', accountId: 'account-789', timestamp: Date.now() - 20000 },
                { userId: 'user-123', accountId: 'account-012', timestamp: Date.now() - 10000 }
            ]);

            const mockDel = jest.fn().mockResolvedValue(true);
            (redisService.del as jest.Mock) = mockDel;

            jest.spyOn(service as any, 'getUserCacheEntries').mockImplementation(mockGetUserCacheEntries);

            await (service as any).evictOldestUserEntries('user-123');

            expect(mockDel).toHaveBeenCalled();
            expect(service.getStats().evictions).toBeGreaterThan(0);
        });

        it('should log error when evicting oldest entries fails', async () => {
            const mockGetUserCacheEntries = jest.fn().mockRejectedValue(new Error('Redis connection error'));
            jest.spyOn(service as any, 'getUserCacheEntries').mockImplementation(mockGetUserCacheEntries);

            await (service as any).evictOldestUserEntries('user-123');

            expect(logger.error).toHaveBeenCalled();
        });
    });
});