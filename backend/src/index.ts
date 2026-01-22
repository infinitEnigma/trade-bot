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
// Route handlers, middleware, and service dependencies
// Organized by functional area for better maintainability
// ===========================================

// 🔐 Authentication & Authorization
import { authRoutes } from "./interfaces/http/auth";

// 👤 User Management
import { userRoutes, userProfileRoutes, userKodiakRoutes } from "./interfaces/http/users";

// 📊 Market Data & Trading
import { marketRoutes, strategyRoutes } from "./interfaces/http/trading";

// 🤖 Bot Management & Engine
import { botRoutes, botEngineRoutes, botManagementRoutes } from "./interfaces/http/bots";

//  Wallet & Qualification
import { walletRoutes } from "./interfaces/http/wallet";
import { balanceRoutes } from "./interfaces/http/wallet/balance";

// ️ Security & Monitoring
import { healthRoutes, securityRoutes } from "./interfaces/http/system";

// 🔧 Middleware Stack
import { httpLogger, errorLogger } from "./interfaces/middleware/logger";
import { contextMiddleware } from "./interfaces/middleware/context";
import { csrfMiddleware, csrfTokenMiddleware, CSRFRequest } from "./interfaces/middleware/csrf";

// 📡 Real-time Services
import { marketStreamService } from "./infrastructure";
import { authService } from "./core/auth";
import { botStatusService } from "./core/trading";

// 🛡️ Rate Limiting
import { RateLimiters } from "./infrastructure";

// 🔄 Infrastructure Services (moved to infrastructure/)
import { redisService } from "./infrastructure";

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
// 🚀 5. EXPRESS APPLICATION SETUP
// ===========================================
// Configures Express.js application with CORS, security, and body parsing
// Sets up HTTP server and Socket.IO for real-time communication
// ===========================================

const app = express();

// Trust proxy headers from nginx (required for rate limiting with X-Forwarded-For)
app.set("trust proxy", 1);

// Create HTTP server for both Express and WebSocket support
const httpServer = createServer(app);

// Initialize Socket.IO with CORS configuration
const io = new Server(httpServer, {
    cors: {
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

            return callback(new Error("CORS policy violation"));
        },
        methods: ["GET", "POST"],
        credentials: true,
    },
});

// Configure CORS allowed origins
const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGIN,
    "http://localhost:3000",
    "http://localhost:5173",
].filter(Boolean); // Remove any undefined values

// Apply CORS middleware
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

            return callback(new Error("CORS policy violation"));
        },
        credentials: true,
    })
);

// Apply security middleware
app.use(
    helmet({
        hsts: false, // Disable HSTS - let nginx handle it
    })
);

// Parse incoming requests
app.use(cookieParser());
app.use(express.json());

// ✅ REMOVED GLOBAL RATE LIMITER - Now using per-endpoint limits
// Rate limiting is now handled per-endpoint with user-based limits

// Request context middleware (must be first)
app.use(contextMiddleware);

// HTTP request logging middleware
app.use(httpLogger);

// Make io available to routes
app.set("io", io);

// API activity tracking middleware
app.use("/api", (req, res, next) => {
    trackApiActivity();
    next();
});

// ===========================================
// 🛡️ 6. SECURITY & AUTHENTICATION MIDDLEWARE
// ===========================================
// Configures CSRF protection, rate limiting, and authentication
// Different security models for browser vs server communication
// ===========================================

// CSRF token generation for auth routes (login/register/refresh)
app.use("/api/auth", csrfTokenMiddleware);

// CSRF validation for ALL state-changing operations (browser routes)
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

// 🔐 SECURITY ARCHITECTURE NOTE:
// - Browser routes: JWT + CSRF protection (state-changing operations)
// - Engine routes: API key authentication (server-to-server communication)
// - CSRF is NOT applied to /api/bot-engine routes because:
//   1. Bot engine is internal system making direct HTTP calls
//   2. Engine doesn't have browser cookies or CSRF tokens
//   3. CSRF is meant for browser-based attacks, not server communication
//   4. Bot engine routes are protected by API key authentication instead

