/**
 * ===========================================
 * 🧪 CACHE CONFIGURATION - Unit Tests
 * ===========================================
 *
 * Tests for centralized cache configuration management
 *
 * @format
 */

import {
    getCacheConfig,
    getFullCacheConfig,
    getTTLForKey,
    CACHE_KEYS,
    CACHE_EVENTS,
    CACHE_TTL,
    CACHE_TTL_DEV,
    DATA_FRESHNESS,
} from '../../src/config/cache.config';

describe('CacheConfig', () => {
    describe('Environment-specific configuration', () => {
        it('should return production configuration when NODE_ENV is production', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            // Act
            const config = getCacheConfig();

            // Assert
            expect(config).toEqual(CACHE_TTL);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });

        it('should return development configuration when NODE_ENV is development', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            // Act
            const config = getCacheConfig();

            // Assert
            expect(config).toEqual(CACHE_TTL_DEV);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });

        it('should default to development configuration for unknown environment', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            // Act
            const config = getCacheConfig();

            // Assert
            expect(config).toEqual(CACHE_TTL_DEV);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('Full cache configuration', () => {
        it('should include both TTL and data freshness configuration', () => {
            // Act
            const config = getFullCacheConfig();

            // Assert
            expect(config.freshness).toEqual(DATA_FRESHNESS);
            expect(config.SESSION).toBeGreaterThan(0);
            expect(config.MARKET_TICK).toBeGreaterThan(0);
        });

        it('should have consistent TTL values across environments', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;

            // Test production TTL values
            process.env.NODE_ENV = 'production';
            const prodConfig = getFullCacheConfig();

            // Test development TTL values
            process.env.NODE_ENV = 'development';
            const devConfig = getFullCacheConfig();

            // Cleanup
            process.env.NODE_ENV = originalEnv;

            // Assert production TTLs are longer than development
            expect(prodConfig.SESSION).toBeGreaterThan(devConfig.SESSION);
            expect(prodConfig.REFRESH_TOKEN).toBeGreaterThan(devConfig.REFRESH_TOKEN);
            expect(prodConfig.MARKET_TICK).toBeLessThanOrEqual(devConfig.MARKET_TICK);
        });
    });

    describe('Data freshness configuration', () => {
        it('should have valid data freshness properties', () => {
            // Assert
            expect(DATA_FRESHNESS.MARKET_REALTIME).toBeGreaterThan(0);
            expect(DATA_FRESHNESS.MARKET_HIGH_FREQ).toBeGreaterThan(DATA_FRESHNESS.MARKET_REALTIME);
            expect(DATA_FRESHNESS.MARKET_MEDIUM_FREQ).toBeGreaterThan(DATA_FRESHNESS.MARKET_HIGH_FREQ);
            expect(DATA_FRESHNESS.MARKET_LOW_FREQ).toBeGreaterThan(DATA_FRESHNESS.MARKET_MEDIUM_FREQ);
            expect(DATA_FRESHNESS.MARKET_STATIC).toBeGreaterThan(DATA_FRESHNESS.MARKET_LOW_FREQ);

            expect(DATA_FRESHNESS.POLL_REALTIME).toBeGreaterThan(0);
            expect(DATA_FRESHNESS.POLL_HIGH_FREQ).toBeGreaterThan(DATA_FRESHNESS.POLL_REALTIME);
            expect(DATA_FRESHNESS.POLL_MEDIUM_FREQ).toBeGreaterThan(DATA_FRESHNESS.POLL_HIGH_FREQ);
            expect(DATA_FRESHNESS.POLL_LOW_FREQ).toBeGreaterThan(DATA_FRESHNESS.POLL_MEDIUM_FREQ);
            expect(DATA_FRESHNESS.POLL_STATIC).toBeGreaterThan(DATA_FRESHNESS.POLL_LOW_FREQ);

            expect(DATA_FRESHNESS.STALE_THRESHOLD_REALTIME).toBeGreaterThan(DATA_FRESHNESS.POLL_REALTIME);
            expect(DATA_FRESHNESS.STALE_THRESHOLD_HIGH_FREQ).toBeGreaterThan(DATA_FRESHNESS.POLL_HIGH_FREQ);
            expect(DATA_FRESHNESS.STALE_THRESHOLD_MEDIUM_FREQ).toBeGreaterThan(DATA_FRESHNESS.POLL_MEDIUM_FREQ);
            expect(DATA_FRESHNESS.STALE_THRESHOLD_LOW_FREQ).toBeGreaterThan(DATA_FRESHNESS.POLL_LOW_FREQ);
            // Note: STALE_THRESHOLD_STATIC is not explicitly defined in the current interface
        });
    });

    describe('TTL key mapping', () => {
        it('should return correct TTL for session keys', () => {
            const config = getCacheConfig();
            const sessionKey = CACHE_KEYS.session('user123');
            expect(getTTLForKey(sessionKey)).toBe(config.SESSION);
        });

        it('should return correct TTL for JWT blacklist keys', () => {
            const config = getCacheConfig();
            const blacklistKey = CACHE_KEYS.jwtBlacklist('tokenhash123');
            expect(getTTLForKey(blacklistKey)).toBe(config.JWT_BLACKLIST);
        });

        it('should return correct TTL for market data keys', () => {
            const config = getCacheConfig();

            expect(getTTLForKey(CACHE_KEYS.tick('BTCUSDT'))).toBe(config.MARKET_TICK);
            expect(getTTLForKey(CACHE_KEYS.markPrice('BTCUSDT'))).toBe(config.MARKET_MARK_PRICE);
            expect(getTTLForKey(CACHE_KEYS.futures('BTCUSDT'))).toBe(config.MARKET_FUTURES);
            expect(getTTLForKey(CACHE_KEYS.tradingViewConfig())).toBe(config.MARKET_TRADINGVIEW_CONFIG);
        });

        it('should return correct TTL for kline keys with different intervals in production', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            // Act
            const config = getCacheConfig();
            const ttl1m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '1m'));
            const ttl5m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '5m'));
            const ttl15m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '15m'));
            const ttl30m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '30m'));
            const ttl1h = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '1h'));

            // Assert
            expect(ttl1m).toBe(config.MARKET_KLINES_SHORT);
            expect(ttl5m).toBe(config.MARKET_KLINES_SHORT);
            expect(ttl15m).toBe(config.MARKET_KLINES_MEDIUM);
            expect(ttl30m).toBe(config.MARKET_KLINES_MEDIUM);
            expect(ttl1h).toBe(config.MARKET_KLINES_LONG);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });

        it('should return correct TTL for kline keys with different intervals in development', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            // Act
            const config = getCacheConfig();
            const ttl1m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '1m'));
            const ttl5m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '5m'));
            const ttl15m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '15m'));
            const ttl30m = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '30m'));
            const ttl1h = getTTLForKey(CACHE_KEYS.kline('BTCUSDT', '1h'));

            // Assert
            expect(ttl1m).toBe(config.MARKET_KLINES_SHORT);
            expect(ttl5m).toBe(config.MARKET_KLINES_SHORT);
            expect(ttl15m).toBe(config.MARKET_KLINES_MEDIUM);
            expect(ttl30m).toBe(config.MARKET_KLINES_MEDIUM);
            expect(ttl1h).toBe(config.MARKET_KLINES_LONG);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });

        it('should return correct TTL for rate limiting keys', () => {
            const config = getCacheConfig();

            expect(getTTLForKey(CACHE_KEYS.rateLimit('auth', '127.0.0.1'))).toBe(config.RATE_LIMIT_AUTH);
            expect(getTTLForKey(CACHE_KEYS.rateLimit('market', '127.0.0.1'))).toBe(config.RATE_LIMIT_MARKET);
            expect(getTTLForKey(CACHE_KEYS.rateLimit('trading', '127.0.0.1'))).toBe(config.RATE_LIMIT_TRADING);
            expect(getTTLForKey(CACHE_KEYS.rateLimit('general', '127.0.0.1'))).toBe(config.RATE_LIMIT_GENERAL);
        });

        it('should return correct TTL for application data keys', () => {
            const config = getCacheConfig();

            expect(getTTLForKey(CACHE_KEYS.credential('user123'))).toBe(config.CREDENTIAL_CACHE);
            expect(getTTLForKey(CACHE_KEYS.position('user123'))).toBe(config.POSITION_CACHE);
            expect(getTTLForKey(CACHE_KEYS.balance('user123'))).toBe(config.BALANCE_CACHE);
        });

        it('should return default TTL for temporary data keys', () => {
            const config = getCacheConfig();
            const tempKey = CACHE_KEYS.temp('tempdata123');
            expect(getTTLForKey(tempKey)).toBe(config.TEMP_DATA_DEFAULT);
        });

        it('should return default TTL for unknown keys', () => {
            const config = getCacheConfig();
            expect(getTTLForKey('unknown:key')).toBe(config.TEMP_DATA_DEFAULT);
        });
    });

    describe('Cache key generation', () => {
        it('should generate valid session keys', () => {
            const userId = 'user123';
            const key = CACHE_KEYS.session(userId);
            expect(key).toContain('user:');
            expect(key).toContain('session');
            expect(key).toContain(userId);
        });

        it('should generate valid JWT blacklist keys', () => {
            const tokenHash = 'tokenhash123';
            const key = CACHE_KEYS.jwtBlacklist(tokenHash);
            expect(key).toContain('jwt:blacklist:');
            expect(key).toContain(tokenHash);
        });

        it('should generate valid market data keys', () => {
            const symbol = 'BTCUSDT';
            expect(CACHE_KEYS.tick(symbol)).toContain(symbol);
            expect(CACHE_KEYS.markPrice(symbol)).toContain(symbol);
            expect(CACHE_KEYS.futures(symbol)).toContain(symbol);
            expect(CACHE_KEYS.tradingViewConfig()).toBe('tv:config');
        });

        it('should generate valid kline keys', () => {
            const symbol = 'BTCUSDT';
            const interval = '1m';
            const key = CACHE_KEYS.kline(symbol, interval);
            expect(key).toContain(symbol);
            expect(key).toContain(interval);
        });

        it('should generate valid rate limiting keys', () => {
            const endpoint = 'auth';
            const identifier = '127.0.0.1';
            const key = CACHE_KEYS.rateLimit(endpoint, identifier);
            expect(key).toContain('ratelimit:');
            expect(key).toContain(endpoint);
            expect(key).toContain(identifier);
        });

        it('should generate valid application data keys', () => {
            const userId = 'user123';
            expect(CACHE_KEYS.credential(userId)).toContain(userId);
            expect(CACHE_KEYS.position(userId)).toContain(userId);
            expect(CACHE_KEYS.balance(userId)).toContain(userId);
        });

        it('should generate valid temporary data keys', () => {
            const tempKey = 'tempdata123';
            const key = CACHE_KEYS.temp(tempKey);
            expect(key).toContain('cache:');
            expect(key).toContain(tempKey);
        });
    });

    describe('Cache events', () => {
        it('should have correct cache event types', () => {
            expect(CACHE_EVENTS.INVALIDATED).toBe('cache:invalidated');
            expect(CACHE_EVENTS.REFRESHED).toBe('cache:refreshed');
            expect(CACHE_EVENTS.CLEARED).toBe('cache:cleared');
        });
    });
});