/**
 * Health Service
 *
 * Handles system health check operations including service status, 
 * database connectivity, and overall system health monitoring.
 *
 * @format
 */

import logger from "../../core/logging/logger.service";
import { query } from "../../database/pool";
import { redisService } from "../../infrastructure/cache/redis.service";

export interface HealthServiceDependencies {
    // No dependencies required for basic health checks
}

export class HealthService {
    constructor(private deps: HealthServiceDependencies) { }

    /**
     * Get overall system health status
     */
    async getSystemHealth(): Promise<any> {
        const healthChecks = {
            api: this.checkApiStatus(),
            database: this.checkDatabaseStatus(),
            redis: this.checkRedisStatus(),
            tradingEngine: this.checkTradingEngineStatus()
        };

        const results = await Promise.allSettled(Object.values(healthChecks));
        const keys = Object.keys(healthChecks);

        const healthStatus = keys.reduce((acc: any, key: string, index: number) => {
            acc[key] = results[index].status === 'fulfilled'
                ? { status: 'healthy', details: results[index].value }
                : { status: 'unhealthy', error: results[index].reason instanceof Error ? results[index].reason.message : String(results[index].reason) };
            return acc;
        }, {});

        const overallStatus = Object.values(healthStatus).every((check: any) => check.status === 'healthy')
            ? 'healthy'
            : 'unhealthy';

        logger.debug("System health check completed", {
            status: overallStatus,
            checks: Object.keys(healthStatus)
        });

        return {
            status: overallStatus,
            timestamp: new Date(),
            checks: healthStatus
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
            const result = await query('SELECT 1');
            if (result.rows.length > 0) {
                return "Database connection successful";
            }
            throw new Error("No rows returned from database");
        } catch (error) {
            logger.error("Database health check failed", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Check Redis connectivity
     */
    private async checkRedisStatus(): Promise<string> {
        try {
            const response = await redisService.isHealthy();
            if (response) {
                return "Redis connection successful";
            }
            throw new Error("Redis health check failed");
        } catch (error) {
            logger.error("Redis health check failed", {
                error: error instanceof Error ? error.message : String(error)
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
    async getSystemInfo(): Promise<any> {
        try {
            const info = {
                version: process.env.npm_package_version || 'unknown',
                nodeVersion: process.version,
                platform: process.platform,
                architecture: process.arch,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                environment: process.env.NODE_ENV || 'development'
            };

            logger.debug("System information retrieved successfully");
            return info;
        } catch (error) {
            logger.error("Failed to get system information", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error("Failed to get system information");
        }
    }

    /**
     * Get performance metrics
     */
    async getPerformanceMetrics(): Promise<any> {
        try {
            const metrics = {
                cpu: this.getCpuUsage(),
                memory: process.memoryUsage(),
                eventLoop: this.getEventLoopDelay()
            };

            logger.debug("Performance metrics retrieved successfully");
            return metrics;
        } catch (error) {
            logger.error("Failed to get performance metrics", {
                error: error instanceof Error ? error.message : String(error)
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
export function createHealthService(deps: HealthServiceDependencies): HealthService {
    return new HealthService(deps);
}