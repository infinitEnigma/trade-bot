/** @format */

import { Express } from "express";
import { ContextAwareLogger } from "../core/logging/context-aware-logger.service";
import { AuthenticatedRequest } from "../interfaces/middleware";
import { UserLevel } from "@trade-bot/shared";

// Create context-aware logger instance for middleware operations
const middlewareLogger = new ContextAwareLogger('middleware-config');

/**
 * Express Layer type for middleware stack validation
 */
interface ExpressLayer {
    name?: string;
    regexp?: RegExp;
    handle?: unknown;
    route?: unknown;
    [key: string]: unknown;
}

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
     * Configure CSRF token generation for authentication routes
     */
    private static async configureCsrfProtection(app: Express): Promise<void> {
        const { csrfTokenMiddleware } = await import("../interfaces/middleware/csrf");

        // CSRF token generation for auth routes (login/register/refresh)
        app.use("/api/auth", csrfTokenMiddleware);

        middlewareLogger.debug("CSRF token generation configured for auth routes", {
            operation: "csrf_token_setup",
        });
    }

    /**
     * Configure CSRF validation for state-changing operations
     */
    private static async configureCsrfValidation(app: Express): Promise<void> {
        const { csrfMiddleware } = await import("../interfaces/middleware/csrf");

        // CSRF validation for ALL state-changing operations (browser routes)
        // Note: Bot engine routes are excluded because they use API key auth
        app.use("/api/user", csrfMiddleware);
        app.use("/api/user-profile", csrfMiddleware);
        app.use("/api/user-kodiak", csrfMiddleware);
        app.use("/api/market", csrfMiddleware);
        app.use("/api/strategies", csrfMiddleware);
        app.use("/api/bot", csrfMiddleware);
        app.use("/api/bot-management", csrfMiddleware);
        app.use("/api/balance", csrfMiddleware);
        app.use("/api/wallet", csrfMiddleware);
        app.use("/api/security", csrfMiddleware);

        middlewareLogger.debug("CSRF validation configured for state-changing routes", {
            operation: "csrf_validation_setup",
        });
    }

    /**
     * Configure per-endpoint rate limiting with user-based scaling
     */
    private static async configureRateLimiting(app: Express): Promise<void> {
        const { RateLimiters } = await import("../infrastructure/index");

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
            if (req.path.startsWith('/api/user/kodiak/')) {
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

        middlewareLogger.debug("Per-endpoint rate limiting configured (auth routes excluded from general limits)", {
            operation: "rate_limiting_setup",
        });
    }

    /**
     * Configure specialized Kodiak API protection
     */
    private static async configureKodiakProtection(app: Express): Promise<void> {
        const { kodiakRequestQueue } = await import("../infrastructure/external/kodiak-queue");
        const { authMiddleware } = await import("../interfaces/middleware/auth");
        // 🎯 KODIAK-SPECIFIC PROTECTION: Request queuing + rate limiting for trading routes ONLY
        // EXCLUDE chart/market data routes - they need fast updates for real-time charts
        const kodiakRoutes = [
            "/api/user/kodiak/connect",      // ✅ Connection endpoint - needs protection
            "/api/user/kodiak/positions",    // ✅ Trading data - needs protection
            "/api/user/kodiak/trades",       // ✅ Trading data - needs protection
            "/api/user/kodiak/balance",      // ✅ Trading data - needs protection
            "/api/user/kodiak/account-info", // ✅ Trading data - needs protection            
            "/api/balance/current"           // ✅ Trading data - needs protection
            // ❌ EXCLUDED: /api/market/* routes (charts need real-time updates)
        ];

        // Apply queuing and rate limiting to each Kodiak route
        kodiakRoutes.forEach(route => {
            app.use(route, authMiddleware, (req, res, next) => {
                // Queue requests to comply with Orderly rate limits
                // Wrap next function in Promise to match QueueMiddleware type
                const queued = kodiakRequestQueue.enqueue(req, res, async () => {
                    return new Promise<void>((resolve) => {
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
            app.use(route, async (req, res, next) => {
                // Use connection-specific rate limiter for connect endpoint
                // Use data-specific rate limiter for other endpoints
                const rateLimiter = route === "/api/user/kodiak/connect"
                    ? await this.createKodiakConnectionRateLimiter()
                    : await this.createKodiakRateLimiter();
                rateLimiter(req, res, next);
            });
        });

        middlewareLogger.debug("Kodiak API protection configured for specific routes", {
            routesProtected: kodiakRoutes.length,
            operation: "kodiak_protection_setup",
        });
    }

    /**
     * Create specialized rate limiter for Kodiak routes
     */
    private static async createKodiakRateLimiter() {
        const { createRateLimiter } = await import("../infrastructure/security/rate-limiter.service");

        return createRateLimiter("kodiak-data", {
            max: 20,                   // 20 requests per minute per user (reduced from 60)
            windowMs: 60000,          // 1 minute window
            message: "Kodiak data synchronized with Orderly rate limits",
            progressiveBackoff: true,   // Add delays for frequent requests
            failOpen: false,          // Protect Orderly API - fail closed
            enableUserBasedLimits: true,
            userLimits: {
                [UserLevel.BASIC]: 1,             // Basic users: 1 req/min
                [UserLevel.REGISTERED]: 10,        // Registered users: 10 req/min
                [UserLevel.VERIFIED]: 20,          // Verified users: 20 req/min (reduced from 60)
            },
        });
    }

    /**
     * Create status-specific rate limiter with higher limits
     */
    private static async createKodiakStatusRateLimiter() {
        const { createRateLimiter } = await import("../infrastructure/security/rate-limiter.service");

        return createRateLimiter("kodiak-status", {
            max: 300,                  // 300 requests per minute for status checks
            windowMs: 60000,          // 1 minute window
            message: "Kodiak status check rate limit exceeded",
            progressiveBackoff: false,
            failOpen: true,           // Allow if rate limiting fails - status should be available
            enableUserBasedLimits: true,
            userLimits: {
                [UserLevel.BASIC]: 5,             // Basic users: 5 req/min
                [UserLevel.REGISTERED]: 25,        // Registered users: 25 req/min
                [UserLevel.VERIFIED]: 300,         // Verified users: 300 req/min (full access)
            },
        });
    }

    /**
     * Create connection-specific rate limiter with moderate limits
     */
    private static async createKodiakConnectionRateLimiter() {
        const { createRateLimiter } = await import("../infrastructure/security/rate-limiter.service");

        return createRateLimiter("kodiak-connection", {
            max: 20,                   // 20 requests per minute for connection operations
            windowMs: 60000,          // 1 minute window
            message: "Kodiak connection rate limit exceeded",
            progressiveBackoff: false,
            failOpen: true,           // Allow if rate limiting fails - connection should work
            enableUserBasedLimits: true,
            userLimits: {
                [UserLevel.BASIC]: 2,             // Basic users: 2 req/min
                [UserLevel.REGISTERED]: 10,        // Registered users: 10 req/min
                [UserLevel.VERIFIED]: 20,          // Verified users: 20 req/min
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
     */
    static async configure(app: Express, options: MiddlewareConfigOptions = {}): Promise<void> {
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

        // 🎯 SPECIALIZED KODIAK PROTECTION FIRST: Request queuing + account-based rate limiting
        // MUST come before general rate limiting to override the defaults
        if (config.enableRateLimiting) {
            this.configureKodiakProtection(app);
            this.configuredMiddleware.rateLimiting = true;
        }

        // Per-endpoint rate limiting with user-based limits (after Kodiak protection)
        if (config.enableRateLimiting) {
            this.configureRateLimiting(app);
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
     * Validate middleware configuration
     */
    static validateConfiguration(app: Express): { isValid: boolean; issues: string[] } {
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
