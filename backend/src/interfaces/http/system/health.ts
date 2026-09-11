/** @format */

import { Router, Request, Response } from "express";
import { getHealthService } from "../../../core/service-provider";
import { getPool, getPoolMetrics } from "../../../database/pool";
import { redisService } from "../../../infrastructure/cache/redis.service";
import { keyManagementService } from "../../../infrastructure/security/key-management.service";
import { getServiceStatus } from "../../../core/service-selector";
import { httpLogger, logger as contextLogger } from "../../../core/logging";

const router = Router();

// Health check start time for uptime calculation
const START_TIME = Date.now();

// Basic health check endpoint
router.get("/health", (req: Request, res: Response) => {
  httpLogger.http("Health check requested", {
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
  try {
    const health = await getHealthService().getSystemHealth();

    const statusCode = health.status === "healthy" ? 200 : 503; // 503 Service Unavailable

    res.status(statusCode).json({
      status: health.status,
      timestamp: health.timestamp.toISOString(),
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV || "development",
      checks: health.checks,
    });

    httpLogger.http("Detailed health check completed", {
      overallHealth: health.status,
      checks: Object.keys(health.checks),
      userAgent: req.get("User-Agent"),
      ip: req.ip,
    });
  } catch (error) {
    contextLogger.error("Health check error", { error: (error as Error).message });
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

    contextLogger.debug("Database health check passed", { responseTime, connections });
  } catch (error) {
    contextLogger.error("Database health check failed", {
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

    contextLogger.debug("Database metrics endpoint accessed");
  } catch (error) {
    contextLogger.error("Database metrics error", { error: (error as Error).message });
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

    contextLogger.debug("Encryption health check passed");
  } catch (error) {
    contextLogger.error("Encryption health check failed", {
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
    const _info = await client.info();

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

    contextLogger.debug("Redis health check passed", { responseTime });
  } catch (error) {
    contextLogger.error("Redis health check failed", {
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

    const data = await kodiakResponse.json();

    // Safely extract symbol from Kodiak API response
    const symbol = (data as { data?: { symbol?: string } })?.data?.symbol || "unknown";

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      external: {
        kodiak: {
          status: "healthy",
          responseTime: `${responseTime}ms`,
          symbol,
        },
      },
    });

    contextLogger.debug("External API health check passed", { responseTime });
  } catch (error) {
    contextLogger.warn("External API health check failed", {
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
router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const metrics = await getHealthService().getPerformanceMetrics();
    const info = await getHealthService().getSystemInfo();

    const uptime = Math.floor((Date.now() - START_TIME) / 1000);

    res.json({
      timestamp: new Date().toISOString(),
      uptime_seconds: uptime,
      ...metrics,
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

    contextLogger.debug("Metrics endpoint accessed");
  } catch (error) {
    contextLogger.error("Metrics endpoint error", { error: (error as Error).message });
    res.status(500).json({
      success: false,
      error: "Failed to fetch metrics",
      message: (error as Error).message,
    });
  }
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

    contextLogger.debug("Readiness probe passed");
  } catch (error) {
    contextLogger.error("Readiness probe failed", { error: (error as Error).message });
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

  contextLogger.debug("Liveness probe passed");
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

    contextLogger.debug("Service status endpoint accessed", { serviceStatus });
  } catch (error) {
    contextLogger.error("Service status endpoint error", { error: (error as Error).message });
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

    contextLogger.debug("Rate limit stats endpoint accessed");
  } catch (error) {
    contextLogger.error("Rate limit stats error", { error: (error as Error).message });
    res.status(500).json({
      success: false,
      error: "Failed to fetch rate limit stats",
    });
  }
});

export { router as healthRoutes };
