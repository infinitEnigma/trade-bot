/** @format */

import { Request, Response, NextFunction } from "express";
import { redisService } from "../../infrastructure";
import { AuthenticatedRequest } from "../../interfaces/middleware";
import { UserLevel } from "@trade-bot/shared";
import { logger } from "../../core/logging";

// In-memory rate limiting fallback
interface InMemoryRateLimit {
  count: number;
  resetTime: number;
}

class MemoryRateLimiter {
  private limits = new Map<string, InMemoryRateLimit>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every 10 seconds (more aggressive for memory efficiency)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10000);
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
  // Progressive rate limiting for authentication
  progressiveBackoff?: boolean; // Enable exponential backoff on failures
  maxProgressiveDelay?: number; // Maximum delay in milliseconds (default: 5 minutes)
  progressiveBaseDelay?: number; // Base delay for backoff calculation (default: 1 second)
}

/**
 * Track failed authentication attempts for progressive backoff
 */
class ProgressiveAuthLimiter {
  private readonly FAILURE_KEY_PREFIX = 'auth:failures:';
  private readonly MAX_FAILURES = 5;
  private readonly BASE_DELAY_MS = 1000; // 1 second
  private readonly MAX_DELAY_MS = 300000; // 5 minutes

  /**
   * Record a failed authentication attempt
   */
  async recordFailure(identifier: string): Promise<{ delayMs: number; totalFailures: number }> {
    const key = `${this.FAILURE_KEY_PREFIX}${identifier}`;

    try {
      // Atomically increment failure count and get current value
      const result = await redisService.atomicReadModifyWrite(
        key,
        (current: number | null) => (current || 0) + 1,
        0,
        3
      );

      if (!result.success) {
        logger.warn("Failed to record auth failure, using fallback", { identifier });
        return { delayMs: this.BASE_DELAY_MS, totalFailures: 1 };
      }

      const totalFailures = result.newValue!;
      const delayMs = this.calculateProgressiveDelay(totalFailures);

      // Set expiry on the failure counter (24 hours)
      await redisService.setex(key, 24 * 60 * 60, totalFailures.toString());

      logger.debug("Recorded authentication failure", {
        identifier,
        totalFailures,
        delayMs
      });

      return { delayMs, totalFailures };
    } catch (error) {
      logger.error("Error recording auth failure", {
        identifier,
        error: error instanceof Error ? error.message : String(error),
      });
      return { delayMs: this.BASE_DELAY_MS, totalFailures: 1 };
    }
  }

  /**
   * Record a successful authentication (reset failure counter)
   */
  async recordSuccess(identifier: string): Promise<void> {
    const key = `${this.FAILURE_KEY_PREFIX}${identifier}`;

    try {
      await redisService.del(key);
      logger.debug("Reset authentication failure counter", { identifier });
    } catch (error) {
      logger.warn("Failed to reset auth failure counter", {
        identifier,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current failure count and required delay
   */
  async getFailureInfo(identifier: string): Promise<{ totalFailures: number; delayMs: number }> {
    const key = `${this.FAILURE_KEY_PREFIX}${identifier}`;

    try {
      const result = await redisService.get(key);
      const totalFailures = result.success && result.data ? parseInt(result.data) : 0;
      const delayMs = totalFailures > 0 ? this.calculateProgressiveDelay(totalFailures) : 0;

      return { totalFailures, delayMs };
    } catch (error) {
      logger.warn("Failed to get auth failure info", {
        identifier,
        error: error instanceof Error ? error.message : String(error),
      });
      return { totalFailures: 0, delayMs: 0 };
    }
  }

  /**
   * Calculate progressive delay based on failure count
   */
  private calculateProgressiveDelay(failures: number): number {
    if (failures <= 1) return 0; // No delay for first failure

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, then cap at MAX_DELAY_MS
    const exponent = Math.min(failures - 1, 5); // Cap exponent to prevent overflow
    const delayMs = Math.min(this.BASE_DELAY_MS * Math.pow(2, exponent), this.MAX_DELAY_MS);

    // Add jitter (±10%) to prevent thundering herd
    const jitter = delayMs * 0.1 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(delayMs + jitter));
  }

  /**
   * Check if identifier is currently in progressive backoff
   */
  async isInBackoff(identifier: string): Promise<boolean> {
    const { delayMs } = await this.getFailureInfo(identifier);
    return delayMs > 0;
  }
}

// Global progressive auth limiter instance
const progressiveAuthLimiter = new ProgressiveAuthLimiter();

// Export for use in auth handlers to reset failure counter on success
export { progressiveAuthLimiter };

/**
 * Create a fail-safe rate limiter middleware for specific endpoint
 * Uses Redis primary with in-memory fallback
 */
export function createRateLimiter(endpoint: string, config: RateLimitConfig) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Skip OPTIONS requests (CORS preflight) - they shouldn't be rate limited
    if (req.method === 'OPTIONS') {
      return next();
    }

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
      let progressiveDelay = 0;

      // Check progressive backoff for authentication endpoints
      if (config.progressiveBackoff && endpoint === 'auth') {
        const failureInfo = await progressiveAuthLimiter.getFailureInfo(identifier);
        progressiveDelay = failureInfo.delayMs;

        if (progressiveDelay > 0) {
          logger.info("Applying progressive backoff delay", {
            endpoint,
            identifier,
            progressiveDelay,
            totalFailures: failureInfo.totalFailures,
          });

          // CRITICAL: Block the request if in progressive backoff
          return res.status(429).json({
            success: false,
            error: "Too many failed login attempts. Please try again later.",
            retryAfter: Math.ceil(progressiveDelay / 1000),
            limitType: 'progressive',
            progressiveDelay: Math.ceil(progressiveDelay / 1000),
          });
        }
      }

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
            // For auth endpoints, record the failure for progressive backoff
            if (config.progressiveBackoff && endpoint === 'auth') {
              await progressiveAuthLimiter.recordFailure(identifier);
            }

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
          // For auth endpoints, record the failure for progressive backoff
          if (config.progressiveBackoff && endpoint === 'auth') {
            await progressiveAuthLimiter.recordFailure(identifier);
          }

          return res.status(429).json({
            success: false,
            error:
              config.message || "Too many requests, please try again later",
            retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
          });
        }
      }

