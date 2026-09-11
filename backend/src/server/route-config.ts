/** @format */

import { Express } from "express";
import { Server } from "socket.io";
import { logger, ContextAwareLogger } from "../core/logging";

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
    private static readonly DEFAULT_OPTIONS = {
        enableApiRoutes: true,
        enableHealthRoutes: true,
        io: undefined,
    } as const;

    private static routeLogger = new ContextAwareLogger('route-config');

    /**
     * Register all routes with the Express application
     */
    static async register(app: Express, options: RouteConfigOptions = {}): Promise<void> {
        const config = { ...this.DEFAULT_OPTIONS, ...options };

        // Make io available to routes
        if (config.io) {
            app.set("io", config.io);
        }

        const operationTimer = this.routeLogger.startOperation('route-registration', {
            apiRoutesEnabled: config.enableApiRoutes,
            healthRoutesEnabled: config.enableHealthRoutes,
            socketIoAttached: !!config.io,
        });

        try {
            if (config.enableApiRoutes) {
                await this.registerApiRoutes(app);
            }

            if (config.enableHealthRoutes) {
                await this.registerHealthRoutes(app);
            }

            operationTimer.success({
                routeCount: this.getRegisteredRoutes(app).length,
            });

            this.routeLogger.info("Route registration completed successfully", {
                apiRoutesEnabled: config.enableApiRoutes,
                healthRoutesEnabled: config.enableHealthRoutes,
                socketIoAttached: !!config.io,
            });
        } catch (error) {
            operationTimer.failure(error as Error);
            this.routeLogger.error("Route registration failed", error as Error, {
                apiRoutesEnabled: config.enableApiRoutes,
                healthRoutesEnabled: config.enableHealthRoutes,
                socketIoAttached: !!config.io,
            });
            throw error;
        }
    }

    /**
     * Register all API routes by functional domain
     */
    private static async registerApiRoutes(app: Express): Promise<void> {
        const apiRoutesTimer = this.routeLogger.startOperation('api-routes-registration');

        try {
            // 🔐 Authentication & Authorization
            await this.registerAuthRoutes(app);

            // 👤 User Management
            await this.registerUserRoutes(app);

            // 📊 Market Data & Trading
            await this.registerMarketRoutes(app);

            // 🤖 Bot Management & Engine
            await this.registerBotRoutes(app);

            // 💰 Wallet & Balance
            await this.registerWalletRoutes(app);

            // 🛡️ Security & Monitoring
            await this.registerSecurityRoutes(app);

            apiRoutesTimer.success({
                registeredRoutes: [
                    'auth', 'user', 'market', 'strategies',
                    'bot', 'wallet', 'balance', 'security'
                ]
            });

            this.routeLogger.debug("API routes registered by domain", {
                operation: 'api-routes-registration',
                status: 'completed'
            });
        } catch (error) {
            apiRoutesTimer.failure(error as Error);
            this.routeLogger.error("Failed to register API routes", error as Error, {
                operation: 'api-routes-registration',
                status: 'failed'
            });
            throw error;
        }
    }

    /**
     * Register authentication routes
     */
    private static async registerAuthRoutes(app: Express): Promise<void> {
        const authTimer = this.routeLogger.startOperation('auth-routes-registration');
        try {
            const { authRoutes } = await import("../interfaces/http/auth");
            app.use("/api/auth", authRoutes);
            authTimer.success();
            this.routeLogger.debug("Authentication routes registered", {
                route: '/api/auth',
                component: 'authentication'
            });
        } catch (error) {
            authTimer.failure(error as Error);
            this.routeLogger.error("Failed to register authentication routes", error as Error, {
                route: '/api/auth',
                component: 'authentication'
            });
            throw error;
        }
    }

    /**
     * Register user management routes
     */
    private static async registerUserRoutes(app: Express): Promise<void> {
        const userTimer = this.routeLogger.startOperation('user-routes-registration');
        try {
            const { userRoutes } = await import("../interfaces/http/users");
            app.use("/api/user", userRoutes);
            userTimer.success();
            this.routeLogger.debug("User management routes registered", {
                route: '/api/user',
                component: 'user-management'
            });
        } catch (error) {
            userTimer.failure(error as Error);
            this.routeLogger.error("Failed to register user management routes", error as Error, {
                route: '/api/user',
                component: 'user-management'
            });
            throw error;
        }
    }

    /**
     * Register market data and trading routes
     */
    private static async registerMarketRoutes(app: Express): Promise<void> {
        const marketTimer = this.routeLogger.startOperation('market-routes-registration');
        try {
            const { marketRoutes, strategyRoutes } = await import("../interfaces/http/trading");
            app.use("/api/market", marketRoutes);
            app.use("/api/strategies", strategyRoutes);
            marketTimer.success();
            this.routeLogger.debug("Market and trading routes registered", {
                routes: ['/api/market', '/api/strategies'],
                component: 'market-trading'
            });
        } catch (error) {
            marketTimer.failure(error as Error);
            this.routeLogger.error("Failed to register market and trading routes", error as Error, {
                routes: ['/api/market', '/api/strategies'],
                component: 'market-trading'
            });
            throw error;
        }
    }

    /**
     * Register bot management routes
     */
    private static async registerBotRoutes(app: Express): Promise<void> {
        const botTimer = this.routeLogger.startOperation('bot-routes-registration');
        try {
            const { botRoutes } = await import("../interfaces/http/bots");
            app.use("/api/bot", botRoutes);
            botTimer.success();
            this.routeLogger.debug("Bot management routes registered", {
                route: '/api/bot',
                component: 'bot-management'
            });
        } catch (error) {
            botTimer.failure(error as Error);
            this.routeLogger.error("Failed to register bot management routes", error as Error, {
                route: '/api/bot',
                component: 'bot-management'
            });
            throw error;
        }
    }

    /**
     * Register wallet and balance routes
     */
    private static async registerWalletRoutes(app: Express): Promise<void> {
        const walletTimer = this.routeLogger.startOperation('wallet-routes-registration');
        try {
            const { walletRoutes } = await import("../interfaces/http/wallet");
            const { walletBalanceRoutes } = await import("../interfaces/http/wallet/balance");
            app.use("/api/wallet", walletRoutes);
            app.use("/api/balance", walletBalanceRoutes);
            walletTimer.success();
            this.routeLogger.debug("Wallet and balance routes registered", {
                routes: ['/api/wallet', '/api/balance'],
                component: 'wallet-balance'
            });
        } catch (error) {
            walletTimer.failure(error as Error);
            this.routeLogger.error("Failed to register wallet and balance routes", error as Error, {
                routes: ['/api/wallet', '/api/balance'],
                component: 'wallet-balance'
            });
            throw error;
        }
    }

    /**
     * Register security and monitoring routes
     */
    private static async registerSecurityRoutes(app: Express): Promise<void> {
        const securityTimer = this.routeLogger.startOperation('security-routes-registration');
        try {
            const { securityRoutes } = await import("../interfaces/http/system/security");
            app.use("/api/security", securityRoutes);
            securityTimer.success();
            this.routeLogger.debug("Security routes registered", {
                route: '/api/security',
                component: 'security-monitoring'
            });
        } catch (error) {
            securityTimer.failure(error as Error);
            this.routeLogger.error("Failed to register security routes", error as Error, {
                route: '/api/security',
                component: 'security-monitoring'
            });
            throw error;
        }
    }

    /**
     * Register health check routes
     */
    private static async registerHealthRoutes(app: Express): Promise<void> {
        const healthTimer = this.routeLogger.startOperation('health-routes-registration');
        try {
            const { healthRoutes } = await import("../interfaces/http/system/health");

            // Health check (must be last to catch all routes)
            app.use("/api", healthRoutes);

            healthTimer.success();
            this.routeLogger.debug("Health check routes registered", {
                route: '/api',
                component: 'health-check'
            });
        } catch (error) {
            healthTimer.failure(error as Error);
            this.routeLogger.error("Failed to register health check routes", error as Error, {
                route: '/api',
                component: 'health-check'
            });
            throw error;
        }
    }

    /**
     * Get all registered route paths for debugging/monitoring
     */
    static getRegisteredRoutes(app: Express): string[] {
        const routes: string[] = [];

        // Force Express to initialize the router if it hasn't been already
        // This is necessary for testing purposes
        if (!(app as any)._router) {
            app.use((req, res, next) => next());
        }

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
