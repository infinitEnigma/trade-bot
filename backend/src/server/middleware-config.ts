/** @format */

import { Express } from "express";
import { ContextAwareLogger } from "../core/logging/context-aware-logger.service";
import { AuthenticatedRequest } from "../interfaces/middleware";
import { UserLevel } from "@trade-bot/shared";
// L3: static imports keep middleware registration synchronous and ordered.
// Dynamic `await import()` inside configure* let context/http logging land
// after already-mounted routers (auth had no HTTP logs on 2026-09-26).
import {
  csrfMiddleware,
  csrfTokenMiddleware,
} from "../interfaces/middleware/csrf.middleware";
import {
  RateLimiters,
  createRateLimiter,
} from "../infrastructure/security/rate-limiter.service";
import { kodiakRequestQueue } from "../infrastructure/external/kodiak-queue";
import { authMiddleware } from "../interfaces/middleware/auth.middleware";

// Create context-aware logger instance for middleware operations
const middlewareLogger = new ContextAwareLogger("middleware-config");

/**
 * Express Layer type for middleware stack validation
 */

/**
 * ===========================================
 * 🛡️ MIDDLEWARE CONFIGURATION SERVICE
 * ===========================================
 *
 * Centralized middleware setup and configuration.
 * Handles authentication, authorization, rate limiting, and security middleware.
 *
 * RESPONSIBILITIES:
 * - CSRF protection and token generation
 * - Authentication middleware setup
 * - Per-endpoint rate limiting configuration
 * - Security middleware organization
 * - Middleware ordering and dependencies
 *
 * ORGANIZATION:
 * - 🔐 CSRF Protection (state-changing operations)
 * - 🛡️ Per-Endpoint Rate Limiting (user-based scaling)
 * - 🔒 Security Middleware Setup
 * - 📊 Activity Tracking
 *
 * @format
 */

export interface MiddlewareConfigOptions {
  /** Whether to enable CSRF protection */
  enableCsrf?: boolean;

  /** Whether to enable rate limiting */
  enableRateLimiting?: boolean;

  /** Whether to enable activity tracking */
  enableActivityTracking?: boolean;
}

/**
 * Middleware Configuration Service
 * Handles all middleware setup and ordering
 */
export class MiddlewareConfig {
  private static readonly DEFAULT_OPTIONS: Required<MiddlewareConfigOptions> = {
    enableCsrf: true,
    enableRateLimiting: true,
    enableActivityTracking: true,
  };

  /**
   * Configure CSRF token generation for all API routes
   */
  private static configureCsrfProtection(app: Express): void {
    // CSRF token generation for all API routes
    app.use("/api", csrfTokenMiddleware);

    middlewareLogger.debug(
      "CSRF token generation configured for all API routes",
      {
        operation: "csrf_token_setup",
      }
    );
  }

  /**
   * Configure CSRF validation for state-changing operations
   */
  private static configureCsrfValidation(app: Express): void {
    // CSRF validation for ALL state-changing operations (browser routes)
    // Note: Bot engine routes are excluded because they use API key auth
    app.use("/api/user", csrfMiddleware);
    app.use("/api/user-profile", csrfMiddleware);
    // C2: the wallet + exchange-account routers replaced the old
    // /api/user/kodiak/* routes (which lived under the CSRF-covered
    // /api/user mount). Keep them covered the same way.
    app.use("/api/wallets", csrfMiddleware);
    app.use("/api/accounts", csrfMiddleware);
    app.use("/api/market", csrfMiddleware);
    app.use("/api/strategies", csrfMiddleware);
    app.use("/api/bot", csrfMiddleware);
    app.use("/api/bot-management", csrfMiddleware);
    app.use("/api/balance", csrfMiddleware);
    app.use("/api/wallet", csrfMiddleware);
    app.use("/api/security", csrfMiddleware);

    middlewareLogger.debug(
      "CSRF validation configured for state-changing routes",
      {
        operation: "csrf_validation_setup",
      }
    );
  }

  /**
   * Configure per-endpoint rate limiting with user-based scaling
   */
  private static configureRateLimiting(app: Express): void {
    // 🔐 CRITICAL: Authentication endpoints MUST be excluded from general rate limiting
    // They use specialized auth-aware rate limiting instead

    // 👤 Profile endpoints - TEMPORARILY DISABLED for testing
    /*app.use("/api/auth/me", RateLimiters.public);
        app.use("/api/auth/check-qualification", RateLimiters.public);
        app.use("/api/auth/qualification-config", RateLimiters.public);
        app.use("/api/auth/csrf-token", RateLimiters.public);
        app.use("/api/auth/logout", RateLimiters.public);*/

    // 👤 User management endpoints (moderate limits)
    // EXCLUDE /api/user/kodiak/* routes - they use specialized protection
    app.use("/api/user", (req, res, next) => {
      if (req.path.startsWith("/kodiak/")) {
        return next(); // Skip general rate limiting for Kodiak routes
      }
      RateLimiters.public(req, res, next);
    });
    app.use("/api/user-profile", RateLimiters.public);
    // 📊 Market data endpoints (user-based scaling)
    app.use("/api/market", RateLimiters.market);
    app.use("/api/strategies", RateLimiters.market);

    // 🤖 Trading & bot management (strict user-based limits)
    app.use("/api/bot", RateLimiters.trading);
    app.use("/api/bot-management", RateLimiters.trading);

    // 💰 Balance & financial data (moderate user-based limits)
    app.use("/api/balance", RateLimiters.balance);

    // 🛡️ Security & monitoring (moderate limits)
    app.use("/api/security", RateLimiters.public);

    middlewareLogger.debug(
      "Per-endpoint rate limiting configured (auth routes excluded from general limits)",
      {
        operation: "rate_limiting_setup",
      }
    );
  }

