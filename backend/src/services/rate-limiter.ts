/** @format */

import { Request, Response, NextFunction } from "express";
import { redisService } from "./redis";
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
}

/**
 * Create a fail-safe rate limiter middleware for specific endpoint
 * Uses Redis primary with in-memory fallback
 */
export function createRateLimiter(endpoint: string, config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `ratelimit:${endpoint}:${req.ip}`;

    try {
      // Check Redis health
      const redisAvailable = await checkRedisHealth();

      let current: number;
      let resetTime: number;
      let usedFallback = false;

      if (redisAvailable) {
        try {
          // Primary: Use Redis
          const client = redisService.getClient();
          const incrResult = await client.incr(key);

          if (incrResult !== 1) {
            // Get current count (INCR returns the new value)
            current = incrResult;
          } else {
            // First request, set expiry
            await client.pExpire(key, config.windowMs);
            current = 1;
          }

          // Get TTL to calculate reset time
          const ttlResult = await client.pTTL(key);
          resetTime =
            ttlResult > 0
              ? Date.now() + ttlResult
              : Date.now() + config.windowMs;
        } catch (redisError) {
          logger.warn(
            "Redis rate limiting failed, switching to in-memory fallback",
            {
              endpoint,
              ip: req.ip,
              error: (redisError as Error).message,
            }
          );
          redisHealthy = false; // Mark Redis as unhealthy
          usedFallback = true;

          // Fallback: Use in-memory rate limiting
          const memoryResult = memoryRateLimiter.check(
            key,
            config.max,
            config.windowMs
          );
          current = config.max - memoryResult.remaining;
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
          config.max,
          config.windowMs
        );
        current = config.max - memoryResult.remaining;
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

      // ✅ Add rate limit headers
      res.set("RateLimit-Limit", config.max.toString());
      res.set(
        "RateLimit-Remaining",
        Math.max(0, config.max - current).toString()
      );
      res.set("RateLimit-Reset", new Date(resetTime).toISOString());
      res.set("RateLimit-Using-Fallback", usedFallback.toString());

      // ✅ Check if limit exceeded
      if (current > config.max) {
        logger.warn("Rate limit exceeded", {
          endpoint,
          ip: req.ip,
          current,
          max: config.max,
          usedFallback,
        });

        return res.status(429).json({
          success: false,
          error: config.message || "Too many requests, please try again later",
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
        });
      }

      next();
    } catch (error) {
      // Final fallback - if both Redis and in-memory fail
      logger.error("Rate limiter completely failed", {
        endpoint,
        ip: req.ip,
        error: (error as Error).message,
      });

      // Configurable fail behavior
      if (config.failOpen) {
        logger.warn("Rate limiter failed open (allowing request)", {
          endpoint,
          ip: req.ip,
        });
        next();
      } else {
        logger.error("Rate limiter failed closed (blocking request)", {
          endpoint,
          ip: req.ip,
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
 * Predefined rate limiter configurations
 */
export const RateLimiters = {
  // ✅ Authentication endpoints (strict)
  auth: createRateLimiter("auth", {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: "Too many login attempts, please try again later",
  }),

  // ✅ Public endpoints (lenient, fail open)
  public: createRateLimiter("public", {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: "Too many requests to this endpoint",
    failOpen: true, // Allow requests if Redis fails
  }),

  // ✅ Market data endpoints (moderate, fail closed)
  market: createRateLimiter("market", {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: "Market data rate limit exceeded",
    failOpen: false, // Block requests if both Redis and memory fail
  }),

  // ✅ Trading endpoints (strict, fail closed)
  trading: createRateLimiter("trading", {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: "Trading rate limit exceeded",
    failOpen: false, // Critical security - block if rate limiting fails
  }),

  // ✅ Balance endpoints (moderate, fail closed)
  balance: createRateLimiter("balance", {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
    message: "Balance refresh rate limit exceeded",
    failOpen: false, // Financial data - block if rate limiting fails
  }),

  // ✅ WebSocket (very lenient, fail open)
  websocket: createRateLimiter("websocket", {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 subscriptions per minute
    message: "WebSocket subscription rate limit exceeded",
    failOpen: true, // Real-time data - allow if Redis fails
  }),
};
