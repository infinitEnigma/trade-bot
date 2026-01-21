/**
 * ===========================================
 * 🔄 MEMORY RATE LIMITER - In-Memory Fallback
 * ===========================================
 *
 * Provides in-memory rate limiting as fallback when Redis is unavailable.
 * Features automatic cleanup of expired entries and memory usage tracking.
 *
 * @format
 */

import { logger } from "../../../core/logging";
import { RateLimitResult, RateLimiterStats } from "./rate-limit.types";

/**
 * In-memory representation of a rate limit entry
 */
interface InMemoryRateLimit {
    /** Number of requests made in current window */
    count: number;

    /** Timestamp when this rate limit window expires */
    resetTime: number;
}

/**
 * In-memory rate limiter implementation.
 * Used as fallback when Redis is unavailable or for development/testing.
 *
 * Features:
 * - Automatic cleanup of expired entries every 10 seconds
 * - Memory usage tracking and statistics
 * - Thread-safe operations (single-threaded Node.js)
 */
class MemoryRateLimiter {
    /** Storage for rate limit entries keyed by identifier */
    private limits = new Map<string, InMemoryRateLimit>();

    /** Interval for periodic cleanup of expired entries */
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Clean up expired entries every 10 seconds (more aggressive for memory efficiency)
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 10000);
    }

    /**
     * Check if a request should be allowed based on rate limits
     *
     * @param key - Unique identifier for the rate limit (e.g., 'user:123' or 'ip:192.168.1.1')
     * @param maxRequests - Maximum requests allowed in the window
     * @param windowMs - Time window in milliseconds
     * @returns Rate limit check result
     */
    check(
        key: string,
        maxRequests: number,
        windowMs: number
    ): RateLimitResult {
        const now = Date.now();
        const limit = this.limits.get(key);

        if (!limit || now > limit.resetTime) {
            // First request or expired window - create new entry
            this.limits.set(key, {
                count: 1,
                resetTime: now + windowMs,
            });
            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetTime: now + windowMs,
                current: 1,
                usedFallback: true,
            };
        }

        if (limit.count >= maxRequests) {
            // Rate limit exceeded
            return {
                allowed: false,
                remaining: 0,
                resetTime: limit.resetTime,
                current: limit.count,
                usedFallback: true,
            };
        }

        // Increment counter and allow request
        limit.count++;
        return {
            allowed: true,
            remaining: maxRequests - limit.count,
            resetTime: limit.resetTime,
            current: limit.count,
            usedFallback: true,
        };
    }

    /**
     * Periodic cleanup of expired rate limit entries
     * Runs automatically every 10 seconds
     */
    private cleanup(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, limit] of this.limits.entries()) {
            if (now > limit.resetTime) {
                this.limits.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.debug("Cleaned up expired in-memory rate limits", { cleaned });
        }
    }

    /**
     * Get statistics about current memory usage
     *
     * @returns Statistics about active keys and memory usage
     */
    getStats(): RateLimiterStats {
        return {
            activeKeys: this.limits.size,
            totalMemoryUsage: this.limits.size * (50 + 16 + 8), // Rough estimate: key + object overhead
        };
    }

    /**
     * Clear all rate limit entries
     * Useful for testing or manual reset
     */
    clear(): void {
        this.limits.clear();
    }

    /**
     * Destroy the rate limiter and clean up resources
     * Should be called when shutting down the application
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.clear();
    }
}

// Global in-memory rate limiter instance
const memoryRateLimiter = new MemoryRateLimiter();

export { MemoryRateLimiter, memoryRateLimiter };
