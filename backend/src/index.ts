/** @format */

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";

// Add at the very top of index.ts, before any other code
const REQUIRED_ENV_VARS = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_MASTER_KEY',
  'NODE_ENV'
];

function validateEnvironment(): void {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);

  if (missing.length > 0) {
    logger.error('Missing required environment variables');
    missing.forEach(key => logger.error(`   - ${key}`));
    logger.error('Create .env file or set environment variables.');
    logger.error('See .env.example for template.');
    process.exit(1);
  }

  // Validate secret strength in production
  if (process.env.NODE_ENV === 'production') {
    const secrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_MASTER_KEY'];
    secrets.forEach(key => {
      const value = process.env[key]!;
      if (value.length < 32) {
        logger.error(
          `${key} must be at least 32 characters in production. Current length: ${value.length}`
        );
        process.exit(1);
      }
    });
  }

  logger.info('Environment validation passed');
}

validateEnvironment();

// Import routes
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { marketRoutes } from "./routes/market";
import { strategyRoutes } from "./routes/strategies";
import { botRoutes } from "./routes/bot";
import { balanceRoutes } from "./routes/balance";
import { healthRoutes } from "./routes/health";
import { httpLogger, errorLogger } from "./middleware/logger";
import logger from "./services/logger";

// ✅ Import market stream service (fixed import issue)
import { marketStreamService } from "./services/market-stream";

// ✅ Initialize database pool first (before routes)
import { initializePool, closePool } from "./database/pool";

// Initialize database connection pool
try {
  initializePool();
} catch (error) {
  logger.error("Failed to initialize database pool", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}

// Initialize Redis connection
import { redisService } from "./services/redis";

// Connect to Redis on startup
redisService.connect().catch((error) => {
  logger.error("Failed to connect to Redis", { error: error instanceof Error ? error.message : String(error) });
});


// Client connection tracking
let activeClients = 0;
let lastActivityTime = Date.now();

const updateClientCount = (change: number) => {
  activeClients = Math.max(0, activeClients + change);
  lastActivityTime = Date.now();
  logger.info(`Active clients: ${activeClients}`, { lastActivity: new Date(lastActivityTime).toLocaleTimeString() });

  // Store client count in Redis for monitoring
  redisService.setex("active_clients", 60, activeClients.toString()).catch(() => {
    // Ignore Redis errors for client tracking
  });
};

// Track HTTP API activity (simplified - just update timestamp)
const trackApiActivity = () => {
  lastActivityTime = Date.now();
  // Removed artificial client count manipulation that was causing issues
};

const app = express();
const httpServer = createServer(app);
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
      if (process.env.NODE_ENV === 'development') {
        const devOrigins = [
          'http://localhost:3000',
          'http://localhost:5173',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:5173',
        ];
        if (devOrigins.includes(origin)) {
          return callback(null, true);
        }

        // Allow local network access (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        const networkRegex = /^(https?:\/\/)(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)[\d]+\.[\d]+(:[\d]+)?$/;
        if (networkRegex.test(origin)) {
          return callback(null, true);
        }
      }

      return callback(new Error('CORS policy violation'));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Middleware
app.use(helmet());

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  'http://localhost:3000',
  'http://localhost:5173',
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
      if (process.env.NODE_ENV === 'development') {
        const devOrigins = [
          'http://localhost:3000',
          'http://localhost:5173',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:5173',
        ];
        if (devOrigins.includes(origin)) {
          return callback(null, true);
        }

        // Allow local network access (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        const networkRegex = /^(https?:\/\/)(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)[\d]+\.[\d]+(:[\d]+)?$/;
        if (networkRegex.test(origin)) {
          return callback(null, true);
        }
      }

      return callback(new Error('CORS policy violation'));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/", limiter);

// HTTP request logging middleware
app.use(httpLogger);

// Make io available to routes
app.set("io", io);

// API activity tracking middleware
app.use("/api", (req, res, next) => {
  trackApiActivity();
  next();
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/strategies", strategyRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/balance", balanceRoutes);

// Health check routes
app.use("/", healthRoutes);

// Error handling middleware
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

// WebSocket connection handling
io.on("connection", (socket) => {
  logger.info("Client connected", { socketId: socket.id });
  updateClientCount(1);

  socket.on("subscribe", (room: string) => {
    socket.join(room);
    logger.info("Client subscribed to room", { socketId: socket.id, room });
  });

  socket.on("unsubscribe", (room: string) => {
    socket.leave(room);
    logger.info("Client unsubscribed from room", { socketId: socket.id, room });
  });

  // ✅ Handle market subscription (Task 4.3)
  socket.on("subscribe_market", (symbol: string) => {
    logger.info("Client subscribed to market", { socketId: socket.id, symbol });
    socket.join(`market:${symbol}`);

    // Send latest tick immediately if available
    marketStreamService.getLatestTick(symbol).then((tick) => {
      if (tick) {
        socket.emit(`market:${symbol}`, tick);
      }
    }).catch((err) => {
      logger.error("Failed to send initial tick", { symbol, error: err instanceof Error ? err.message : String(err) });
    });

    // Connect to Orderly if not already connected
    marketStreamService.connectToOrderly([symbol]);
  });

  socket.on("unsubscribe_market", (symbol: string) => {
    logger.info("Client unsubscribed from market", { socketId: socket.id, symbol });
    socket.leave(`market:${symbol}`);
  });

  socket.on("disconnect", () => {
    logger.info("Client disconnected", { socketId: socket.id });
    updateClientCount(-1);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info('WebSocket server ready');
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);

  // ✅ Initialize market stream service (lazy-loaded - connects on-demand)
  marketStreamService.setSocketServer(io);
  logger.info('Market stream service initialized (lazy-loaded - connects when needed)');
});

// ✅ Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    await closePool();  // ✅ Close database pool
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    await closePool();  // ✅ Close database pool
    process.exit(0);
  });
});

export { app, io };
