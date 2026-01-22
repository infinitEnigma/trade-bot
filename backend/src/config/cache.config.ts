/**
 * Centralized Cache Configuration
 *
 * Defines TTL strategies and cache policies for consistent caching across the application.
 * This ensures uniform cache invalidation and prevents stale data issues.
 */

export interface CacheTTLConfig {
    // Session and authentication data
    SESSION: number; // 4 hours - matches JWT expiry
    REFRESH_TOKEN: number; // 30 days - matches refresh token expiry
    JWT_BLACKLIST: number; // Variable - based on token expiry

    // Market data (real-time)
    MARKET_TICK: number; // 60 seconds - high frequency updates
    MARKET_MARK_PRICE: number; // 30 seconds - very high frequency
    MARKET_KLINES_SHORT: number; // 5 minutes - 1m, 5m intervals
    MARKET_KLINES_MEDIUM: number; // 15 minutes - 15m, 30m intervals
    MARKET_KLINES_LONG: number; // 1 hour - 1h, 4h intervals
    MARKET_FUTURES: number; // 10 minutes - less volatile
    MARKET_TRADINGVIEW_CONFIG: number; // 5 minutes - rarely changes

    // Rate limiting
    RATE_LIMIT_AUTH: number; // 15 minutes - strict auth limits
    RATE_LIMIT_MARKET: number; // 1 minute - moderate market limits
    RATE_LIMIT_TRADING: number; // 1 minute - strict trading limits
    RATE_LIMIT_GENERAL: number; // 1 minute - general API limits

    // Application data
    CREDENTIAL_CACHE: number; // 5 minutes - encrypted credentials
    POSITION_CACHE: number; // 30 seconds - trading positions
    BALANCE_CACHE: number; // 30 seconds - account balance data

    // Temporary data
    TEMP_DATA_DEFAULT: number; // 5 minutes - general temporary data
}

/**
 * Data freshness configuration for smart polling
 * Defines expected update frequencies for different data types
 */
export interface DataFreshnessConfig {
    // Market data update frequencies (in milliseconds)
    MARKET_REALTIME: number; // WebSocket data (seconds)
    MARKET_HIGH_FREQ: number; // High frequency (30 seconds)
    MARKET_MEDIUM_FREQ: number; // Medium frequency (5 minutes)
    MARKET_LOW_FREQ: number; // Low frequency (15 minutes)
    MARKET_STATIC: number; // Static data (30 minutes)

    // Frontend polling guidance (recommended intervals in milliseconds)
    POLL_REALTIME: number; // 10 seconds for real-time data
    POLL_HIGH_FREQ: number; // 30 seconds for high frequency
    POLL_MEDIUM_FREQ: number; // 5 minutes for medium frequency
    POLL_LOW_FREQ: number; // 15 minutes for low frequency
    POLL_STATIC: number; // 30 minutes for static data

    // Staleness thresholds (when to consider data stale)
    STALE_THRESHOLD_REALTIME: number; // 30 seconds
    STALE_THRESHOLD_HIGH_FREQ: number; // 2 minutes
    STALE_THRESHOLD_MEDIUM_FREQ: number; // 10 minutes
    STALE_THRESHOLD_LOW_FREQ: number; // 30 minutes
}

/**
 * Production cache TTL values (in seconds)
 * These are carefully chosen based on data volatility and business requirements.
 */
export const CACHE_TTL: CacheTTLConfig = {
    // Session and authentication data
    SESSION: 4 * 60 * 60, // 4 hours - matches JWT access token expiry
    REFRESH_TOKEN: 30 * 24 * 60 * 60, // 30 days - matches refresh token expiry
    JWT_BLACKLIST: 30 * 24 * 60 * 60, // 30 days - matches longest token expiry

    // Market data (real-time trading data)
    MARKET_TICK: 60, // 1 minute - high frequency price updates
    MARKET_MARK_PRICE: 30, // 30 seconds - very high frequency mark prices
    MARKET_KLINES_SHORT: 5 * 60, // 5 minutes - 1m, 5m candlestick data
    MARKET_KLINES_MEDIUM: 15 * 60, // 15 minutes - 15m, 30m candlestick data
    MARKET_KLINES_LONG: 60 * 60, // 1 hour - 1h, 4h candlestick data
    MARKET_FUTURES: 10 * 60, // 10 minutes - futures contract data (less volatile)
    MARKET_TRADINGVIEW_CONFIG: 5 * 60, // 5 minutes - TV widget config (rarely changes)

    // Rate limiting (must align with business rules)
    RATE_LIMIT_AUTH: 15 * 60, // 15 minutes - strict authentication limits
    RATE_LIMIT_MARKET: 60, // 1 minute - moderate market data limits
    RATE_LIMIT_TRADING: 60, // 1 minute - strict trading operation limits
    RATE_LIMIT_GENERAL: 60, // 1 minute - general API rate limits

    // Application data
    CREDENTIAL_CACHE: 5 * 60, // 5 minutes - encrypted API credentials
    POSITION_CACHE: 30, // 30 seconds - open trading positions
    BALANCE_CACHE: 30, // 30 seconds - account balance data

    // Temporary data
    TEMP_DATA_DEFAULT: 5 * 60, // 5 minutes - general temporary data
};

