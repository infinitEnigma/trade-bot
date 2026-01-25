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
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
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
import { logger } from "./core/logging";

// Application start time for uptime tracking
const START_TIME = Date.now();

// Required environment variables for application startup
const REQUIRED_ENV_VARS = [
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
function validateEnvironment(): void {
    const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);

    if (missing.length > 0) {
        logger.error("❌ Missing required environment variables");
        missing.forEach(key => logger.error(`   - ${key}`));
        logger.error("💡 Create .env file from .env.example template");
        process.exit(1);
    }

    // 🔐 Validate secret strength in production
    if (process.env.NODE_ENV === "production") {
        const secrets = [
            "JWT_SECRET",
            "JWT_REFRESH_SECRET",
            "ENCRYPTION_MASTER_KEY",
        ];
        secrets.forEach(key => {
            const value = process.env[key]!;
            if (value.length < 32) {
                logger.error(
                    `🔴 SECURITY: ${key} must be at least 32 characters in production. Current length: ${value.length}`
                );
                process.exit(1);
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
import { botReconciliationWorker } from "./workers/bot-reconciliation";

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
    logger.error("❌ Failed to initialize database pool", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
}

// Connect to Redis on startup (now imported from infrastructure)
redisService.connect().catch((error: any) => {
    logger.error("❌ Failed to connect to Redis", {
        error: error instanceof Error ? error.message : String(error),
    });
    // Note: Application continues without Redis (degraded mode)
});

// Initialize dependency injection container
diContainer.initialize().catch((error) => {
    logger.error("❌ Failed to initialize dependency injection container", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
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
 */
const updateClientCount = async (change: number) => {
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
 */
const trackApiActivity = () => {
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
(async () => {
    try {
        await RouteConfig.register(app, {
            enableApiRoutes: true,
            enableHealthRoutes: true,
            io, // Pass Socket.IO server for routes that need it
        });
    } catch (error) {
        logger.error("Failed to register routes", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
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
// Starts the HTTP/WebSocket server and initializes services
// Configures service dependencies and startup logging
// ===========================================

const PORT = process.env.PORT || 3000;

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
});

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
const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, starting graceful shutdown sequence`, {
        uptime: Math.floor((Date.now() - START_TIME) / 1000),
        activeClients,
    });

    const shutdownStart = Date.now();
    let shutdownCompleted = false;

    // Set a maximum shutdown timeout (30 seconds)
    const shutdownTimeout = setTimeout(() => {
        if (!shutdownCompleted) {
            logger.error(
                "Forced shutdown after timeout - some connections may not be cleanly closed",
                {
                    shutdownDuration: Date.now() - shutdownStart,
                }
            );
            process.exit(1);
        }
    }, 30000);

    try {
        // Phase 1: Stop accepting new connections
        logger.info("Phase 1: Stopping new connections");
        httpServer.close(err => {
            if (err) {
                logger.error("Error closing HTTP server", { error: err.message });
            } else {
                logger.info("HTTP server closed - no longer accepting connections");
            }
        });

        // Phase 2: Close external service connections
        logger.info("Phase 2: Closing external connections");

        // Disconnect market stream WebSockets
        try {
            marketStreamService.disconnectAll();
            logger.info("Market stream connections closed");
        } catch (error) {
            logger.error("Error closing market stream connections", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Disconnect Redis
        try {
            await redisService.disconnect();
            logger.info("Redis connection closed");
        } catch (error) {
            logger.error("Error closing Redis connection", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Phase 3: Close database connections
        logger.info("Phase 3: Closing database connections");
        try {
            await closePool();
            logger.info("Database pool closed");
        } catch (error) {
            logger.error("Error closing database pool", {
                error: error instanceof Error ? error.message : String(error),
            });
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
        process.exit(0);
    } catch (error) {
        logger.error("Critical error during graceful shutdown", {
            error: error instanceof Error ? error.message : String(error),
            shutdownDuration: Date.now() - shutdownStart,
        });
        shutdownCompleted = true;
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
};

// ✅ Register graceful shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions (development safety net)
process.on("uncaughtException", error => {
    logger.error("Uncaught exception - initiating emergency shutdown", {
        error: error.message,
        stack: error.stack,
    });
    gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled promise rejection - initiating emergency shutdown", {
        reason: reason instanceof Error ? reason.message : String(reason),
    });
    gracefulShutdown("unhandledRejection");
});

export { app, io };
