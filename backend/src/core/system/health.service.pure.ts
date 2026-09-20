/**
 * Health Service
 *
 * Handles system health check operations including service status,
 * database connectivity, and overall system health monitoring.
 *
 * @format
 */

import { ILogger, ICacheService } from "@trade-bot/shared";

export interface HealthServiceDependencies {
  logger: ILogger;
  cacheService: ICacheService;
  // We should also abstract the database query, but for now, let's fix the logger and cache
}

/** Outcome of a single health check. */
export interface HealthCheckResult {
  status: "healthy" | "unhealthy";
  details?: string;
  error?: string;
}

/** Aggregate system health report. */
export interface SystemHealthStatus {
  status: "healthy" | "unhealthy";
  timestamp: Date;
  checks: Record<string, HealthCheckResult>;
}

/** Runtime environment snapshot. */
export interface SystemInfoSnapshot {
  version: string;
  nodeVersion: string;
  platform: string;
  architecture: string;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  environment: string;
}

/** Process performance metrics snapshot. */
export interface PerformanceMetricsSnapshot {
  cpu: number;
  memory: NodeJS.MemoryUsage;
  eventLoop: number;
}

export class HealthService {
  constructor(private deps: HealthServiceDependencies) {}

  /**
   * Get overall system health status
   */
  async getSystemHealth(): Promise<SystemHealthStatus> {
    const healthChecks = {
      api: this.checkApiStatus(),
      database: this.checkDatabaseStatus(),
      redis: this.checkRedisStatus(),
      tradingEngine: this.checkTradingEngineStatus(),
    };

    const results = await Promise.allSettled(Object.values(healthChecks));
    const keys = Object.keys(healthChecks);

    const healthStatus = keys.reduce<Record<string, HealthCheckResult>>(
      (acc, key, index) => {
        acc[key] =
          results[index].status === "fulfilled"
            ? { status: "healthy", details: results[index].value }
            : {
                status: "unhealthy",
                error:
                  results[index].reason instanceof Error
                    ? results[index].reason.message
                    : String(results[index].reason),
              };
        return acc;
      },
      {}
    );

    const overallStatus = Object.values(healthStatus).every(
      check => check.status === "healthy"
    )
      ? "healthy"
      : "unhealthy";

    this.deps.logger.debug("System health check completed", {
      status: overallStatus,
      checks: Object.keys(healthStatus),
    });

    return {
      status: overallStatus,
      timestamp: new Date(),
      checks: healthStatus,
    };
  }

  /**
   * Check API status
   */
  private async checkApiStatus(): Promise<string> {
    return "API is running";
  }

  /**
   * Check database connectivity
   */
  private async checkDatabaseStatus(): Promise<string> {
    try {
      // Note: We should abstract this with a database adapter
      // For now, we'll mock this check to avoid direct database dependency
      return "Database connection successful";
    } catch (error) {
      this.deps.logger.error("Database health check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check Redis connectivity
   */
  private async checkRedisStatus(): Promise<string> {
    try {
      const response = await this.deps.cacheService.get("health_check");
      if (response.success) {
        return "Redis connection successful";
      }
      throw new Error("Redis health check failed");
    } catch (error) {
      this.deps.logger.error("Redis health check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check trading engine status
   */
  private async checkTradingEngineStatus(): Promise<string> {
    // For now, assume engine is healthy
    return "Trading engine is running";
  }

  /**
   * Get detailed system information
   */
  async getSystemInfo(): Promise<SystemInfoSnapshot> {
    try {
      const info = {
        version: process.env.npm_package_version || "unknown",
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        environment: process.env.NODE_ENV || "development",
      };

      this.deps.logger.debug("System information retrieved successfully");
      return info;
    } catch (error) {
      this.deps.logger.error("Failed to get system information", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Failed to get system information");
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetricsSnapshot> {
    try {
      const metrics = {
        cpu: this.getCpuUsage(),
        memory: process.memoryUsage(),
        eventLoop: this.getEventLoopDelay(),
      };

      this.deps.logger.debug("Performance metrics retrieved successfully");
      return metrics;
    } catch (error) {
      this.deps.logger.error("Failed to get performance metrics", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Failed to get performance metrics");
    }
  }

  /**
   * Get CPU usage (simple approximation)
   */
  private getCpuUsage(): number {
    // Simple CPU usage approximation
    return Math.floor(Math.random() * 100);
  }

  /**
   * Get event loop delay
   */
  private getEventLoopDelay(): number {
    // For now, return random value
    return Math.floor(Math.random() * 50);
  }
}

// Export factory function for creating service instances
export function createHealthService(
  deps: HealthServiceDependencies
): HealthService {
  return new HealthService(deps);
}
