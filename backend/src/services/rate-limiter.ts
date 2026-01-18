/** @format */

import { Request, Response, NextFunction } from "express";
import { redisService } from "./redis";
import { AuthenticatedRequest } from "../middleware/auth";
import { UserLevel } from "@trade-bot/shared";
import logger from "./logger";

// In-memory rate limiting fallback
interface InMemoryRateLimit {
  count: number;
  resetTime: number;
}

class MemoryRateLimiter {
  private limits = new Map<string, InMemoryRateLimit>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const limit = this.limits.get(key);

    if (!limit || now > limit.resetTime) {
      // First request or expired window
      this.limits.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: now + windowMs,
      };
    }

    if (limit.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetTime: limit.resetTime };
    }

    limit.count++;
    return {
      allowed: true,
      remaining: maxRequests - limit.count,
      resetTime: limit.resetTime,
    };
  }

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

  getStats(): { activeKeys: number; totalMemoryUsage: number } {
    return {
      activeKeys: this.limits.size,
      totalMemoryUsage: this.limits.size * (50 + 16 + 8), // Rough estimate: key + object overhead
    };
  }

  clear(): void {
    this.limits.clear();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// Global in-memory rate limiter instance
const memoryRateLimiter = new MemoryRateLimiter();

// Redis health tracking
let redisHealthy = true;
let lastRedisCheck = 0;
const REDIS_CHECK_INTERVAL = 30000; // Check Redis health every 30 seconds

/**
 * Check Redis health periodically
 */
async function checkRedisHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastRedisCheck < REDIS_CHECK_INTERVAL) {
    return redisHealthy;
  }

  lastRedisCheck = now;
  try {
    const isHealthy = await redisService.isHealthy();
    if (redisHealthy !== isHealthy) {
      logger.info("Redis health status changed", {
        wasHealthy: redisHealthy,
        nowHealthy: isHealthy,
      });
      redisHealthy = isHealthy;
    }
    return isHealthy;
  } catch (error) {
    if (redisHealthy) {
      logger.warn(
        "Redis health check failed, switching to in-memory fallback",
        {
          error: (error as Error).message,
        }
      );
      redisHealthy = false;
    }
    return false;
  }
}

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests in window
  message?: string; // Custom error message
  skipSuccessfulRequests?: boolean; // Don't count successful responses
  skipFailedRequests?: boolean; // Don't count failed responses
  failOpen?: boolean; // If true, allow requests when Redis fails (default: false)
  // User-based rate limiting options
  userLimits?: {
    [UserLevel.BASIC]: number;
    [UserLevel.REGISTERED]: number;
    [UserLevel.VERIFIED]: number;
  };
  enableUserBasedLimits?: boolean; // Enable user-based rate limiting
}

/**
 * Create a fail-safe rate limiter middleware for specific endpoint
 * Uses Redis primary with in-memory fallback
 */
