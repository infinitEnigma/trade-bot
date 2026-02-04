/**
 * ===========================================
 * 🚀 TRADE BOT BACKEND APPLICATION
 * ===========================================
 *
 * Main application entry point for the Trade Bot platform.
 * Handles HTTP API routes, WebSocket connections, and system orchestration.
 *
 * Architecture:
 * - Express.js REST API server
 * - Socket.IO WebSocket server for real-time updates
 * - PostgreSQL database with Redis caching
 * - JWT authentication with CSRF protection
 * - Bot engine management and monitoring
 *
 * Security Model:
 * - Browser routes: JWT + CSRF protection
 * - Engine routes: API key authentication
 * - WebSocket: JWT authentication required
 *
 * @format
 */

import "dotenv/config";
// 📦 Express.js core dependencies - used by ExpressConfig service
// These imports are required by the centralized Express configuration
import _express from "express";
import _cors from "cors";
import _helmet from "helmet";
import _rateLimit from "express-rate-limit";
import _cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";

// ===========================================
// 📋 TABLE OF CONTENTS
// ===========================================
// 1. Environment Setup & Validation
// 2. Module Imports & Dependencies
// 3. Database & Redis Initialization
// 4. Client Connection Tracking
// 5. Express Application Setup
// 6. Security & Authentication Middleware
// 7. Route Registration
// 8. WebSocket Server Configuration
// 9. Server Lifecycle Management
// 10. Graceful Shutdown Handling
// ===========================================

// ===========================================
// 🔧 1. ENVIRONMENT SETUP & VALIDATION
// ===========================================
// Validates required environment variables and secrets
// Ensures production security requirements are met
// ===========================================

// Import logger first before any other code
import { contextLogger as logger } from "./core/logging";

// Application start time for uptime tracking
const START_TIME = Date.now();

// Environment validation module
export const REQUIRED_ENV_VARS = [
    "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", // PostgreSQL
    "REDIS_URL", // Redis cache
    "JWT_SECRET", "JWT_REFRESH_SECRET", // Authentication
    "ENCRYPTION_MASTER_KEY", // Data encryption
    "NODE_ENV", // Runtime environment
    "KODIAK_API_URL", "KODIAK_WS_URL", // External APIs
    "FRONTEND_URL", // CORS configuration
];

/**
 * Validates all required environment variables are present
 * Performs security checks for production deployments
 */
export function validateEnvironment(): void {
    const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);

    if (missing.length > 0) {
        logger.error("❌ Missing required environment variables");
        missing.forEach(key => logger.error(`   - ${key}`));
        logger.error("💡 Create .env file from .env.example template");
        throw new Error("Missing required environment variables");
    }

    // 🔐 Validate secret strength in production
    if (process.env.NODE_ENV === "production") {
        const secrets = [
            "JWT_SECRET",
            "JWT_REFRESH_SECRET",
            "ENCRYPTION_MASTER_KEY",
        ];
        secrets.forEach(key => {
            const value = process.env[key];
            if (!value) {
                logger.error(`🔴 SECURITY: ${key} is missing in production environment`);
                throw new Error(`Missing required secret: ${key}`);
            }
            if (value.length < 32) {
                logger.error(
                    `🔴 SECURITY: ${key} must be at least 32 characters in production. Current length: ${value.length}`
                );
                throw new Error(`Insufficient secret length for ${key}`);
            }
        });
    }

    logger.info("✅ Environment validation passed");
}

validateEnvironment();

// ===========================================
// 📦 2. MODULE IMPORTS & DEPENDENCIES
// ===========================================
// Core services and configuration modules
// ===========================================

// � Server Configuration Services
import { ExpressConfig } from "./server/express-config";
import { RouteConfig } from "./server/route-config";
import { MiddlewareConfig } from "./server/middleware-config";

// 📡 Real-time Services
import { marketStreamService } from "./infrastructure";

// 🔄 Infrastructure Services
import { redisService } from "./infrastructure";

// 🏭 Dependency Injection Container
import { diContainer } from "./infrastructure/dependency-injection.container";

// 🤖 Bot Reconciliation Worker (initialized after database)
// TEMPORARILY DISABLED: Possible Kodiak rate limiting issue in production
// Import kept for future re-enablement when rate limiting is resolved
import { botReconciliationWorker as _botReconciliationWorker } from "./workers/bot-reconciliation";

