/**
 * ===========================================
 * ⚙️ RATE LIMITER CONFIGURATIONS - Centralized Setup
 * ===========================================
 *
 * Centralized configuration for all endpoint rate limiting.
 * Easily adjust rates across domains by modifying values here.
 *
 * Features:
 * - Environment-aware limits (dev vs prod)
 * - User tier differentiation (Basic/Registered/Verified)
 * - Fail-open/fail-closed behavior per endpoint
 * - Progressive backoff settings for auth endpoints
 *
 * To modify rates globally:
 * 1. Adjust base multipliers in environment-specific sections
 * 2. Modify user tier ratios
 * 3. Update window durations
 * 4. Change fail-open/fail-closed policies
 *
 * @format
 */

import { UserLevel } from "@trade-bot/shared";
import { RateLimitConfig } from "./rate-limit.types";

/**
 * Environment-based rate limit multipliers.
 * Higher values = more permissive limits
 */
const ENVIRONMENT_MULTIPLIERS = {
    development: 10, // 10x more permissive in dev
    production: 1,   // Baseline for production
} as const;

/**
 * User tier rate limit ratios.
 * Multipliers applied to base limits for different user levels.
 */
const USER_TIER_RATIOS = {
    [UserLevel.BASIC]: 1,       // Baseline limits
    [UserLevel.REGISTERED]: 1.5, // 50% more than basic
    [UserLevel.VERIFIED]: 5,   // 2.5x more than basic
} as const;

/**
 * Base rate limits per minute for different endpoint categories.
 * These are the foundation values that get multiplied by environment and user factors.
 */
const BASE_RATE_LIMITS = {
    // Authentication - balanced limits for legitimate users
    auth: {
        windowMs: 5 * 60 * 1000, // ⬆️ 5 minutes (shorter window)
        max: 50, // ⬆️ 50 attempts per 5 minutes (more attempts for development/testing)
    },

    // Public endpoints - lenient, fail-open
    public: {
        windowMs: 60 * 1000, // 1 minute
        max: 1000, // 1000 requests per minute
    },

    // Market data - permissive for real-time charts
    market: {
        windowMs: 60 * 1000, // 1 minute
        max: 10000, // ⬆️ 100,000 requests per minute (very permissive for charts)
    },

    // Trading endpoints - strict, user-based, fail-closed
    trading: {
        windowMs: 60 * 1000, // 1 minute
        max: 60, // 10 requests per minute (IP limit)
    },

    // Balance endpoints - moderate, user-based
    balance: {
        windowMs: 60 * 1000, // 1 minute
        max: 30, // 60 requests per minute (IP limit)
    },

    // WebSocket connections - lenient, user-based, fail-open
    websocket: {
        windowMs: 60 * 1000, // 1 minute
        max: 100, // 100 subscriptions per minute (IP limit)
    },

    // Bot instance management - moderate, user-based
    botInstances: {
        windowMs: 60 * 1000, // 1 minute
        max: 10, // 30 requests per minute (IP limit)
    },

    // Kodiak status endpoints - very lenient, fail-open
    kodiakStatus: {
        windowMs: 60 * 1000, // 1 minute
        max: 600, // ⬆️ 300 requests per minute (5 req/sec for real-time updates)
    },

    // Kodiak API calls - moderate limits for connection process
    kodiakApi: {
        windowMs: 60000, // 1 minute
        max: 600, // 20 requests per minute for connection operations
    },

    // Kodiak data endpoints - trading data with user-based limits
    kodiakData: {
        windowMs: 60000, // 1 minute
        max: 60, // 60 requests per minute (1 req/sec for trading data)
    },
} as const;

/**
 * Get environment multiplier for rate limits
 */
function getEnvironmentMultiplier(): number {
    const env = process.env.NODE_ENV || 'development';
    return ENVIRONMENT_MULTIPLIERS[env as keyof typeof ENVIRONMENT_MULTIPLIERS] || 1;
}