/**
 * Development cache TTL values (shorter for faster iteration)
 * These are reduced for development but maintain the same relative ratios.
 */
export const CACHE_TTL_DEV: CacheTTLConfig = {
    // Session and authentication data
    SESSION: 60 * 60, // 1 hour in dev
    REFRESH_TOKEN: 7 * 24 * 60 * 60, // 7 days in dev
    JWT_BLACKLIST: 7 * 24 * 60 * 60, // 7 days in dev

    // Market data
    MARKET_TICK: 30, // 30 seconds in dev
    MARKET_MARK_PRICE: 15, // 15 seconds in dev
    MARKET_KLINES_SHORT: 2 * 60, // 2 minutes in dev
    MARKET_KLINES_MEDIUM: 5 * 60, // 5 minutes in dev
    MARKET_KLINES_LONG: 15 * 60, // 15 minutes in dev
    MARKET_FUTURES: 5 * 60, // 5 minutes in dev
    MARKET_TRADINGVIEW_CONFIG: 2 * 60, // 2 minutes in dev

    // Rate limiting
    RATE_LIMIT_AUTH: 5 * 60, // 5 minutes in dev
    RATE_LIMIT_MARKET: 30, // 30 seconds in dev
    RATE_LIMIT_TRADING: 30, // 30 seconds in dev
    RATE_LIMIT_GENERAL: 30, // 30 seconds in dev

    // Application data
    CREDENTIAL_CACHE: 2 * 60, // 2 minutes in dev
    POSITION_CACHE: 15, // 15 seconds in dev
    BALANCE_CACHE: 15, // 15 seconds in dev

    // Temporary data
    TEMP_DATA_DEFAULT: 2 * 60, // 2 minutes in dev
};

/**
 * Data freshness configuration values
 * Defines expected update frequencies and polling guidance for smart frontend polling
 * Adjusted for more frequent price updates since price data is more available than initially assumed
 */
export const DATA_FRESHNESS: DataFreshnessConfig = {
    // Market data update frequencies (in milliseconds) - MORE FREQUENT FOR PRICE DATA
    MARKET_REALTIME: 2000, // WebSocket data updates every 2 seconds (price is very available)
    MARKET_HIGH_FREQ: 10000, // High frequency data (10 seconds) - increased from 30s
    MARKET_MEDIUM_FREQ: 60000, // Medium frequency (1 minute) - increased from 5min for charts
    MARKET_LOW_FREQ: 300000, // Low frequency (5 minutes) - reduced from 15min
    MARKET_STATIC: 900000, // Static data (15 minutes) - reduced from 30min

    // Frontend polling guidance (recommended intervals in milliseconds) - MORE AGGRESSIVE POLLING
    POLL_REALTIME: 5000, // Poll every 5 seconds for real-time data (price charts need frequent updates)
    POLL_HIGH_FREQ: 15000, // Poll every 15 seconds for high frequency (good balance)
    POLL_MEDIUM_FREQ: 30000, // Poll every 30 seconds for medium frequency (charts need updates)
    POLL_LOW_FREQ: 120000, // Poll every 2 minutes for low frequency
    POLL_STATIC: 300000, // Poll every 5 minutes for static data

    // Staleness thresholds (when to consider data stale) - MORE LENIENT
    STALE_THRESHOLD_REALTIME: 15000, // 15 seconds for real-time (was 30s)
    STALE_THRESHOLD_HIGH_FREQ: 60000, // 1 minute for high frequency (was 2min)
    STALE_THRESHOLD_MEDIUM_FREQ: 120000, // 2 minutes for medium frequency (was 10min)
    STALE_THRESHOLD_LOW_FREQ: 600000, // 10 minutes for low frequency (was 30min)
};

/**
 * Combined configuration interface
 */
export interface FullCacheConfig extends CacheTTLConfig {
    freshness: DataFreshnessConfig;
}

