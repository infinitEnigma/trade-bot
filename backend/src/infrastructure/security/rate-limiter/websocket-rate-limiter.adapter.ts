/** @format */

import { IRateLimiter } from "../../../interfaces/websocket";
import { redisService } from "../../cache";
import { memoryRateLimiter } from "./memory-rate-limiter";
import { logger } from "../../../core/logging";
import { WEBSOCKET_CONSTANTS } from "../../messaging/websocket/types";

/**
 * WebSocket Rate Limiter Adapter
 * Implementation of IRateLimiter for WebSocket operations using existing rate limiter infrastructure
 */
export class WebSocketRateLimiter implements IRateLimiter {
    private readonly WINDOW_MS = WEBSOCKET_CONSTANTS.RATE_LIMIT.WINDOW_MS;
    private readonly MAX_REQUESTS = WEBSOCKET_CONSTANTS.RATE_LIMIT.TOKENS_PER_WINDOW;

    constructor() {
        logger.debug("WebSocketRateLimiter initialized", {
            windowMs: this.WINDOW_MS,
            maxRequests: this.MAX_REQUESTS,
        });
    }

    /**
     * Check if user can subscribe (rate limit check)
     */
    async canSubscribe(userId: string): Promise<boolean> {
        const key = `websocket:rate-limit:${userId}`;

        try {
            // Check Redis health
            const redisAvailable = await redisService.isHealthy();

            if (redisAvailable) {
                try {
                    // Use Redis for rate limiting
                    const atomicResult = await redisService.atomicIncrementWithExpiry(
                        key,
                        1,
                        this.WINDOW_MS,
                        3
                    );

                    if (atomicResult.success) {
                        return atomicResult.newValue <= this.MAX_REQUESTS;
                    }
                } catch (redisError) {
                    logger.warn("Redis rate limiting failed, using memory fallback", {
                        userId,
                        error: (redisError as Error).message,
                    });
                }
            }

            // Fallback to memory rate limiter
            const memoryResult = memoryRateLimiter.check(
                key,
                this.MAX_REQUESTS,
                this.WINDOW_MS
            );

            return memoryResult.allowed;
        } catch (error) {
            logger.warn("Rate limiter check failed, allowing request (fail-open)", {
                userId,
                error: (error as Error).message,
            });
            // Fail open - allow request if rate limiter fails
            return true;
        }
    }

    /**
     * Record a subscription (for rate limiting purposes)
     */
    async recordSubscription(userId: string): Promise<void> {
        const key = `websocket:rate-limit:${userId}`;

        try {
            // Check Redis health
            const redisAvailable = await redisService.isHealthy();

            if (redisAvailable) {
                try {
                    // Just increment the counter with expiry
                    await redisService.atomicIncrementWithExpiry(
                        key,
                        1,
                        this.WINDOW_MS,
                        3
                    );
                } catch (redisError) {
                    logger.warn("Redis rate limiting failed, using memory fallback", {
                        userId,
                        error: (redisError as Error).message,
                    });
                }
            } else {
                // Fallback to memory rate limiter
                memoryRateLimiter.check(key, this.MAX_REQUESTS, this.WINDOW_MS);
            }
        } catch (error) {
            logger.warn("Failed to record subscription for rate limiting", {
                userId,
                error: (error as Error).message,
            });
        }
    }

    /**
     * Get rate limit information for a user
     */
    async getRateLimitInfo(userId: string): Promise<{
        used: number;
        remaining: number;
        resetTime: number;
        isBlocked: boolean;
    }> {
        const key = `websocket:rate-limit:${userId}`;
        const now = Date.now();

        try {
            const redisAvailable = await redisService.isHealthy();

            if (redisAvailable) {
                try {
                    const currentResult = await redisService.get(key);
                    const ttlResult = await redisService.ttl(key);

                    if (currentResult.success && currentResult.data !== null) {
                        const used = parseInt(currentResult.data);
                        const remaining = Math.max(0, this.MAX_REQUESTS - used);
                        const resetTime = now + (ttlResult.success ? ttlResult.ttl * 1000 : this.WINDOW_MS);

                        return {
                            used,
                            remaining,
                            resetTime,
                            isBlocked: used > this.MAX_REQUESTS,
                        };
                    }
                } catch (redisError) {
                    logger.warn("Redis rate limit info failed, using memory fallback", {
                        userId,
                        error: (redisError as Error).message,
                    });
                }
            }

            // Fallback to memory rate limiter
            const memoryResult = memoryRateLimiter.check(key, this.MAX_REQUESTS, this.WINDOW_MS);
            const used = this.MAX_REQUESTS - memoryResult.remaining;

            return {
                used,
                remaining: memoryResult.remaining,
                resetTime: memoryResult.resetTime,
                isBlocked: !memoryResult.allowed,
            };
        } catch (error) {
            logger.warn("Failed to get rate limit info", {
                userId,
                error: (error as Error).message,
            });

            // If everything fails, return default values
            return {
                used: 0,
                remaining: this.MAX_REQUESTS,
                resetTime: now + this.WINDOW_MS,
                isBlocked: false,
            };
        }
    }
}

/**
 * Global singleton instance of WebSocketRateLimiter
 */
export const webSocketRateLimiter = new WebSocketRateLimiter();