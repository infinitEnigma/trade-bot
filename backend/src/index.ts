/** @format */

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";

// Import routes
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { marketRoutes } from "./routes/market";
import { strategyRoutes } from "./routes/strategies";
import { botRoutes } from "./routes/bot";

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

// Track HTTP API activity
const trackApiActivity = () => {
  // If we have API activity but no WebSocket connections, consider it as having clients
  if (activeClients === 0) {
    const timeSinceLastActivity = Date.now() - lastActivityTime;
    // If there was recent API activity (within last 30 seconds), consider clients active
    if (timeSinceLastActivity < 30000) {
      console.log(`🔄 API activity detected, treating as active client`);
      updateClientCount(1);
      // Reset after 30 seconds of no activity
      setTimeout(() => {
        if (activeClients > 0) {
          updateClientCount(-1);
        }
      }, 30000);
    }
  }
  lastActivityTime = Date.now();
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

      // For development, allow localhost variations
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

      // For development, allow localhost variations
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
      }

      return callback(new Error('CORS policy violation'));
    },
    credentials: true,
  })
);
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/", limiter);

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

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: Date.now() });
});

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
});

export { app, io };