      // ✅ Add rate limit headers with user-based and progressive information
      res.set("RateLimit-Limit", effectiveMaxRequests.toString());
      res.set(
        "RateLimit-Remaining",
        Math.max(0, effectiveMaxRequests - current).toString()
      );
      res.set("RateLimit-Reset", new Date(resetTime).toISOString());
      res.set("RateLimit-Using-Fallback", usedFallback.toString());
      res.set("RateLimit-Type", limitType); // 'user' or 'ip'
      if (progressiveDelay > 0) {
        res.set("RateLimit-Progressive-Delay", progressiveDelay.toString());
      }

      // ✅ Check if limit exceeded
      if (current > effectiveMaxRequests) {
        // For auth endpoints, record the failure for progressive backoff
        if (config.progressiveBackoff && endpoint === 'auth') {
          const failureInfo = await progressiveAuthLimiter.recordFailure(identifier);
          progressiveDelay = failureInfo.delayMs;
        }

        logger.warn("Rate limit exceeded", {
          endpoint,
          limitType,
          identifier: userId || req.ip,
          userId,
          userLevel,
          current,
          max: effectiveMaxRequests,
          usedFallback,
          progressiveDelay,
          url: req.originalUrl,
          method: req.method,
          userAgent: req.get('User-Agent'),
        });

        return res.status(429).json({
          success: false,
          error: config.message || "Too many requests, please try again later",
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000) + Math.ceil(progressiveDelay / 1000),
          limitType, // Indicate whether it was user or IP limit
          progressiveDelay: progressiveDelay > 0 ? Math.ceil(progressiveDelay / 1000) : undefined,
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
  // ✅ Authentication endpoints (strict, with progressive backoff)
  auth: createRateLimiter("auth", {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'development' ? 100 : 5, // 100 for dev, 5 for prod
    message: "Too many login attempts, please try again later",
    progressiveBackoff: false, // Disabled - prevents false lockouts from persistent Redis counters
    maxProgressiveDelay: process.env.NODE_ENV === 'development' ? 5000 : 5 * 60 * 1000, // 5s dev, 5min prod
    progressiveBaseDelay: 1000, // Start with 1 second
  }),

  // ✅ Public endpoints (lenient, fail open, no user-based limits for anonymous)
  public: createRateLimiter("public", {
    windowMs: 60 * 1000, // 1 minute
    max: process.env.NODE_ENV === 'development' ? 10000 : 1000, // Very high for dev, 1000 for prod
    message: "Too many requests to this endpoint",
    failOpen: true, // Allow requests if Redis fails
  }),

  // ✅ Market data endpoints (moderate, user-based limits)
  market: createRateLimiter("market", {
    windowMs: 60 * 1000, // 1 minute
    max: process.env.NODE_ENV === 'development' ? 1000 : 10000, // 1000 for dev, 10000 for prod
    message: "Market data rate limit exceeded",
    failOpen: false, // Block requests if both Redis and memory fail
    enableUserBasedLimits: true,
    userLimits: {
      [UserLevel.BASIC]: process.env.NODE_ENV === 'development' ? 2000 : 20000,       // 2000 for dev, 20000 for prod
      [UserLevel.REGISTERED]: process.env.NODE_ENV === 'development' ? 3000 : 30000, // 3000 for dev, 30000 for prod
      [UserLevel.VERIFIED]: process.env.NODE_ENV === 'development' ? 5000 : 50000,  // 5000 for dev, 50000 for prod
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

  // ✅ Kodiak status endpoints (very lenient - just database queries)
  kodiakStatus: createRateLimiter("kodiak-status", {
    windowMs: 60 * 1000, // 1 minute
    max: process.env.NODE_ENV === 'development' ? 10000 : 10000, // Very high limits
    message: "Kodiak status rate limit exceeded",
    failOpen: true, // Allow if Redis fails - just DB queries
    enableUserBasedLimits: true,
    userLimits: {
      [UserLevel.BASIC]: process.env.NODE_ENV === 'development' ? 20000 : 20000,
      [UserLevel.REGISTERED]: process.env.NODE_ENV === 'development' ? 30000 : 30000,
      [UserLevel.VERIFIED]: process.env.NODE_ENV === 'development' ? 50000 : 50000,
    },
  }),
};