/**
 * Calculate user-based limits for a given base limit
 */
function calculateUserLimits(baseMax: number): Record<UserLevel, number> {
    const multiplier = getEnvironmentMultiplier();
    const adjustedBase = Math.round(baseMax * multiplier);

    return {
        [UserLevel.BASIC]: adjustedBase,
        [UserLevel.REGISTERED]: Math.round(adjustedBase * USER_TIER_RATIOS[UserLevel.REGISTERED]),
        [UserLevel.VERIFIED]: Math.round(adjustedBase * USER_TIER_RATIOS[UserLevel.VERIFIED]),
    };
}

/**
 * Create a rate limit configuration with environment and user adjustments
 */
function createRateLimitConfig(
    baseConfig: typeof BASE_RATE_LIMITS[keyof typeof BASE_RATE_LIMITS],
    options: {
        enableUserBasedLimits?: boolean;
        failOpen?: boolean;
        progressiveBackoff?: boolean;
        maxProgressiveDelay?: number;
        progressiveBaseDelay?: number;
        customMessage?: string;
    } = {}
): RateLimitConfig {
    const multiplier = getEnvironmentMultiplier();
    const adjustedMax = Math.round(baseConfig.max * multiplier);

    const config: RateLimitConfig = {
        windowMs: baseConfig.windowMs,
        max: adjustedMax,
        message: options.customMessage,
        failOpen: options.failOpen,
        progressiveBackoff: options.progressiveBackoff,
        maxProgressiveDelay: options.maxProgressiveDelay,
        progressiveBaseDelay: options.progressiveBaseDelay,
    };

    if (options.enableUserBasedLimits) {
        config.enableUserBasedLimits = true;
        config.userLimits = calculateUserLimits(baseConfig.max);
    }

    return config;
}

/**
 * Predefined rate limiter configurations with environment-aware and user-based settings.
 * Modify the constants above to adjust rates globally across all endpoints.
 */
export const RATE_LIMIT_CONFIGS = {
    /**
     * Authentication endpoints - strict limits with progressive backoff
     * Prevents brute force attacks while allowing legitimate retries
     */
    auth: createRateLimitConfig(BASE_RATE_LIMITS.auth, {
        progressiveBackoff: false, // Disabled to prevent false lockouts from persistent Redis counters
        maxProgressiveDelay: 5 * 60 * 1000, // 5 minutes max delay
        progressiveBaseDelay: 1000, // 1 second base delay
        customMessage: "Too many login attempts, please try again later",
    }),

    /**
     * Public endpoints - lenient limits, fail-open for availability
     * Allows high traffic for public-facing features
     */
    public: createRateLimitConfig(BASE_RATE_LIMITS.public, {
        failOpen: true, // Allow requests if Redis fails - public data should be available
        customMessage: "Too many requests to this endpoint",
    }),

    /**
     * Market data endpoints - moderate user-based limits
     * Higher limits for premium users, fail-closed for data integrity
     */
    market: createRateLimitConfig(BASE_RATE_LIMITS.market, {
        enableUserBasedLimits: true,
        failOpen: false, // Block if rate limiting fails - financial data integrity
        customMessage: "Market data rate limit exceeded",
    }),

    /**
     * Trading endpoints - strict user-based limits, fail-closed
     * Critical financial operations require strict rate limiting
     */
    trading: createRateLimitConfig(BASE_RATE_LIMITS.trading, {
        enableUserBasedLimits: true,
        failOpen: false, // Critical security - block if rate limiting fails
        customMessage: "Trading rate limit exceeded",
    }),

    /**
     * Balance endpoints - moderate user-based limits
     * Financial data with appropriate user tier differentiation
     */
    balance: createRateLimitConfig(BASE_RATE_LIMITS.balance, {
        enableUserBasedLimits: true,
        failOpen: false, // Financial data - block if rate limiting fails
        customMessage: "Balance refresh rate limit exceeded",
    }),

    /**
     * WebSocket connections - lenient user-based limits, fail-open
     * Real-time data should be available even during Redis issues
     */
    websocket: createRateLimitConfig(BASE_RATE_LIMITS.websocket, {
        enableUserBasedLimits: true,
        failOpen: true, // Real-time data - allow if Redis fails
        customMessage: "WebSocket subscription rate limit exceeded",
    }),

    /**
     * Bot instance management - moderate user-based limits
     * Bot operations with appropriate user tier controls
     */
    botInstances: createRateLimitConfig(BASE_RATE_LIMITS.botInstances, {
        enableUserBasedLimits: true,
        failOpen: false, // Bot data - block if rate limiting fails
        customMessage: "Bot instances rate limit exceeded",
    }),

    /**
     * Kodiak status endpoints - very lenient, fail-open
     * System status checks should always be available
     */
    kodiakStatus: createRateLimitConfig(BASE_RATE_LIMITS.kodiakStatus, {
        enableUserBasedLimits: true,
        failOpen: true, // Allow if Redis fails - just DB queries
        customMessage: "Kodiak status rate limit exceeded",
    }),

    /**
     * Kodiak connection endpoints - relaxed limits for frontend compatibility
     * Prevents 400 errors while allowing reasonable request frequency
     */
    kodiakConnection: createRateLimitConfig(BASE_RATE_LIMITS.kodiakApi, {
        failOpen: true, // Allow requests if rate limiting fails - prioritize UX
        customMessage: "Kodiak connection rate limit exceeded",
    }),

    /**
     * Kodiak API calls - relaxed limits for frontend compatibility
     * Prevents 400 errors while allowing reasonable request frequency
     */
    kodiakApi: createRateLimitConfig(BASE_RATE_LIMITS.kodiakApi, {
        failOpen: true, // ⬆️ Allow requests if rate limiting fails - prioritize UX
        customMessage: "Kodiak API rate limit exceeded",
    }),
} as const;