// ===========================================
// 🛡️ 6.5 PER-ENDPOINT RATE LIMITING
// ===========================================
// Applies sophisticated rate limiting per endpoint with user-based limits
// Prevents single users from exhausting global limits
// ===========================================

// 🔐 Authentication endpoints - Login exempt from rate limiting for smooth UX
// Other auth operations (profile checks, etc.) still rate limited

// 👤 Profile endpoints (lenient rate limiting for periodic checks)
app.use("/api/auth/me", RateLimiters.public);
app.use("/api/auth/check-qualification", RateLimiters.public);
app.use("/api/auth/qualification-config", RateLimiters.public);
app.use("/api/auth/csrf-token", RateLimiters.public);
app.use("/api/auth/logout", RateLimiters.public);

// 👤 User management endpoints (moderate limits)
app.use("/api/user", RateLimiters.public);
app.use("/api/user-profile", RateLimiters.public);
app.use("/api/user-kodiak", RateLimiters.kodiakStatus);

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

// ===========================================
// 🛤️ 7. ROUTE REGISTRATION
// ===========================================
// Mounts all API route handlers with proper middleware order
// Routes are organized by functional domain for clarity
// ===========================================

// 🔐 Authentication & Authorization
app.use("/api/auth", authRoutes);

// 👤 User Management
app.use("/api/user", userRoutes);

// 📊 Market Data & Trading
app.use("/api/market", marketRoutes);
app.use("/api/strategies", strategyRoutes);

// 🤖 Bot Management & Engine
app.use("/api/bot", botRoutes);
app.use("/api/balance", balanceRoutes);

//  Wallet & Qualification
app.use("/api/wallet", walletRoutes);

// 🛡️ Security & Monitoring
app.use("/api/security", securityRoutes);

// 🏥 Health Check (must be last to catch all routes)
app.use("/api", healthRoutes);

// ===========================================
// 🚨 7.5 ERROR HANDLING MIDDLEWARE
// ===========================================
// Global error handling - must be last middleware in stack
// Catches and formats all unhandled errors consistently
// ===========================================

app.use(
    (
        err: Error,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        logger.error("Unhandled error", { error: err.message, stack: err.stack });
        res.status(500).json({
            success: false,
            error: "Internal server error",
            timestamp: Date.now(),
        });
    }
);

// ===========================================
// 🌐 8. WEBSOCKET SERVER CONFIGURATION
// ===========================================
// Configures Socket.IO with JWT authentication and context propagation
// Handles market data subscriptions, bot status updates, and user notifications
// Ensures correlation ID tracking across HTTP/WebSocket boundaries
// ===========================================

// Import context utilities for WebSocket context propagation
import { setRequestContext, generateCorrelationId, generateRequestId, runInContext } from "./shared/utils/context";

