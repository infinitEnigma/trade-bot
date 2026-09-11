/**
 * ===========================================
 * 📊 SHARED CONSTANTS
 * ===========================================
 *
 * Application-wide constants and configuration values
 * used across all domains and infrastructure layers.
 *
 * @format
 */

// ===========================================
// 🔐 SECURITY CONSTANTS
// ===========================================

export const SECURITY = {
    JWT_EXPIRY: '4h',
    JWT_REFRESH_EXPIRY: '30d',
    BCRYPT_ROUNDS: 12,
    CSRF_TOKEN_LENGTH: 32,
} as const;

// ===========================================
// 📊 RATE LIMITING CONSTANTS
// ===========================================

export const RATE_LIMITS = {
    AUTH: {
        WINDOW_MS: 15 * 60 * 1000, // 15 minutes
        MAX_ATTEMPTS: 30, // Development-friendly
    },
    PUBLIC: {
        WINDOW_MS: 15 * 60 * 1000,
        MAX_ATTEMPTS: 100,
    },
    MARKET: {
        WINDOW_MS: 60 * 1000, // 1 minute
        MAX_ATTEMPTS: 300,
    },
    TRADING: {
        WINDOW_MS: 60 * 1000,
        MAX_ATTEMPTS: 60,
    },
    BALANCE: {
        WINDOW_MS: 60 * 1000,
        MAX_ATTEMPTS: 120,
    },
} as const;

// ===========================================
// 🗄️ DATABASE CONSTANTS
// ===========================================

export const DATABASE = {
    POOL_SIZE: 10,
    CONNECTION_TIMEOUT: 60000,
    IDLE_TIMEOUT: 300000,
} as const;

// ===========================================
// 🌐 CACHE CONSTANTS
// ===========================================

export const CACHE = {
    DEFAULT_TTL: 5 * 60 * 1000, // 5 minutes
    LONG_TTL: 60 * 60 * 1000,   // 1 hour
    SHORT_TTL: 60 * 1000,       // 1 minute
} as const;

// ===========================================
// 📡 WEBSOCKET CONSTANTS
// ===========================================

export const WEBSOCKET = {
    HEARTBEAT_INTERVAL: 30000,    // 30 seconds
    RECONNECT_DELAY: 5000,        // 5 seconds
    MAX_RECONNECT_ATTEMPTS: 5,
} as const;

// ===========================================
// 🤖 BOT CONSTANTS
// ===========================================

export const BOT = {
    RECONCILIATION_INTERVAL: 60 * 1000, // 1 minute
    STATUS_CHECK_INTERVAL: 30 * 1000,   // 30 seconds
    MAX_CONCURRENT_BOTS: 10,
} as const;

// ===========================================
// 📊 MONITORING CONSTANTS
// ===========================================

export const MONITORING = {
    METRICS_INTERVAL: 60 * 1000,        // 1 minute
    HEALTH_CHECK_INTERVAL: 30 * 1000,   // 30 seconds
    LOG_RETENTION_DAYS: 30,
} as const;