// ===========================================
// 🗄️ 3. DATABASE & REDIS INITIALIZATION
// ===========================================
// Critical infrastructure setup - must succeed before routes
// Handles connection pooling and caching layer initialization
// ===========================================

// ✅ Initialize database pool first (before routes)
import { initializePool, closePool } from "./database/pool";

// Initialize PostgreSQL connection pool
try {
    initializePool();
    logger.info("✅ PostgreSQL connection pool initialized");
} catch (error) {
    logger.error("❌ Failed to initialize database pool", error instanceof Error ? error : new Error(String(error)));
    throw new Error("Database pool initialization failed");
}

// Connect to Redis on startup (now imported from infrastructure)
redisService.connect().catch((error: unknown) => {
    logger.error("❌ Failed to connect to Redis", error instanceof Error ? error : new Error(String(error)));
    // Note: Application continues without Redis (degraded mode)
});

// Initialize dependency injection container
diContainer.initialize().catch((error) => {
    logger.error("❌ Failed to initialize dependency injection container", error instanceof Error ? error : new Error(String(error)));
    throw new Error("Dependency injection container initialization failed");
});

// ===========================================
// 📊 4. CLIENT CONNECTION TRACKING
// ===========================================
// Tracks active WebSocket connections and API activity
// Provides monitoring data for load balancing and scaling
// ===========================================

let activeClients = 0;
let lastActivityTime = Date.now();

/**
 * Updates active client count and stores in Redis for monitoring
 * DEFERRED: Will be integrated with WebSocket connection tracking when monitoring dashboard is implemented
 */
const _updateClientCount = async (change: number) => {
    activeClients = Math.max(0, activeClients + change);
    lastActivityTime = Date.now();
    logger.info(`Active clients: ${activeClients}`, {
        lastActivity: new Date(lastActivityTime).toLocaleTimeString(),
    });

    // Store client count in Redis for monitoring
    const clientCountResult = await redisService.setex(
        "active_clients",
        60,
        activeClients.toString()
    );
    if (!clientCountResult.success) {
        logger.warn("Failed to store active client count in Redis", {
            activeClients,
            error: clientCountResult.error,
        });
    }
};

/**
 * Tracks HTTP API activity timestamps
 * DEFERRED: Will be integrated with analytics service when implemented
 */
const _trackApiActivity = () => {
    lastActivityTime = Date.now();
    // Removed artificial client count manipulation that was causing issues
};

// ===========================================
// 🚀 5. EXPRESS APPLICATION & SERVER SETUP
// ===========================================
// Configures Express.js application and Socket.IO server
// Uses centralized configuration services for clean setup
// ===========================================

// Create Express application with full configuration
const app = ExpressConfig.createApp({
    enableCors: true,
    corsOptions: {
        allowedOrigins: [
            process.env.FRONTEND_URL,
            process.env.CORS_ORIGIN,
            "http://localhost:3000",
            "http://localhost:5173",
        ].filter((origin): origin is string => Boolean(origin)),
        credentials: true,
    },
    enableSecurity: true,
    trustProxy: true,
});

// Create HTTP server for both Express and WebSocket support
const httpServer = createServer(app);

// Initialize Socket.IO with CORS configuration
const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);

            // Allow explicitly configured origins
            const allowedOrigins = [
                process.env.FRONTEND_URL,
                process.env.CORS_ORIGIN,
                "http://localhost:3000",
                "http://localhost:5173",
            ].filter(Boolean);

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

            return callback(new Error("CORS policy violation"));
        },
        methods: ["GET", "POST"],
        credentials: true,
    },
});

// Make io available to routes
app.set("io", io);

// ===========================================
// 🛡️ 6. MIDDLEWARE CONFIGURATION
// ===========================================
// Configures security middleware, CSRF protection, and rate limiting
// Uses centralized middleware configuration service
// ===========================================

MiddlewareConfig.configure(app, {
    enableCsrf: true,
    enableRateLimiting: true,
    enableActivityTracking: true,
});

// ===========================================
// 🛤️ 7. ROUTE REGISTRATION
// ===========================================
// Mounts all API route handlers using centralized route configuration
// Routes are organized by functional domain for clarity
// ===========================================