export function createRateLimiter(endpoint: string, config: RateLimitConfig) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Extract user information for user-based rate limiting
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;
    const userLevel = authReq.user?.userLevel;

    // Determine rate limit based on authentication status and user level
    let effectiveMaxRequests = config.max;
    let limitType = 'ip';

    if (userId && config.enableUserBasedLimits && config.userLimits && userLevel) {
      // Use user-based limits for authenticated requests
      const userLimit = config.userLimits[userLevel as UserLevel];
      if (userLimit) {
        effectiveMaxRequests = userLimit;
        limitType = 'user';
      }
    }

    // Create rate limit key based on authentication status
    const identifier = userId ? `user:${userId}` : `ip:${req.ip}`;
    const key = `ratelimit:${endpoint}:${identifier}`;

    try {
      // Check Redis health
      const redisAvailable = await checkRedisHealth();

      let current: number;
      let resetTime: number;
      let usedFallback = false;

      if (redisAvailable) {
        try {
          // Primary: Use atomic increment with expiry to prevent race conditions
          const atomicResult = await redisService.atomicIncrementWithExpiry(
            key,
            1,
            config.windowMs,
            3 // maxRetries
          );

          if (atomicResult.success) {
            current = atomicResult.newValue;
            // For atomic increment, reset time is windowMs from now
            resetTime = Date.now() + config.windowMs;
          } else {
            // Fallback to in-memory if atomic operation fails
            logger.warn("Atomic increment failed, using in-memory fallback", {
              endpoint,
              limitType,
              identifier: userId || req.ip,
              error: atomicResult.error,
            });
            usedFallback = true;

            const memoryResult = memoryRateLimiter.check(
              key,
              effectiveMaxRequests,
              config.windowMs
            );
            current = effectiveMaxRequests - memoryResult.remaining;
            resetTime = memoryResult.resetTime;
          }
        } catch (redisError) {
          logger.warn(
            "Redis rate limiting failed, switching to in-memory fallback",
            {
              endpoint,
              limitType,
              identifier: userId || req.ip,
              error: (redisError as Error).message,
            }
          );
          redisHealthy = false; // Mark Redis as unhealthy
          usedFallback = true;

          // Fallback: Use in-memory rate limiting
          const memoryResult = memoryRateLimiter.check(
            key,
            effectiveMaxRequests,
            config.windowMs
          );
          current = effectiveMaxRequests - memoryResult.remaining;
          resetTime = memoryResult.resetTime;

          if (!memoryResult.allowed) {
            return res.status(429).json({
              success: false,
              error:
                config.message || "Too many requests, please try again later",
              retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
            });
          }
        }
      } else {
        // Redis unavailable, use in-memory fallback
        usedFallback = true;
        const memoryResult = memoryRateLimiter.check(
          key,
          effectiveMaxRequests,
          config.windowMs
        );
        current = effectiveMaxRequests - memoryResult.remaining;
        resetTime = memoryResult.resetTime;

        if (!memoryResult.allowed) {
          return res.status(429).json({
            success: false,
            error:
              config.message || "Too many requests, please try again later",
            retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
          });
        }
      }

      // ✅ Add rate limit headers with user-based information
      res.set("RateLimit-Limit", effectiveMaxRequests.toString());
      res.set(
        "RateLimit-Remaining",
        Math.max(0, effectiveMaxRequests - current).toString()
      );
      res.set("RateLimit-Reset", new Date(resetTime).toISOString());
      res.set("RateLimit-Using-Fallback", usedFallback.toString());
      res.set("RateLimit-Type", limitType); // 'user' or 'ip'

      // ✅ Check if limit exceeded
      if (current > effectiveMaxRequests) {
        logger.warn("Rate limit exceeded", {
          endpoint,
          limitType,
          identifier: userId || req.ip,
          userId,
          userLevel,
          current,
          max: effectiveMaxRequests,
          usedFallback,
        });

        return res.status(429).json({
          success: false,
          error: config.message || "Too many requests, please try again later",
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
          limitType, // Indicate whether it was user or IP limit
        });
      }

      next();
    } catch (error) {
      // Final fallback - if both Redis and in-memory fail
      logger.error("Rate limiter completely failed", {
        endpoint,
        limitType,
        identifier: userId || req.ip,
        error: (error as Error).message,
      });

      // Configurable fail behavior
      if (config.failOpen) {
        logger.warn("Rate limiter failed open (allowing request)", {
          endpoint,
          limitType,
          identifier: userId || req.ip,
        });
        next();
      } else {
        logger.error("Rate limiter failed closed (blocking request)", {
          endpoint,
          limitType,
          identifier: userId || req.ip,
        });
        return res.status(503).json({
          success: false,
          error: "Service temporarily unavailable",
          retryAfter: 60,
        });
      }
    }
  };
}

/**
 * Predefined rate limiter configurations with user-based tier support
 */
export const RateLimiters = {
  // ✅ Authentication endpoints (strict, no user-based limits)
  auth: createRateLimiter("auth", {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: "Too many login attempts, please try again later",
  }),

  // ✅ Public endpoints (lenient, fail open, no user-based limits for anonymous)
  public: createRateLimiter("public", {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: "Too many requests to this endpoint",
    failOpen: true, // Allow requests if Redis fails
  }),

  // ✅ Market data endpoints (moderate, user-based limits)
  market: createRateLimiter("market", {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute (IP limit)
    message: "Market data rate limit exceeded",
    failOpen: false, // Block requests if both Redis and memory fail
    enableUserBasedLimits: true,
    userLimits: {
      [UserLevel.BASIC]: 50,        // 50 requests per minute
      [UserLevel.REGISTERED]: 75,   // 75 requests per minute
      [UserLevel.VERIFIED]: 100,    // 100 requests per minute
    },
  }),

  // ✅ Trading endpoints (strict, user-based limits)
  trading: createRateLimiter("trading", {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute (IP limit)
    message: "Trading rate limit exceeded",
    failOpen: false, // Critical security - block if rate limiting fails
    enableUserBasedLimits: true,
    userLimits: {
      [UserLevel.BASIC]: 20,        // 20 requests per minute
      [UserLevel.REGISTERED]: 30,   // 30 requests per minute
      [UserLevel.VERIFIED]: 50,     // 50 requests per minute
    },
  }),

  // ✅ Balance endpoints (moderate, user-based limits)
  balance: createRateLimiter("balance", {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute (IP limit)
    message: "Balance refresh rate limit exceeded",
    failOpen: false, // Financial data - block if rate limiting fails
    enableUserBasedLimits: true,
    userLimits: {
      [UserLevel.BASIC]: 30,        // 30 requests per minute
      [UserLevel.REGISTERED]: 45,   // 45 requests per minute
      [UserLevel.VERIFIED]: 60,     // 60 requests per minute
    },
  }),

  // ✅ WebSocket (very lenient, user-based limits)
  websocket: createRateLimiter("websocket", {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 subscriptions per minute (IP limit)
    message: "WebSocket subscription rate limit exceeded",
    failOpen: true, // Real-time data - allow if Redis fails
    enableUserBasedLimits: true,
    userLimits: {
      [UserLevel.BASIC]: 150,       // 150 subscriptions per minute
      [UserLevel.REGISTERED]: 200,  // 200 subscriptions per minute
      [UserLevel.VERIFIED]: 300,    // 300 subscriptions per minute
    },
  }),
};
