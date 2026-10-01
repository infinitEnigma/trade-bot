/**
 * Health Service
 *
 * Handles system health check operations including service status,
 * database connectivity, and overall system health monitoring.
 *
 * @format
 */

import { monitorEventLoopDelay } from "perf_hooks";
import { ILogger, ICacheService } from "@trade-bot/shared";

export interface HealthServiceDependencies {
  logger: ILogger;
  cacheService: ICacheService;
  /** Real DB probe (SELECT 1 through the pool); must reject when unreachable. */
  pingDatabase: () => Promise<unknown>;
  /**
   * Real engine probe — the engine registry's heartbeat liveness
   * (ONLINE + fresh `last_seen_at`); `running: false` means no live engine.
   * Not the engine manager's HTTP probe: the Redis-only engine process
   * never opens that port.
   */
  probeEngine: () => Promise<{ running: boolean }>;
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

/**
 * Event-loop delay histogram for this process — enabled once at import so
 * every HealthService instance (the container builds a fresh one per
 * getter access) samples the same lifetime window.
 */
const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
eventLoopDelay.enable();

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
   * Check API status — self-liveness: reaching this check means the API
   * process is up and serving requests, so the constant answer is the truth.
   */
  private async checkApiStatus(): Promise<string> {
    return "API is running";
  }

  /**
   * Check database connectivity — real probe through the injected pool ping;
   * a failed connection rejects and the aggregate marks the check unhealthy.
   */
  private async checkDatabaseStatus(): Promise<string> {
    try {
      await this.deps.pingDatabase();
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
   * Check trading engine status — real probe through the engine manager's
   * HTTP health endpoint (2s timeout, `running: false` when unreachable);
   * previously this returned a hardcoded "assume engine is healthy".
   */
  private async checkTradingEngineStatus(): Promise<string> {
    try {
      const status = await this.deps.probeEngine();
      if (!status.running) {
        throw new Error("Trading engine is not running");
      }
      return "Trading engine is running";
    } catch (error) {
      this.deps.logger.error("Trading engine health check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
   * Get CPU usage — real measurement: cumulative CPU burned since process
   * start as a percentage of one core's wall time (process.cpuUsage() is in
   * µs, so µs / (uptime seconds × 10 000) = percent), clamped to the
   * metric's 0–100 contract (a multi-core burst can exceed 100 early on).
   */
  private getCpuUsage(): number {
    const usage = process.cpuUsage();
    const uptimeSeconds = process.uptime();
    if (uptimeSeconds <= 0) {
      return 0;
    }
    const percent = (usage.user + usage.system) / (uptimeSeconds * 10_000);
    return Math.min(100, Math.max(0, Math.round(percent)));
  }

  /**
   * Get event loop delay — real measurement: the mean of the process-lifetime
   * `monitorEventLoopDelay` histogram (ns → ms, 2 decimals); 0 until the
   * first sample lands. Previously a `Math.random()` value.
   */
  private getEventLoopDelay(): number {
    const meanNs = eventLoopDelay.mean;
    if (!Number.isFinite(meanNs) || meanNs <= 0) {
      return 0;
    }
    return Math.round((meanNs / 1e6) * 100) / 100;
  }
}

// Export factory function for creating service instances
export function createHealthService(
  deps: HealthServiceDependencies
): HealthService {
  return new HealthService(deps);
}
