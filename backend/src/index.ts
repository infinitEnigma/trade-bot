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
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nCreate .env file or set environment variables.');
    console.error('See .env.example for template.');
    process.exit(1);
  }

  // Validate secret strength in production
  if (process.env.NODE_ENV === 'production') {
    const secrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_MASTER_KEY'];
    secrets.forEach(key => {
      const value = process.env[key]!;
      if (value.length < 32) {
        console.error(
          `❌ ${key} must be at least 32 characters in production.\n` +
          `Current length: ${value.length}`
        );
        process.exit(1);
      }
    });
  }

  console.log('✅ Environment validation passed');
}

validateEnvironment();

// Import routes
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { marketRoutes } from "./routes/market";
import { strategyRoutes } from "./routes/strategies";
import { botRoutes } from "./routes/bot";
import { healthRoutes } from "./routes/health";
import { httpLogger, errorLogger } from "./middleware/logger";

// ✅ Initialize database pool first (before routes)
import { initializePool, closePool } from "./database/pool";

// Initialize database connection pool
try {
  initializePool();
} catch (error) {
  console.error("❌ Failed to initialize database pool:", error);
  process.exit(1);
}

// Initialize Redis connection
import { redisService } from "./services/redis";

// Connect to Redis on startup
redisService.connect().catch((error) => {
  console.error("❌ Failed to connect to Redis:", error);
});


// Client connection tracking
let activeClients = 0;
let lastActivityTime = Date.now();

const updateClientCount = (change: number) => {
  activeClients = Math.max(0, activeClients + change);
  lastActivityTime = Date.now();
  console.log(`👥 Active clients: ${activeClients} (last activity: ${new Date(lastActivityTime).toLocaleTimeString()})`);

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
    console.error("Error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: Date.now(),
    });
  }
);

// WebSocket connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  updateClientCount(1);

  socket.on("subscribe", (room: string) => {
    socket.join(room);
    console.log(`Client ${socket.id} subscribed to ${room}`);
  });

  socket.on("unsubscribe", (room: string) => {
    socket.leave(room);
    console.log(`Client ${socket.id} unsubscribed from ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    updateClientCount(-1);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);

  // TODO: Initialize market stream service after resolving import issue
  console.log('📊 Market streams: Temporarily disabled for debugging');

  /*
  // ✅ Initialize market stream service after server starts
  import("./services/market-stream.js").then(({ marketStreamService }) => {
    marketStreamService.setSocketServer(io);

    // Connect to market streams for default symbols
    const DEFAULT_SYMBOLS = ['PERP_BTC_USDC', 'PERP_ETH_USDC'];
    marketStreamService.connectToOrderly(DEFAULT_SYMBOLS);

    // Connect to kline WebSocket streams (public)
    marketStreamService.connectToKline('PERP_BTC_USDC', '1h');
    marketStreamService.connectToKline('PERP_ETH_USDC', '1h');
  });
  */
});

// ✅ Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM signal received: closing HTTP server');
  httpServer.close(async () => {
    console.log('✅ HTTP server closed');
    await closePool();  // ✅ Close database pool
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('📛 SIGINT signal received: closing HTTP server');
  httpServer.close(async () => {
    console.log('✅ HTTP server closed');
    await closePool();  // ✅ Close database pool
    process.exit(0);
  });
});

export { app, io };