// Register routes asynchronously
let routeRegistrationPromise: Promise<void>;
(async () => {
    try {
        await RouteConfig.register(app, {
            enableApiRoutes: true,
            enableHealthRoutes: true,
            io, // Pass Socket.IO server for routes that need it
        });
        routeRegistrationPromise = Promise.resolve();
    } catch (error) {
        logger.error("Failed to register routes", error instanceof Error ? error : new Error(String(error)));
        process.exitCode = 1;
        routeRegistrationPromise = Promise.resolve(); // Don't reject to avoid unhandled rejection
    }
})();

// ===========================================
// 🚨 7.5 UNIFIED ERROR HANDLING MIDDLEWARE
// ===========================================
// Enterprise-grade error handling with structured responses
// Provides consistent error formatting across all endpoints
// ===========================================

import { handleErrors } from "./interfaces/middleware/error-handler";

app.use(handleErrors);

// ===========================================
// 🌐 8. WEBSOCKET SERVICE INITIALIZATION
// ===========================================
// Initialize the extracted WebSocket service for real-time communication
// Handles authentication, subscriptions, and market data streaming
// ===========================================

// Import the WebSocket service
import { WebSocketService } from "./infrastructure/messaging";

// Initialize WebSocket service with Socket.IO server
const webSocketService = new WebSocketService(
    marketStreamService,
    diContainer.authService,
    logger
);

webSocketService.initialize(io);

// ===========================================
// ⚙️ 9. SERVER LIFECYCLE MANAGEMENT
// ===========================================
// Exports server control functions instead of automatically starting
// Allows for explicit server start/stop in tests and applications
// ===========================================

const PORT = process.env.PORT || 3000;

/**
 * Starts the HTTP and WebSocket server
 * @returns A promise that resolves when the server is ready
 */
export const startServer = (): Promise<typeof httpServer> => {
    return new Promise((resolve) => {
        httpServer.listen(PORT, () => {
            logger.info(`🚀 Server running on port ${PORT}`);
            logger.info("🌐 WebSocket server ready");
            logger.info(`🏭 Environment: ${process.env.NODE_ENV || "development"}`);

            // ✅ START BOT RECONCILIATION WORKER (after database is ready)
            // TEMPORARILY DISABLED - POSSIBLE KODIAK RATE LIMITING ISSUE
            logger.info("Bot reconciliation worker temporarily disabled for production stability");
            /*
            botReconciliationWorker.start().catch((error) => {
                logger.error("Failed to start bot reconciliation worker", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            */

            // 🚫 DEFERRED: Market stream service - only initialize when VERIFIED users connect
            // marketStreamService.setSocketServer(io);
            logger.info(
                "📡 Market stream service deferred - initializes only for VERIFIED users"
            );

            // 🚫 DEFERRED: Bot status service - only initialize when VERIFIED users with bots connect
            // botStatusService.initializeBackgroundProcesses()
            logger.info(
                "🤖 Bot status service deferred - initializes only for VERIFIED users with active bots"
            );

            // 🚫 TEMPORARILY DISABLED: Worker shutdown handlers
            // Dynamic import causing issues with ts-node-dev ES modules
            // Will re-enable once core functionality is stable
            logger.info("Worker shutdown handlers temporarily disabled for stability", {
                reason: "Dynamic ES module import issues with ts-node-dev",
                status: "Core functionality remains fully operational",
            });

            resolve(httpServer);
        });
    });
};

/**
 * Stops the HTTP and WebSocket server gracefully
 * @returns A promise that resolves when the server is stopped
 */
export const stopServer = (...args: any[]): Promise<void> => {
    return new Promise((resolve, reject) => {
        // Check if server is actually running before trying to close
        // This prevents errors in test environments where server might not have been started
        try {
            // In test/mock environments, this check may fail, so we'll try to close directly
            // with error handling
            httpServer.close((err) => {
                if (err) {
                    // If error is about server not running, just resolve
                    if (err.message && err.message.includes("Server is not running")) {
                        resolve();
                    } else {
                        logger.error("Error closing HTTP server", err);
                        reject(err);
                    }
                } else {
                    logger.info("HTTP server closed - no longer accepting connections");
                    resolve();
                }
            });
        } catch (error) {
            // If we get any error during close (including "Server is not running"), resolve
            resolve();
        }
    });
};

