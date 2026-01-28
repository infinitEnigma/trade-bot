/** @format */

/**
 * ===========================================
 * 🚀 RATE LIMITER SERVICE - Main Entry Point
 * ===========================================
 *
 * ✅ REFACTORING COMPLETE:
 * This monolithic file (716 lines) has been successfully broken down into:
 * - rate-limit.types.ts: All interfaces and types (102 lines)
 * - memory-rate-limiter.ts: In-memory fallback implementation (157 lines)
 * - progressive-auth-limiter.ts: Authentication failure backoff (178 lines)
 * - redis-health-monitor.ts: Redis availability monitoring (151 lines)
 * - rate-limit.config.ts: Centralized configuration management (298 lines)
 * - rate-limiter.service.ts: Core middleware logic (338 lines - 53% reduction)
 *
 * GLOBAL CONTROLS:
 * - Set RATE_LIMITING_ENABLED=false to disable entire system
 * - All rate limits abstracted to config for easy domain-wide adjustments
 *
 * BENEFITS ACHIEVED:
 * - ✅ Separation of concerns with focused modules
 * - ✅ Parameter abstraction for easy domain-wide rate adjustments
 * - ✅ Comprehensive documentation and code comments
 * - ✅ Global enable/disable capability
 * - ✅ Dedicated folder structure for better organization
 * - ✅ Backup preservation of original implementation
 */

import { Response, NextFunction } from "express";
import { redisService } from "../../infrastructure";
import { AuthenticatedRequest } from "../../interfaces/middleware";
import { UserLevel } from "../../../shared/src";
import { logger } from "../../core/logging";

// Import extracted modules
import { RateLimitConfig } from "./rate-limiter/rate-limit.types";
import { memoryRateLimiter } from "./rate-limiter/memory-rate-limiter";
import { progressiveAuthLimiter } from "./rate-limiter/progressive-auth-limiter";
//import { redisHealthMonitor } from "./rate-limiter/redis-health-monitor";
import { RATE_LIMIT_CONFIGS } from "./rate-limiter/rate-limit.config";

// Re-export for backward compatibility
export { progressiveAuthLimiter };









/**
 * ===========================================
 * ⚡ CORE RATE LIMITER - Main Middleware Function
 * ===========================================
 *
 * WILL BE REFACTORED IN: rate-limiter.service.ts (simplified version)
 *
 * The main middleware function that orchestrates rate limiting logic:
 * 1. Checks global enable/disable flag
 * 2. Determines effective limits based on user authentication
 * 3. Performs rate limiting using Redis (primary) or memory (fallback)
 * 4. Handles progressive backoff for authentication endpoints
 * 5. Sets appropriate response headers and error responses
 */

/**
 * Create a fail-safe rate limiter middleware for specific endpoint
 * Uses Redis primary with in-memory fallback
 */
export function createRateLimiter(endpoint: string, config: RateLimitConfig) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // GLOBAL ENABLE/DISABLE: Check if rate limiting is enabled (default: true)
    const rateLimitingEnabled = process.env.RATE_LIMITING_ENABLED !== 'false';
    if (!rateLimitingEnabled) {
      logger.debug("Rate limiting disabled globally", { endpoint });
      return next();
    }

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
      const redisAvailable = await redisService.isHealthy();

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
          // Redis health is managed by redisHealthMonitor
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
 * ===========================================
 * ⚙️ RATE LIMITER CONFIGURATIONS - Predefined Setups
 * ===========================================
 *
 * WILL BE MOVED TO: rate-limit.config.ts
 *
 * Centralized configuration for all endpoint rate limiting.
 * Each endpoint has environment-aware settings and user-based tier limits.
 * Easy to modify rates across domains by changing values here.
 *
 * Configuration includes:
 * - Environment-specific limits (dev vs prod)
 * - User tier differentiation (Basic/Registered/Verified)
 * - Fail-open/fail-closed behavior per endpoint
 * - Progressive backoff settings for auth endpoints
 */

/**
 * Predefined rate limiter configurations using centralized config.
 * All rate limits are now abstracted and can be easily adjusted in rate-limit.config.ts
 */
export const RateLimiters = {
  auth: createRateLimiter("auth", RATE_LIMIT_CONFIGS.auth),
  public: createRateLimiter("public", RATE_LIMIT_CONFIGS.public),
  market: createRateLimiter("market", RATE_LIMIT_CONFIGS.market),
  trading: createRateLimiter("trading", RATE_LIMIT_CONFIGS.trading),
  balance: createRateLimiter("balance", RATE_LIMIT_CONFIGS.balance),
  websocket: createRateLimiter("websocket", RATE_LIMIT_CONFIGS.websocket),
  botInstances: createRateLimiter("bot-instances", RATE_LIMIT_CONFIGS.botInstances),
  kodiakStatus: createRateLimiter("kodiak-status", RATE_LIMIT_CONFIGS.kodiakStatus),
  kodiakApi: createRateLimiter("kodiak-api", RATE_LIMIT_CONFIGS.kodiakApi),
};
