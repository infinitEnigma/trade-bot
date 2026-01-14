/** @format */

import { Request, Response, NextFunction } from 'express';
import { redisService } from './redis';
import logger from './logger';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests in window
  message?: string; // Custom error message
  skipSuccessfulRequests?: boolean; // Don't count successful responses
  skipFailedRequests?: boolean; // Don't count failed responses
}

/**
 * Create a rate limiter middleware for specific endpoint
 */
export function createRateLimiter(
  endpoint: string,
  config: RateLimitConfig
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = redisService.getClient();
      const key = `ratelimit:${endpoint}:${req.ip}`;

      // Use Redis INCR command
      const current = await client.incr(key);

      // ✅ Set expiry on first request (use PEXPIRE for milliseconds)
      if (current === 1) {
        await client.pExpire(key, config.windowMs);
      }

      // ✅ Add rate limit headers
      res.set('RateLimit-Limit', config.max.toString());
      res.set('RateLimit-Remaining', Math.max(0, config.max - current).toString());
      res.set('RateLimit-Reset', new Date(Date.now() + config.windowMs).toISOString());

      // ✅ Check if limit exceeded
      if (current > config.max) {
        logger.warn('Rate limit exceeded', {
          endpoint,
          ip: req.ip,
          current,
          max: config.max,
        });

        return res.status(429).json({
          success: false,
          error: config.message || 'Too many requests, please try again later',
          retryAfter: Math.ceil(config.windowMs / 1000),
        });
      }

      next();
    } catch (error) {
      // On error, let request through (fail open)
      logger.error('Rate limiter error', {
        error: (error as Error).message,
      });
      next();
    }
  };
}

/**
 * Predefined rate limiter configurations
 */
export const RateLimiters = {
  // ✅ Authentication endpoints (strict)
  auth: createRateLimiter('auth', {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: 'Too many login attempts, please try again later',
  }),

  // ✅ Public endpoints (lenient)
  public: createRateLimiter('public', {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: 'Too many requests to this endpoint',
  }),

  // ✅ Market data endpoints (moderate)
  market: createRateLimiter('market', {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: 'Market data rate limit exceeded',
  }),

  // ✅ Trading endpoints (strict)
  trading: createRateLimiter('trading', {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: 'Trading rate limit exceeded',
  }),

  // ✅ Balance endpoints (moderate)
  balance: createRateLimiter('balance', {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
    message: 'Balance refresh rate limit exceeded',
  }),

  // ✅ WebSocket (very lenient)
  websocket: createRateLimiter('websocket', {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 subscriptions per minute
    message: 'WebSocket subscription rate limit exceeded',
  }),
};