// ===========================================
// 🛑 10. GRACEFUL SHUTDOWN HANDLING
// ===========================================
// Implements clean shutdown sequence to prevent data loss
// Closes connections gracefully and logs shutdown progress
// ===========================================

/**
 * Graceful shutdown handler
 * Ensures all connections are properly closed before exiting
 */
let shutdownInProgress = false;
const gracefulShutdown = async (signal: string): Promise<void> => {
    // Prevent multiple shutdown attempts
    if (shutdownInProgress) {
        logger.warn(`Shutdown already in progress, ignoring ${signal}`, {
            uptime: Math.floor((Date.now() - START_TIME) / 1000),
            activeClients,
        });
        return;
    }

    shutdownInProgress = true;
    logger.info(`${signal} received, starting graceful shutdown sequence`, {
        uptime: Math.floor((Date.now() - START_TIME) / 1000),
        activeClients,
    });

    const shutdownStart = Date.now();
    let shutdownCompleted = false;

    // Set a maximum shutdown timeout (30 seconds)
    const shutdownTimeout = setTimeout(() => {
        if (!shutdownCompleted) {
            logger.warn(
                "Forced shutdown after timeout - some connections may not be cleanly closed",
                {
                    shutdownDuration: Date.now() - shutdownStart,
                }
            );

            // Don't call process.exit() in test environment to avoid test failure
            if (process.env.NODE_ENV === "test") {
                shutdownCompleted = true;
                logger.warn("Graceful shutdown timed out");
                process.exitCode = 1;
            } else {
                logger.warn("Process will exit due to shutdown timeout");
                process.exit(1); // Force exit after timeout
            }
        }
    }, 30000);

    try {
        // Phase 1: Stop accepting new connections
        logger.info("Phase 1: Stopping new connections");
        await stopServer();

        // Phase 2: Close external service connections
        logger.info("Phase 2: Closing external connections");

        // Disconnect market stream WebSockets
        try {
            marketStreamService.disconnectAll();
            logger.info("Market stream connections closed");
        } catch (error) {
            logger.error("Error closing market stream connections", error instanceof Error ? error : new Error(String(error)));
        }

        // Disconnect Redis
        try {
            await redisService.disconnect();
            logger.info("Redis connection closed");
        } catch (error) {
            logger.error("Error closing Redis connection", error instanceof Error ? error : new Error(String(error)));
        }

        // Phase 3: Close database connections
        logger.info("Phase 3: Closing database connections");
        try {
            await closePool();
            logger.info("Database pool closed");
        } catch (error) {
            logger.error("Error closing database pool", error instanceof Error ? error : new Error(String(error)));
        }

        // Phase 4: Final cleanup
        logger.info("Phase 4: Final cleanup completed");

        const shutdownDuration = Date.now() - shutdownStart;
        logger.info("Graceful shutdown completed successfully", {
            shutdownDurationMs: shutdownDuration,
            shutdownDurationSec: Math.floor(shutdownDuration / 1000),
        });

        shutdownCompleted = true;
        clearTimeout(shutdownTimeout);

        // Don't call process.exit() in test environment to avoid test failure
        if (process.env.NODE_ENV !== "test") {
            process.exit(0); // Exit cleanly after successful shutdown
        }
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("Critical error during graceful shutdown", err as unknown as Error, {
            shutdownDuration: Date.now() - shutdownStart,
        });
        shutdownCompleted = true;
        clearTimeout(shutdownTimeout);

        // Don't call process.exit() in test environment to avoid test failure
        if (process.env.NODE_ENV === "test") {
            throw error;
        } else {
            process.exit(1); // Exit with error code
        }
    }
};

// ✅ Register graceful shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions (development safety net)
process.on("uncaughtException", error => {
    logger.error("Uncaught exception - initiating emergency shutdown", error);
    gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, _promise) => {
    logger.error("Unhandled promise rejection - initiating emergency shutdown", reason instanceof Error ? reason : new Error(String(reason)));
    gracefulShutdown("unhandledRejection");
});

// Auto-start server only when directly run (not imported as module)
if (require.main === module) {
    startServer().catch(error => {
        logger.error("Failed to start server", error instanceof Error ? error : new Error(String(error)));
        // Use process.exitCode instead of process.exit() for cleaner termination
        process.exitCode = 1;
    });
}

export { app, io };
