/** @format */

import { Express } from "express";
import { Server } from "socket.io";
import { logger } from "../core/logging";

/**
 * ===========================================
 * 🛤️ ROUTE REGISTRATION SERVICE
 * ===========================================
 *
 * Centralized route mounting and API endpoint registration.
 * Organizes all HTTP routes by functional domain for clarity.
 *
 * RESPONSIBILITIES:
 * - HTTP route mounting by domain (auth, user, market, etc.)
 * - Route organization and grouping
 * - API endpoint registration
 * - Health check endpoints
 * - Socket.IO server attachment to routes
 *
 * ORGANIZATION:
 * - 🔐 Authentication & Authorization routes
 * - 👤 User Management routes
 * - 📊 Market Data & Trading routes
 * - 🤖 Bot Management routes
 * - 💰 Wallet & Balance routes
 * - 🛡️ Security & Monitoring routes
 * - 🏥 Health Check routes
 *
 * @format
 */

export interface RouteConfigOptions {
    /** Whether to enable API routes */
    enableApiRoutes?: boolean;

    /** Whether to enable health check routes */
    enableHealthRoutes?: boolean;

    /** Socket.IO server instance for route access */
    io?: Server;
}

/**
 * Route Configuration Service
 * Handles all HTTP route registration and mounting
 */
export class RouteConfig {
    private static readonly DEFAULT_OPTIONS: Required<RouteConfigOptions> = {
        enableApiRoutes: true,
        enableHealthRoutes: true,
        io: undefined as any,
    };

    /**
     * Register all routes with the Express application
     */
    static register(app: Express, options: RouteConfigOptions = {}): void {
        const config = { ...this.DEFAULT_OPTIONS, ...options };

        // Make io available to routes
        if (config.io) {
            app.set("io", config.io);
        }

        if (config.enableApiRoutes) {
            this.registerApiRoutes(app);
        }

        if (config.enableHealthRoutes) {
            this.registerHealthRoutes(app);
        }

        logger.info("Route registration completed", {
            apiRoutesEnabled: config.enableApiRoutes,
            healthRoutesEnabled: config.enableHealthRoutes,
            socketIoAttached: !!config.io,
        });
    }

    /**
     * Register all API routes by functional domain
     */
    private static registerApiRoutes(app: Express): void {
        // 🔐 Authentication & Authorization
        this.registerAuthRoutes(app);

        // 👤 User Management
        this.registerUserRoutes(app);

        // 📊 Market Data & Trading
        this.registerMarketRoutes(app);

        // 🤖 Bot Management & Engine
        this.registerBotRoutes(app);

        // 💰 Wallet & Balance
        this.registerWalletRoutes(app);

        // 🛡️ Security & Monitoring
        this.registerSecurityRoutes(app);

        logger.debug("API routes registered by domain");
    }

    /**
     * Register authentication routes
     */
    private static registerAuthRoutes(app: Express): void {
        const { authRoutes } = require("../interfaces/http/auth");
        app.use("/api/auth", authRoutes);
        logger.debug("Authentication routes registered");
    }

    /**
     * Register user management routes
     */
    private static registerUserRoutes(app: Express): void {
        const { userRoutes } = require("../interfaces/http/users");
        app.use("/api/user", userRoutes);
        logger.debug("User management routes registered");
    }

    /**
     * Register market data and trading routes
     */
    private static registerMarketRoutes(app: Express): void {
        const { marketRoutes, strategyRoutes } = require("../interfaces/http/trading");
        app.use("/api/market", marketRoutes);
        app.use("/api/strategies", strategyRoutes);
        logger.debug("Market and trading routes registered");
    }

    /**
     * Register bot management routes
     */
    private static registerBotRoutes(app: Express): void {
        const { botRoutes, botEngineRoutes, botManagementRoutes } = require("../interfaces/http/bots");
        app.use("/api/bot", botRoutes);
        logger.debug("Bot management routes registered");
    }

    /**
     * Register wallet and balance routes
     */
    private static registerWalletRoutes(app: Express): void {
        const { walletRoutes } = require("../interfaces/http/wallet");
        const { balanceRoutes } = require("../interfaces/http/wallet/balance");
        app.use("/api/wallet", walletRoutes);
        app.use("/api/balance", balanceRoutes);
        logger.debug("Wallet and balance routes registered");
    }

    /**
     * Register security and monitoring routes
     */
    private static registerSecurityRoutes(app: Express): void {
        const { securityRoutes } = require("../interfaces/http/system");
        app.use("/api/security", securityRoutes);
        logger.debug("Security routes registered");
    }

    /**
     * Register health check routes
     */
    private static registerHealthRoutes(app: Express): void {
        const { healthRoutes } = require("../interfaces/http/system");

        // Health check (must be last to catch all routes)
        app.use("/api", healthRoutes);

        logger.debug("Health check routes registered");
    }

    /**
     * Get all registered route paths for debugging/monitoring
     */
    static getRegisteredRoutes(app: Express): string[] {
        const routes: string[] = [];

        // Walk through the Express app's router stack
        const stack = (app as any)._router?.stack;
        if (stack) {
            for (const layer of stack) {
                if (layer.route) {
                    const methods = Object.keys(layer.route.methods).join(", ").toUpperCase();
                    routes.push(`${methods} ${layer.route.path}`);
                } else if (layer.name === "router" && layer.regexp) {
                    // Mounted router
                    const mountPath = layer.regexp.toString()
                        .replace(/^\/\^/, "")
                        .replace(/\/\(\?:\(\[\^\/\]\+\)\)\?\)\?\$\/i/, "")
                        .replace(/\\/g, "");
                    routes.push(`MOUNT ${mountPath}`);
                }
            }
        }

        return routes;
    }

    /**
     * Validate that all expected routes are registered
     */
    static validateRouteRegistration(app: Express): { isValid: boolean; missingRoutes: string[] } {
        const registeredRoutes = this.getRegisteredRoutes(app);
        const expectedRoutes = [
            "MOUNT /api/auth",
            "MOUNT /api/user",
            "MOUNT /api/market",
            "MOUNT /api/strategies",
            "MOUNT /api/bot",
            "MOUNT /api/wallet",
            "MOUNT /api/balance",
            "MOUNT /api/security",
            "MOUNT /api", // Health routes
        ];

        const missingRoutes = expectedRoutes.filter(expected =>
            !registeredRoutes.some(registered => registered.includes(expected))
        );

        return {
            isValid: missingRoutes.length === 0,
            missingRoutes,
        };
    }
}