/**
 * Get appropriate cache TTL configuration based on environment
 */
export function getCacheConfig(): CacheTTLConfig {
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction ? CACHE_TTL : CACHE_TTL_DEV;
}

/**
 * Get full cache configuration including data freshness
 */
export function getFullCacheConfig(): FullCacheConfig {
    const ttlConfig = getCacheConfig();
    return {
        ...ttlConfig,
        freshness: DATA_FRESHNESS,
    };
}

/**
 * Get TTL for specific cache key pattern
 */
export function getTTLForKey(key: string): number {
    const config = getCacheConfig();

    // Session and auth
    if (key.startsWith('user:') && key.includes('session')) return config.SESSION;
    if (key.startsWith('jwt:blacklist:')) return config.JWT_BLACKLIST;

    // Market data
    if (key.startsWith('tick:')) return config.MARKET_TICK;
    if (key.startsWith('markprice:')) return config.MARKET_MARK_PRICE;
    if (key.startsWith('kline:') && key.includes('1m')) return config.MARKET_KLINES_SHORT;
    if (key.startsWith('kline:') && key.includes('5m')) return config.MARKET_KLINES_SHORT;
    if (key.startsWith('kline:') && key.includes('15m')) return config.MARKET_KLINES_MEDIUM;
    if (key.startsWith('kline:') && key.includes('30m')) return config.MARKET_KLINES_MEDIUM;
    if (key.startsWith('kline:') && key.includes('1h')) return config.MARKET_KLINES_LONG;
    if (key.startsWith('futures:')) return config.MARKET_FUTURES;
    if (key.startsWith('tv:config')) return config.MARKET_TRADINGVIEW_CONFIG;

    // Rate limiting
    if (key.startsWith('ratelimit:auth:')) return config.RATE_LIMIT_AUTH;
    if (key.startsWith('ratelimit:market:')) return config.RATE_LIMIT_MARKET;
    if (key.startsWith('ratelimit:trading:')) return config.RATE_LIMIT_TRADING;
    if (key.startsWith('ratelimit:')) return config.RATE_LIMIT_GENERAL;

    // Application data
    if (key.startsWith('credential:')) return config.CREDENTIAL_CACHE;
    if (key.startsWith('position:')) return config.POSITION_CACHE;
    if (key.startsWith('balance:')) return config.BALANCE_CACHE;

    // Temporary data
    if (key.startsWith('cache:')) return config.TEMP_DATA_DEFAULT;

    // Default fallback
    return config.TEMP_DATA_DEFAULT;
}

/**
 * Cache key patterns for consistent naming
 */
export const CACHE_KEYS = {
    // Session and auth
    session: (userId: string) => `user:${userId}:session`,
    jwtBlacklist: (tokenHash: string) => `jwt:blacklist:${tokenHash}`,

    // Market data
    tick: (symbol: string) => `tick:${symbol}`,
    markPrice: (symbol: string) => `markprice:${symbol}`,
    kline: (symbol: string, interval: string) => `kline:${symbol}:${interval}`,
    futures: (symbol: string) => `futures:${symbol}`,
    tradingViewConfig: () => 'tv:config',

    // Rate limiting
    rateLimit: (endpoint: string, identifier: string) => `ratelimit:${endpoint}:${identifier}`,

    // Application data
    credential: (userId: string) => `credential:${userId}`,
    position: (userId: string) => `position:${userId}`,
    balance: (userId: string) => `balance:${userId}`,

    // Temporary data
    temp: (key: string) => `cache:${key}`,
};

/**
 * Cache invalidation event types
 */
export const CACHE_EVENTS = {
    INVALIDATED: 'cache:invalidated',
    REFRESHED: 'cache:refreshed',
    CLEARED: 'cache:cleared',
} as const;

/**
 * Cache invalidation payload
 */
export interface CacheInvalidationEvent {
    type: typeof CACHE_EVENTS.INVALIDATED;
    keys: string[];
    reason: string;
    timestamp: number;
    userId?: string;
}

/**
 * Cache refresh payload
 */
export interface CacheRefreshEvent {
    type: typeof CACHE_EVENTS.REFRESHED;
    keys: string[];
    timestamp: number;
    userId?: string;
}

/**
 * Cache clear payload
 */
export interface CacheClearEvent {
    type: typeof CACHE_EVENTS.CLEARED;
    pattern: string;
    keysCleared: number;
    timestamp: number;
    userId?: string;
}

export type CacheEvent = CacheInvalidationEvent | CacheRefreshEvent | CacheClearEvent;
