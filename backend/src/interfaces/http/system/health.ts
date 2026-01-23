/** @format */

import { Router, Request, Response } from "express";
import { getPool, getPoolMetrics } from "../../../database/pool";
import { redisService } from "../../../infrastructure/cache/redis.service";
import { keyManagementService } from "../../../infrastructure/security/key-management.service";
import { getServiceStatus } from "../../../core/service-selector";
import logger from "../../../core/logging/logger.service";

const router = Router();

// Health check start time for uptime calculation
const START_TIME = Date.now();

// Basic health check endpoint
router.get("/health", (req: Request, res: Response) => {
  logger.http("Health check requested", {
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - START_TIME) / 1000), // seconds
    version: process.env.npm_package_version || "1.0.0",
    environment: process.env.NODE_ENV || "development",
  });
});

// Detailed health check with dependency checks
router.get("/health/detailed", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const checks = {
    database: false,
    redis: false,
    memory: false,
    responseTime: false,
  };

  const errors: string[] = [];

  try {
    // Database health check
    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      checks.database = true;
      logger.debug("Database health check passed");
    } catch (dbError) {
      errors.push(`Database: ${(dbError as Error).message}`);
      logger.warn("Database health check failed", {
        error: (dbError as Error).message,
      });
    }

    // Redis health check
    try {
      const client = redisService.getClient();
      await client.ping();
      checks.redis = true;
      logger.debug("Redis health check passed");
    } catch (redisError) {
      errors.push(`Redis: ${(redisError as Error).message}`);
      logger.warn("Redis health check failed", {
        error: (redisError as Error).message,
      });
    }

    // Memory health check
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    };

    // Consider unhealthy if heap usage > 80% or RSS > 500MB
    if (memUsage.heapUsed / memUsage.heapTotal > 0.8 || memUsageMB.rss > 500) {
      errors.push(
        `Memory: High usage - Heap: ${memUsageMB.heapUsed}MB/${memUsageMB.heapTotal}MB, RSS: ${memUsageMB.rss}MB`
      );
      logger.warn("Memory health check failed", { memUsageMB });
    } else {
      checks.memory = true;
      logger.debug("Memory health check passed", { memUsageMB });
    }

    // Response time check
    const responseTime = Date.now() - startTime;
    if (responseTime > 5000) {
      // 5 seconds timeout
      errors.push(`Response time: ${responseTime}ms (too slow)`);
      logger.warn("Response time health check failed", { responseTime });
    } else {
      checks.responseTime = true;
      logger.debug("Response time health check passed", { responseTime });
    }

    const overallHealth = Object.values(checks).every(check => check);
    const statusCode = overallHealth ? 200 : 503; // 503 Service Unavailable

    res.status(statusCode).json({
      status: overallHealth ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV || "development",
      checks,
      memory: memUsageMB,
      responseTime: `${responseTime}ms`,
      ...(errors.length > 0 && { errors }),
    });

    logger.http("Detailed health check completed", {
      overallHealth,
      responseTime,
      errorCount: errors.length,
      userAgent: req.get("User-Agent"),
      ip: req.ip,
    });
  } catch (error) {
    logger.error("Health check error", { error: (error as Error).message });
    res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: "Health check failed",
      message: (error as Error).message,
    });
  }
});