/**
 * Get all available rate limit configuration keys
 */
export type RateLimitConfigKey = keyof typeof RATE_LIMIT_CONFIGS;

/**
 * Utility functions for rate limit configuration management
 */
export const RateLimitConfigUtils = {
    /**
     * Get current environment multiplier
     */
    getEnvironmentMultiplier,

    /**
     * Get user tier ratios
     */
    getUserTierRatios: () => USER_TIER_RATIOS,
};

/**
 * Rate limit configuration for Kodiak connection attempts
 * Relaxed limits for frontend compatibility and user experience
 */
export const kodiakConnectionRateLimit: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    max: 60, // ⬆️ 60 connection attempts per minute (1 per second)
    progressiveBackoff: false, // Disabled to prevent false lockouts
    maxProgressiveDelay: 300000, // 5 minutes max delay (if enabled)
    progressiveBaseDelay: 1000, // 1 second base delay (if enabled)
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    message: "Too many Kodiak connection attempts. Please wait before trying again.",
    failOpen: true, // ⬆️ Allow requests if rate limiting fails - prioritize UX
};

/**
 * Rate limit configuration for Kodiak status checks
 * Reduced limits for status operations
 */
export const kodiakSyncedRateLimit: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    max: 20, // Reduced from 60 to 20 for status checks
    progressiveBackoff: true,
    maxProgressiveDelay: 300000, // 5 minutes max delay
    progressiveBaseDelay: 1000, // 1 second base delay
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    message: "Too many Kodiak status requests, please try again later.",
    failOpen: true, // Allow if Redis fails - just status checks
};

/**
 * Rate limit configuration for Kodiak endpoints (legacy)
 */
export const kodiakRateLimit: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    max: 60, // 60 requests per minute
    progressiveBackoff: true,
    maxProgressiveDelay: 300000, // 5 minutes max delay
    progressiveBaseDelay: 1000, // 1 second base delay
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    message: "Too many Kodiak requests, please try again later.",
    failOpen: true, // Allow if Redis fails - legacy compatibility
};