// ✅ WebSocket Context & Authentication Middleware
io.use(async (socket, next) => {
    try {
        // Extract correlation ID from handshake headers (passed from HTTP request)
        const correlationId = (socket.handshake.headers['x-correlation-id'] as string) || generateCorrelationId();

        const token =
            socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization?.replace("Bearer ", "");

        if (!token) {
            logger.warn("WebSocket connection rejected: No JWT token", {
                socketId: socket.id,
                ip: socket.handshake.address,
                correlationId,
            });
            return next(new Error("Authentication required"));
        }

        // Verify JWT token
        const decoded = await authService.validateToken(token);
        if (!decoded) {
            logger.warn("WebSocket connection rejected: Invalid JWT token", {
                socketId: socket.id,
                ip: socket.handshake.address,
                correlationId,
            });
            return next(new Error("Invalid token"));
        }

        // Verify user still exists and is active
        const user = await authService.getUserById(decoded.userId);
        if (!user) {
            logger.warn("WebSocket connection rejected: User not found", {
                socketId: socket.id,
                userId: decoded.userId,
                ip: socket.handshake.address,
                correlationId,
            });
            return next(new Error("User not found"));
        }

        // ✅ REQUIRE VERIFIED user level for WebSocket access
        // Only VERIFIED users can access real-time market data
        if (user.userLevel !== 'VERIFIED') {
            logger.warn("WebSocket connection rejected: User not VERIFIED", {
                socketId: socket.id,
                userId: decoded.userId,
                userLevel: user.userLevel,
                email: user.email,
                ip: socket.handshake.address,
                correlationId,
            });
            return next(new Error("Real-time data requires VERIFIED account"));
        }

        // 🔄 CRITICAL: Set up AsyncLocalStorage context for WebSocket connection
        // This ensures all WebSocket operations are properly traced
        const wsContext = setRequestContext({
            correlationId,
            userId: decoded.userId,
            userLevel: user.userLevel,
            startTime: Date.now(),
            requestId: generateRequestId(),
        });

        // Attach both user and context to socket for use in event handlers
        (socket as any).user = {
            userId: decoded.userId,
            userLevel: user.userLevel,
            email: user.email,
        };

        (socket as any).context = wsContext;

        logger.info("WebSocket connection authenticated with context", {
            socketId: socket.id,
            userId: decoded.userId,
            userLevel: user.userLevel,
            correlationId,
            ip: socket.handshake.address,
        });

        next();
    } catch (error) {
        logger.error("WebSocket authentication error", {
            socketId: socket.id,
            error: error instanceof Error ? error.message : String(error),
            ip: socket.handshake.address,
        });
        next(new Error("Authentication failed"));
    }
});

// WebSocket connection handling with context propagation
io.on("connection", socket => {
    const user = (socket as any).user;
    const wsContext = (socket as any).context;

    logger.info("Authenticated client connected with context", {
        socketId: socket.id,
        userId: user.userId,
        userLevel: user.userLevel,
        correlationId: wsContext?.correlationId,
        ip: socket.handshake.address,
    });
    updateClientCount(1);

    // 🔄 ALL WebSocket event handlers run within the established context
    // This ensures correlation IDs and user context are maintained

    socket.on("subscribe", (room: string) => {
        runInContext(() => {
            socket.join(room);
            logger.info("Client subscribed to room", {
                socketId: socket.id,
                room,
                correlationId: wsContext?.correlationId
            });
        });
    });

    socket.on("unsubscribe", (room: string) => {
        runInContext(() => {
            socket.leave(room);
            logger.info("Client unsubscribed from room", {
                socketId: socket.id,
                room,
                correlationId: wsContext?.correlationId
            });
        });
    });

    // ✅ Handle market subscription with context propagation
    socket.on("subscribe_market", (symbol: string) => {
        runInContext(async () => {
            logger.info("Client subscribed to market", {
                socketId: socket.id,
                symbol,
                correlationId: wsContext?.correlationId
            });
            socket.join(`market:${symbol}`);

            try {
                // Send latest tick immediately if available
                const tick = await marketStreamService.getLatestTick(symbol);
                if (tick) {
                    socket.emit(`market:${symbol}`, tick);
                }
            } catch (err) {
                logger.error("Failed to send initial tick", {
                    socketId: socket.id,
                    symbol,
                    correlationId: wsContext?.correlationId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }

            // Connect to Orderly if not already connected
            marketStreamService.connectToOrderly([symbol]);
        });
    });

    socket.on("unsubscribe_market", (symbol: string) => {
        runInContext(() => {
            logger.info("Client unsubscribed from market", {
                socketId: socket.id,
                symbol,
                correlationId: wsContext?.correlationId
            });
            socket.leave(`market:${symbol}`);
        });
    });

    socket.on("disconnect", () => {
        runInContext(() => {
            logger.info("Client disconnected", {
                socketId: socket.id,
                correlationId: wsContext?.correlationId
            });
            updateClientCount(-1);
        });
    });
});

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