  /**
   * Configure specialized Kodiak API protection
   */
  private static configureKodiakProtection(app: Express): void {
    // 🎯 KODIAK-SPECIFIC PROTECTION: Request queuing + rate limiting for trading routes ONLY
    // EXCLUDE chart/market data routes - they need fast updates for real-time charts
    // C2: the old /api/user/kodiak/* routes were deleted; these are their
    // live replacements (connect moved to /api/accounts, user data to
    // /api/market). Charts stay excluded (need real-time updates).
    const kodiakRoutes = [
      "/api/accounts/connect", // ✅ Connection endpoint - needs protection
      "/api/market/balance", // ✅ Trading data - needs protection
      "/api/market/trades", // ✅ Trading data - needs protection
      "/api/balance/current", // ✅ Trading data - needs protection
    ];

    // Apply queuing and rate limiting to each Kodiak route
    kodiakRoutes.forEach(route => {
      app.use(route, authMiddleware, (req, res, next) => {
        // Queue requests to comply with Orderly rate limits
        // Wrap next function in Promise to match QueueMiddleware type
        const queued = kodiakRequestQueue.enqueue(req, res, async () => {
          return new Promise<void>(resolve => {
            next();
            resolve();
          });
        });
        if (!queued) {
          // Queue is full, response already sent by queue
          return;
        }
      });

      // Additional rate limiting per Kodiak account
      // Pre-built once at startup: creating a limiter per request leaks
      // memory (each createRateLimiter registers a new instance).
      app.use(
        route,
        route === "/api/accounts/connect"
          ? MiddlewareConfig.kodiakConnectionLimiter
          : MiddlewareConfig.kodiakDataLimiter
      );
    });

    middlewareLogger.debug(
      "Kodiak API protection configured for specific routes",
      {
        routesProtected: kodiakRoutes.length,
        operation: "kodiak_protection_setup",
      }
    );
  }

  /**
   * Pre-built Kodiak limiters (built once at startup; creating one per
   * request leaks limiter instances).
   */
  private static readonly kodiakDataLimiter = createRateLimiter("kodiak-data", {
    max: 60, // 60 requests per minute per user (1 req/sec)
    windowMs: 60000, // 1 minute window
    message: "Kodiak data rate limit exceeded",
    progressiveBackoff: false, // No progressive backoff for market data
    failOpen: true, // Allow if rate limiting fails - prioritize UX
    enableUserBasedLimits: true,
    userLimits: {
      [UserLevel.BASIC]: 30, // Basic users: 30 req/min (0.5 req/sec)
      [UserLevel.REGISTERED]: 45, // Registered users: 45 req/min (0.75 req/sec)
      [UserLevel.VERIFIED]: 60, // Verified users: 60 req/min (1 req/sec)
    },
  });

  private static readonly kodiakConnectionLimiter = createRateLimiter(
    "kodiak-connection",
    {
      max: 30, // 60 requests per minute for connection operations
      windowMs: 60000, // 1 minute window
      message: "Kodiak connection rate limit exceeded",
      progressiveBackoff: true,
      failOpen: false, // Allow if rate limiting fails - connection should work
      enableUserBasedLimits: true,
      userLimits: {
        [UserLevel.BASIC]: 2, // Basic users: 2 req/min
        [UserLevel.REGISTERED]: 15, // Registered users: 20 req/min
        [UserLevel.VERIFIED]: 30, // Verified users: 60 req/min
      },
    }
  );

  /**
   * Create status-specific rate limiter with higher limits
   */
  private static createKodiakStatusRateLimiter() {
    return createRateLimiter("kodiak-status", {
      max: 300, // 300 requests per minute for status checks
      windowMs: 60000, // 1 minute window
      message: "Kodiak status check rate limit exceeded",
      progressiveBackoff: false,
      failOpen: true, // Allow if rate limiting fails - status should be available
      enableUserBasedLimits: true,
      userLimits: {
        [UserLevel.BASIC]: 5, // Basic users: 5 req/min
        [UserLevel.REGISTERED]: 25, // Registered users: 25 req/min
        [UserLevel.VERIFIED]: 300, // Verified users: 300 req/min (full access)
      },
    });
  }

