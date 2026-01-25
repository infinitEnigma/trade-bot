/** @format */

import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { logger } from "../core/logging";

/**
 * ===========================================
 * 🚀 EXPRESS APPLICATION CONFIGURATION
 * ===========================================
 *
 * Centralized Express.js application setup and configuration.
 * Handles CORS, security middleware, body parsing, and core setup.
 *
 * RESPONSIBILITIES:
 * - Express application initialization
 * - CORS configuration for cross-origin requests
 * - Security middleware (Helmet, CSRF, rate limiting)
 * - Request parsing and body handling
 * - Core middleware setup
 *
 * @format
 */

export interface ExpressConfigOptions {
    /** Whether to enable CORS */
    enableCors?: boolean;

    /** CORS configuration */
    corsOptions?: {
        allowedOrigins?: string[];
        credentials?: boolean;
    };

    /** Whether to enable security middleware */
    enableSecurity?: boolean;

    /** Whether to trust proxy headers */
    trustProxy?: boolean;
}

/**
 * Express Configuration Service
 * Handles all Express.js application setup and middleware configuration
 */
export class ExpressConfig {
    private static readonly DEFAULT_OPTIONS: Required<ExpressConfigOptions> = {
        enableCors: true,
        corsOptions: {
            allowedOrigins: [],
            credentials: true,
        },
        enableSecurity: true,
        trustProxy: true,
    };

    /**
     * Configure Express application with all middleware and settings
     */
    static async configure(app: Express, options: ExpressConfigOptions = {}): Promise<void> {
        const config = { ...this.DEFAULT_OPTIONS, ...options };

        this.configureTrustProxy(app, config);
        this.configureCors(app, config);
        this.configureSecurity(app, config);
        this.configureParsing(app);
        await this.configureLogging(app);

        logger.info("Express application configured successfully", {
            corsEnabled: config.enableCors,
            securityEnabled: config.enableSecurity,
            trustProxy: config.trustProxy,
        });
    }

    /**
     * Configure proxy trust settings
     */
    private static configureTrustProxy(app: Express, config: ExpressConfigOptions): void {
        if (config.trustProxy) {
            // Trust proxy headers from nginx (required for rate limiting with X-Forwarded-For)
            app.set("trust proxy", 1);
            logger.debug("Proxy trust enabled for load balancer headers");
        }
    }

    /**
     * Configure CORS settings
     */
    private static configureCors(app: Express, config: ExpressConfigOptions): void {
        if (!config.enableCors) return;

        const allowedOrigins = config.corsOptions?.allowedOrigins || [
            process.env.FRONTEND_URL,
            process.env.CORS_ORIGIN,
            "http://localhost:3000",
            "http://localhost:5173",
        ].filter(Boolean); // Remove any undefined values

        app.use(
            cors({
                origin: (origin, callback) => {
                    // Allow requests with no origin (like mobile apps or curl requests)
                    if (!origin) return callback(null, true);

                    // Allow explicitly configured origins
                    if (allowedOrigins.includes(origin)) {
                        return callback(null, true);
                    }

                    // For development, allow localhost and local network access
                    if (process.env.NODE_ENV === "development") {
                        const devOrigins = [
                            "http://localhost:3000",
                            "http://localhost:5173",
                            "http://127.0.0.1:3000",
                            "http://127.0.0.1:5173",
                            "https://rewireapp.ddns.net",
                        ];
                        if (devOrigins.includes(origin)) {
                            return callback(null, true);
                        }

                        // Allow local network access (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
                        const networkRegex =
                            /^(https?:\/\/)(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)[\d]+\.[\d]+(:[\d]+)?$/;
                        if (networkRegex.test(origin)) {
                            return callback(null, true);
                        }
                    }

                    logger.warn("CORS policy violation", { origin, allowedOrigins });
                    return callback(new Error("CORS policy violation"));
                },
                credentials: config.corsOptions?.credentials ?? true,
            })
        );

        logger.debug("CORS configured", {
            allowedOrigins: allowedOrigins.length,
            credentials: config.corsOptions?.credentials,
        });
    }

    /**
     * Configure security middleware
     */
    private static configureSecurity(app: Express, config: ExpressConfigOptions): void {
        if (!config.enableSecurity) return;

        // Apply security middleware
        app.use(
            helmet({
                hsts: false, // Disable HSTS - let nginx handle it
                contentSecurityPolicy: {
                    directives: {
                        defaultSrc: ["'self'"],
                        styleSrc: ["'self'", "'unsafe-inline'"],
                        scriptSrc: ["'self'"],
                        imgSrc: ["'self'", "data:", "https:"],
                    },
                },
            })
        );

        logger.debug("Security middleware (Helmet) configured");
    }

    /**
     * Configure request parsing middleware
     */
    private static configureParsing(app: Express): void {
        // Parse cookies
        app.use(cookieParser());

        // Parse JSON bodies
        app.use(express.json());

        // Note: Removed global rate limiter - now using per-endpoint limits
        // Rate limiting is handled per-endpoint with user-based limits

        logger.debug("Request parsing middleware configured");
    }

    /**
     * Configure logging and monitoring middleware
     */
    private static async configureLogging(app: Express): Promise<void> {
        // Request context middleware (must be first)
        const { contextMiddleware } = await import("../interfaces/middleware/context.js");
        app.use(contextMiddleware);

        // HTTP request logging middleware
        const { httpLogger } = await import("../interfaces/middleware/logger.js");
        app.use(httpLogger);

        logger.debug("Logging and monitoring middleware configured");
    }

    /**
     * Create and configure a new Express application
     */
    static createApp(options: ExpressConfigOptions = {}): Express {
        const app = express();

        // Configure the app asynchronously but return the app synchronously
        // This is a common pattern for Express apps - configure async but return sync
        this.configure(app, options).catch((error) => {
            logger.error("Failed to configure Express application", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error; // Re-throw to fail fast in development
        });

        return app;
    }
}