// Database-specific health check
router.get("/health/database", async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const pool = getPool();

    // Test basic connectivity
    await pool.query("SELECT 1 as test");

    // Test connection count
    const connectionResult = await pool.query(`
      SELECT
        count(*) as total_connections,
        count(*) filter (where state = 'active') as active_connections,
        count(*) filter (where state = 'idle') as idle_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    const responseTime = Date.now() - startTime;
    const connections = connectionResult.rows[0];

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      database: {
        name: process.env.DB_NAME || "unknown",
        host: process.env.DB_HOST || "unknown",
        connections: {
          total: parseInt(connections.total_connections),
          active: parseInt(connections.active_connections),
          idle: parseInt(connections.idle_connections),
        },
      },
    });

    logger.debug("Database health check passed", { responseTime, connections });
  } catch (error) {
    logger.error("Database health check failed", {
      error: (error as Error).message,
    });
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Database health check failed",
      message: (error as Error).message,
    });
  }
});

// Database pool metrics endpoint
router.get("/metrics/database", (req: Request, res: Response) => {
  try {
    const metrics = getPoolMetrics();

    res.json({
      timestamp: new Date().toISOString(),
      pool: metrics.pool,
      performance: metrics.performance,
      config: metrics.config,
      health: metrics.health,
    });

    logger.debug("Database metrics endpoint accessed");
  } catch (error) {
    logger.error("Database metrics error", { error: (error as Error).message });
    res.status(500).json({
      success: false,
      error: "Failed to fetch database metrics",
      message: (error as Error).message,
    });
  }
});

// Key management status endpoint
router.get("/health/encryption", async (req: Request, res: Response) => {
  try {
    const keyStatus = keyManagementService.getKeyStatus();
    const encryptionValid = await keyManagementService.validateEncryption();

    res.json({
      status: encryptionValid ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      encryption: {
        keyStatus,
        validation: {
          roundtripTest: encryptionValid,
        },
      },
    });

    logger.debug("Encryption health check passed");
  } catch (error) {
    logger.error("Encryption health check failed", {
      error: (error as Error).message,
    });
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Encryption health check failed",
      message: (error as Error).message,
    });
  }
});

// Redis-specific health check
router.get("/health/redis", async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    // Test basic connectivity
    const client = redisService.getClient();
    const pingResult = await client.ping();

    // Get Redis info
    const info = await client.info();

    const responseTime = Date.now() - startTime;

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      redis: {
        ping: pingResult,
        connected_clients: client.isOpen ? "connected" : "disconnected",
      },
    });

    logger.debug("Redis health check passed", { responseTime });
  } catch (error) {
    logger.error("Redis health check failed", {
      error: (error as Error).message,
    });
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Redis health check failed",
      message: (error as Error).message,
    });
  }
});

// External API health check (Kodiak)
router.get("/health/external", async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    // Test Kodiak public API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const kodiakResponse = await fetch(
      "https://api.orderly.org/v1/public/ticker?symbol=PERP_BTC_USDC",
      {
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!kodiakResponse.ok) {
      throw new Error(`Kodiak API returned ${kodiakResponse.status}`);
    }

    const data = (await kodiakResponse.json()) as any;

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      external: {
        kodiak: {
          status: "healthy",
          responseTime: `${responseTime}ms`,
          symbol: data?.data?.symbol || "unknown",
        },
      },
    });

    logger.debug("External API health check passed", { responseTime });
  } catch (error) {
    logger.warn("External API health check failed", {
      error: (error as Error).message,
    });
    res.status(503).json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      warning: "External API health check failed",
      message: (error as Error).message,
      external: {
        kodiak: {
          status: "unhealthy",
          error: (error as Error).message,
        },
      },
    });
  }
});

// Application metrics endpoint
router.get("/metrics", (req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);

  res.json({
    timestamp: new Date().toISOString(),
    uptime_seconds: uptime,
    memory: {
      rss_bytes: memUsage.rss,
      heap_total_bytes: memUsage.heapTotal,
      heap_used_bytes: memUsage.heapUsed,
      external_bytes: memUsage.external,
      rss_mb: Math.round(memUsage.rss / 1024 / 1024),
      heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      external_mb: Math.round(memUsage.external / 1024 / 1024),
    },
    process: {
      pid: process.pid,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    environment: {
      node_env: process.env.NODE_ENV || "development",
      version: process.env.npm_package_version || "1.0.0",
    },
  });

  logger.debug("Metrics endpoint accessed");
});

// Readiness probe (Kubernetes style)
router.get("/ready", async (req: Request, res: Response) => {
  try {
    // Check critical dependencies
    const pool = getPool();
    await pool.query("SELECT 1");

    const redisClient = redisService.getClient();
    await redisClient.ping();

    res.status(200).json({
      status: "ready",
      timestamp: new Date().toISOString(),
    });

    logger.debug("Readiness probe passed");
  } catch (error) {
    logger.error("Readiness probe failed", { error: (error as Error).message });
    res.status(503).json({
      status: "not ready",
      timestamp: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
});

// Liveness probe (Kubernetes style)
router.get("/live", (req: Request, res: Response) => {
  // Simple liveness check - if the server is responding, it's alive
  res.status(200).json({
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
  });

  logger.debug("Liveness probe passed");
});

// Service implementation status endpoint (Phase 5: Gradual Replacement)
router.get("/health/services", (req: Request, res: Response) => {
  try {
    const serviceStatus = getServiceStatus();

    // Determine overall service health
    const allServicesHealthy = Object.values(serviceStatus).every(service =>
      service.implementation !== 'legacy' || service.enabled
    );

    res.json({
      status: allServicesHealthy ? "healthy" : "transitioning",
      timestamp: new Date().toISOString(),
      services: serviceStatus,
      summary: {
        pureServicesEnabled: Object.values(serviceStatus).filter(s => s.enabled).length,
        totalServices: Object.keys(serviceStatus).length,
        migrationProgress: `${Object.values(serviceStatus).filter(s => s.enabled).length}/${Object.keys(serviceStatus).length} services migrated`,
      },
      environment: {
        LEGACY_BALANCE_API: process.env.LEGACY_BALANCE_API === 'true',
        LEGACY_AUTH_API: process.env.LEGACY_AUTH_API === 'true',
        LEGACY_POSITION_API: process.env.LEGACY_POSITION_API === 'true',
      }
    });

    logger.debug("Service status endpoint accessed", { serviceStatus });
  } catch (error) {
    logger.error("Service status endpoint error", { error: (error as Error).message });
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: "Failed to get service status",
      message: (error as Error).message,
    });
  }
});

// Rate limit stats endpoint (Phase 4.4)
router.get("/ratelimit", async (req: Request, res: Response) => {
  try {
    const client = redisService.getClient();

    // Get all rate limit keys
    const keys = await client.keys("ratelimit:*");

    const stats = {
      activeIps: keys.length,
      ratelimitConfigs: {
        auth: "5 requests per 15 minutes",
        trading: "10 requests per minute",
        market: "30 requests per minute",
        balance: "20 requests per minute",
        public: "60 requests per minute",
        websocket: "100 subscriptions per minute",
      },
    };

    res.json({
      success: true,
      data: stats,
    });

    logger.debug("Rate limit stats endpoint accessed");
  } catch (error) {
    logger.error("Rate limit stats error", { error: (error as Error).message });
    res.status(500).json({
      success: false,
      error: "Failed to fetch rate limit stats",
    });
  }
});

export { router as healthRoutes };
