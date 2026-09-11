/**
 * ===========================================
 * 📋 RATE LIMIT CONFIGURATION - Type Definitions
 * ===========================================
 *
 * @format
 */

import { UserLevel } from "@trade-bot/shared";

/**
 * Configuration interface for rate limiting behavior.
 * Supports various strategies including user-based limits, progressive backoff,
 * and fail-open/fail-closed behaviors.
 */
export interface RateLimitConfig {
    /** Time window in milliseconds for rate limiting */
    windowMs: number;

    /** Maximum requests allowed in the time window */
    max: number;

    /** Custom error message when limit is exceeded */
    message?: string;

    /** Don't count successful responses toward limit (future feature) */
    skipSuccessfulRequests?: boolean;

    /** Don't count failed responses toward limit (future feature) */
    skipFailedRequests?: boolean;

    /**
     * If true, allow requests when Redis fails (default: false)
     * Use for non-critical endpoints where availability is more important than strict rate limiting
     */
    failOpen?: boolean;

    /**
     * User-based rate limiting options
     * Allows different limits for different user tiers
     */
    userLimits?: {
        [UserLevel.BASIC]: number;
        [UserLevel.REGISTERED]: number;
        [UserLevel.VERIFIED]: number;
    };

    /** Enable user-based rate limiting with tier differentiation */
    enableUserBasedLimits?: boolean;

    /** Enable exponential backoff on failures (typically for auth endpoints) */
    progressiveBackoff?: boolean;

    /** Maximum delay in milliseconds for progressive backoff (default: 5 minutes) */
    maxProgressiveDelay?: number;

    /** Base delay for backoff calculation (default: 1 second) */
    progressiveBaseDelay?: number;
}

/**
 * Result interface for rate limit checks
 */
export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;

    /** Remaining requests in current window */
    remaining: number;

    /** When the current rate limit window resets (Unix timestamp) */
    resetTime: number;

    /** Current request count in window */
    current?: number;

    /** Type of limit applied ('user' or 'ip') */
    limitType?: string;

    /** Whether in-memory fallback was used */
    usedFallback?: boolean;

    /** Progressive delay in milliseconds (if applicable) */
    progressiveDelay?: number;
}

/**
 * Statistics interface for rate limiter monitoring
 */
export interface RateLimiterStats {
    /** Number of active rate limit keys being tracked */
    activeKeys: number;

    /** Estimated memory usage in bytes */
    totalMemoryUsage: number;

    /** Whether Redis is currently healthy */
    redisHealthy?: boolean;

    /** Timestamp of last Redis health check */
    lastRedisCheck?: number;
}
