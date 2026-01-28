/** @format */

import { KodiakCache } from '../../src/infrastructure/external/kodiak-cache';

describe('KodiakCache', () => {
    let cache: KodiakCache;

    beforeEach(() => {
        cache = new KodiakCache();
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with default TTL values', () => {
            expect(cache).toBeDefined();
        });
    });

    describe('get', () => {
        it('should return cached value when found', () => {
            const mockData = { success: true, data: 'test' };
            cache.set('test-key', mockData);

            const result = cache.get('test-key');

            expect(result).toEqual(mockData);
        });

        it('should return null when cache miss', () => {
            const result = cache.get('test-key');

            expect(result).toBeNull();
        });

        it('should return null when entry is expired', () => {
            const mockData = { success: true, data: 'test' };

            // Mock Date.now to control time
            const originalNow = Date.now;
            Date.now = jest.fn().mockReturnValue(1000);

            cache.set('test-key', mockData, 100); // 100ms TTL

            // Advance time past expiration
            Date.now = jest.fn().mockReturnValue(2000);

            const result = cache.get('test-key');

            expect(result).toBeNull();

            // Restore Date.now
            Date.now = originalNow;
        });

        it('should update last accessed time on cache hit', () => {
            const mockData = { success: true, data: 'test' };

            // Mock Date.now to control time
            const originalNow = Date.now;
            Date.now = jest.fn().mockReturnValue(1000);

            cache.set('test-key', mockData);

            // Advance time
            Date.now = jest.fn().mockReturnValue(1500);

            cache.get('test-key');

            // Check that entry was updated (this is internal behavior)
            const entry = (cache as any).cache.get('test-key');
            expect(entry.lastAccessed).toBe(1500);

            // Restore Date.now
            Date.now = originalNow;
        });
    });

    describe('set', () => {
        it('should store value with default TTL', () => {
            const mockData = { success: true, data: 'test' };

            // Mock Date.now to control time
            const originalNow = Date.now;
            Date.now = jest.fn().mockReturnValue(1000);

            cache.set('test-key', mockData);

            const entry = (cache as any).cache.get('test-key');
            expect(entry.data).toEqual(mockData);
            expect(entry.expires).toBe(31000); // 1000 + 30000 (default TTL)

            // Restore Date.now
            Date.now = originalNow;
        });

        it('should store value with custom TTL', () => {
            const mockData = { success: true, data: 'test' };

            // Mock Date.now to control time
            const originalNow = Date.now;
            Date.now = jest.fn().mockReturnValue(1000);

            cache.set('test-key', mockData, 600000);

            const entry = (cache as any).cache.get('test-key');
            expect(entry.data).toEqual(mockData);
            expect(entry.expires).toBe(601000); // 1000 + 600000

            // Restore Date.now
            Date.now = originalNow;
        });

        it('should evict oldest entries when cache is full', () => {
            // Create a new cache with maxEntries = 2
            const smallCache = new KodiakCache({ maxEntries: 2 });

            smallCache.set('key1', 'value1');
            smallCache.set('key2', 'value2');
            smallCache.set('key3', 'value3'); // Should evict key1

            expect((smallCache as any).cache.has('key1')).toBe(false);
            expect((smallCache as any).cache.has('key2')).toBe(true);
            expect((smallCache as any).cache.has('key3')).toBe(true);
        });
    });

    describe('delete', () => {
        it('should delete single key', () => {
            cache.set('test-key', 'test-value');

            const result = cache.delete('test-key');

            expect(result).toBe(true);
            expect((cache as any).cache.has('test-key')).toBe(false);
        });

        it('should return false when key does not exist', () => {
            const result = cache.delete('nonexistent-key');

            expect(result).toBe(false);
        });
    });

    describe('clearUserCache', () => {
        it('should clear all user cache entries', () => {
            cache.set('positions:user123', 'positions-data');
            cache.set('trades:user123', 'trades-data');
            cache.set('positions:user456', 'other-positions-data');

            const result = cache.clearUserCache('user123');

            expect(result).toBe(2);
            expect((cache as any).cache.has('positions:user123')).toBe(false);
            expect((cache as any).cache.has('trades:user123')).toBe(false);
            expect((cache as any).cache.has('positions:user456')).toBe(true);
        });

        it('should return 0 when no user cache entries found', () => {
            const result = cache.clearUserCache('user123');

            expect(result).toBe(0);
        });
    });

    describe('getStats', () => {
        it('should return cache statistics', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.get('key1'); // This will be a hit

            const stats = cache.getStats();

            expect(stats.totalEntries).toBe(2);
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(0);
            expect(stats.sets).toBe(2);
            expect(stats.hitRate).toBeGreaterThan(0);
        });
    });

    describe('getTtlForEndpoint', () => {
        it('should return specific TTL for known endpoints', () => {
            expect((cache as any).getTtlForEndpoint('positions')).toBe(600000);
            expect((cache as any).getTtlForEndpoint('trades')).toBe(600000);
            expect((cache as any).getTtlForEndpoint('balance')).toBe(300000);
            expect((cache as any).getTtlForEndpoint('accountInfo')).toBe(1800000);
            expect((cache as any).getTtlForEndpoint('status')).toBe(300000);
        });

        it('should return default TTL for unknown endpoints', () => {
            expect((cache as any).getTtlForEndpoint('unknown')).toBe(30000);
        });
    });

    describe('extractUserIdFromKey', () => {
        it('should extract user ID from cache key', () => {
            expect((cache as any).extractUserIdFromKey('positions:user123')).toBe('user123');
            expect((cache as any).extractUserIdFromKey('trades:user456:extra')).toBe('user456');
            expect((cache as any).extractUserIdFromKey('config')).toBe('unknown');
        });
    });

    describe('extractEndpointFromKey', () => {
        it('should extract endpoint from cache key', () => {
            expect((cache as any).extractEndpointFromKey('positions:user123')).toBe('positions');
            expect((cache as any).extractEndpointFromKey('trades:user456:extra')).toBe('trades');
            expect((cache as any).extractEndpointFromKey('config')).toBe('config');
        });
    });

    describe('evictOldest', () => {
        it('should evict oldest entry when cache is full', () => {
            const originalMaxEntries = (cache as any).config.maxEntries;
            (cache as any).config.maxEntries = 2;

            // Mock Date.now to control time
            const originalNow = Date.now;
            Date.now = jest.fn().mockReturnValue(1000);

            cache.set('key1', 'value1');

            Date.now = jest.fn().mockReturnValue(2000);
            cache.set('key2', 'value2');

            Date.now = jest.fn().mockReturnValue(3000);
            cache.set('key3', 'value3'); // Should evict key1

            expect((cache as any).cache.has('key1')).toBe(false);
            expect((cache as any).cache.has('key2')).toBe(true);
            expect((cache as any).cache.has('key3')).toBe(true);

            // Restore Date.now and maxEntries
            Date.now = originalNow;
            (cache as any).config.maxEntries = originalMaxEntries;
        });
    });

    describe('cleanup', () => {
        it('should remove expired entries', () => {
            // Mock Date.now to control time
            const originalNow = Date.now;
            Date.now = jest.fn().mockReturnValue(1000);

            cache.set('key1', 'value1', 100); // 100ms TTL
            cache.set('key2', 'value2', 10000); // 10s TTL

            // Advance time past expiration of key1
            Date.now = jest.fn().mockReturnValue(2000);

            (cache as any).cleanup();

            expect((cache as any).cache.has('key1')).toBe(false);
            expect((cache as any).cache.has('key2')).toBe(true);

            // Restore Date.now
            Date.now = originalNow;
        });
    });

    describe('destroy', () => {
        it('should clear cache and stop cleanup timer', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');

            cache.destroy();

            expect((cache as any).cache.size).toBe(0);
            expect((cache as any).cleanupTimer).toBeUndefined();
        });
    });

    describe('cache behavior', () => {
        it('should handle cache hits and misses correctly', () => {
            cache.set('test-key', 'test-value');

            // First access should be a hit
            const result1 = cache.get('test-key');
            expect(result1).toBe('test-value');

            // Non-existent key should be a miss
            const result2 = cache.get('nonexistent-key');
            expect(result2).toBeNull();
        });

        it('should handle cache expiration correctly', () => {
            // Mock Date.now to control time
            const originalNow = Date.now;
            Date.now = jest.fn().mockReturnValue(1000);

            cache.set('test-key', 'test-value', 100); // 100ms TTL

            // Before expiration
            const result1 = cache.get('test-key');
            expect(result1).toBe('test-value');

            // After expiration
            Date.now = jest.fn().mockReturnValue(2000);
            const result2 = cache.get('test-key');
            expect(result2).toBeNull();

            // Restore Date.now
            Date.now = originalNow;
        });
    });
});