  /**
   * Create connection-specific rate limiter with moderate limits
   */
  private static createKodiakConnectionRateLimiter() {
    return createRateLimiter("kodiak-connection", {
      max: 30, // 60 requests per minute for connection operations
      windowMs: 60000, // 1 minute window
      message: "Kodiak connection rate limit exceeded",
      progressiveBackoff: true,
      failOpen: false, // Allow if rate limiting fails - connection should work
      enableUserBasedLimits: true,
      userLimits: {
        [UserLevel.BASIC]: 2, // Basic users: 2 req/min
        [UserLevel.REGISTERED]: 15, // Registered users: 20 req/min
        [UserLevel.VERIFIED]: 30, // Verified users: 60 req/min
      },
    });
  }

  /**
   * Configure API activity tracking
   */
  private static configureActivityTracking(app: Express): void {
    // API activity tracking middleware
    app.use("/api", (req, res, next) => {
      // Import and use the tracking function from index.ts
      // This will be moved to a proper service later
      const trackApiActivity = () => {
        // Activity tracking logic will be implemented in a separate service
        middlewareLogger.debug("API activity tracked", {
          method: req.method,
          url: req.url,
          userId: (req as AuthenticatedRequest).user?.userId,
          operation: "api_activity_tracking",
        });
      };

      trackApiActivity();
      next();
    });

    middlewareLogger.debug("API activity tracking configured", {
      operation: "activity_tracking_setup",
    });
  }

  /**
   * Validate middleware configuration
   */
  /**
   * Track which middleware components have been configured
   * This is used for validation purposes
   */
  private static configuredMiddleware: {
    csrf: boolean;
    rateLimiting: boolean;
    activityTracking: boolean;
  } = {
    csrf: false,
    rateLimiting: false,
    activityTracking: false,
  };

  /**
   * Configure all middleware for the Express application
   *
   * Synchronous: every app.use runs inline in a fixed order so the
   * middleware stack is deterministic (L3). Nothing here may await a
   * dynamic import.
   */
  static configure(app: Express, options: MiddlewareConfigOptions = {}): void {
    const config = { ...this.DEFAULT_OPTIONS, ...options };

    // Reset configured middleware tracking
    this.configuredMiddleware = {
      csrf: false,
      rateLimiting: false,
      activityTracking: false,
    };

    // CSRF token generation for auth routes (login/register/refresh)
    if (config.enableCsrf) {
      this.configureCsrfProtection(app);
      this.configuredMiddleware.csrf = true;
    }

    // CSRF validation for ALL state-changing operations (browser routes)
    if (config.enableCsrf) {
      this.configureCsrfValidation(app);
    }

    if (config.enableRateLimiting) {
      this.configuredMiddleware.rateLimiting = true;
    }

    // Per-endpoint rate limiting with user-based limits (after Kodiak protection)
    if (config.enableRateLimiting) {
      this.configureRateLimiting(app);
      this.configureKodiakProtection(app);
    }

    // API activity tracking middleware
    if (config.enableActivityTracking) {
      this.configureActivityTracking(app);
      this.configuredMiddleware.activityTracking = true;
    }

    middlewareLogger.info("Middleware configuration completed", {
      csrfEnabled: config.enableCsrf,
      rateLimitingEnabled: config.enableRateLimiting,
      kodiakProtectionEnabled: config.enableRateLimiting,
      activityTrackingEnabled: config.enableActivityTracking,
      operation: "middleware_setup",
    });
  }

  /**
   * Boot-order assertion (L3): fail fast if the middleware stack does not
   * have request context + HTTP logging before the first router. Called from
   * the boot path after ExpressConfig + MiddlewareConfig + RouteConfig run.
   * Layers are matched by handler identity — Express names anonymous arrow
   * middleware "bound dispatch", so layer.name is useless here.
   */
  static assertBootOrder(app: Express): void {
    // Express 5 keeps the stack on app.router (not app._router).
    const stack = (app as unknown as { router?: { stack?: unknown[] } }).router
      ?.stack;
    if (!Array.isArray(stack) || stack.length === 0) return;
    const handleName = (layer: unknown) =>
      (layer as { handle?: { name?: string } })?.handle?.name ?? "";
    const names = stack.map(handleName);
    const contextIdx = names.indexOf("contextMiddleware");
    const httpIdx = names.indexOf("httpLogger");
    if (contextIdx < 0 || httpIdx <= contextIdx) {
      throw new Error(
        "Boot order violation: contextMiddleware + httpLogger must be mounted before any router"
      );
    }
    const firstRouterIdx = names.indexOf("router");
    if (firstRouterIdx >= 0 && httpIdx > firstRouterIdx) {
      throw new Error(
        "Boot order violation: httpLogger mounted after the first router — auth traffic would be unlogged"
      );
    }
  }

  /**
   * Validate middleware configuration
   */
  static validateConfiguration(_app: Express): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (!this.configuredMiddleware.csrf) {
      issues.push("CSRF protection middleware not found");
    }

    if (!this.configuredMiddleware.rateLimiting) {
      issues.push("Rate limiting middleware not found");
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }
}
