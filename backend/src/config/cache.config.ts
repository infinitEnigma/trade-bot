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
    BALANCE_CACHE: number; // 30 seconds - account balances

    // Temporary data
    TEMP_DATA_DEFAULT: number; // 5 minutes - general temporary data
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
 * Get appropriate cache TTL configuration based on environment
 */
export function getCacheConfig(): CacheTTLConfig {
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction ? CACHE_TTL : CACHE_TTL_DEV;
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
