/**
 * ===========================================
 * 🔍 REDIS HEALTH MONITOR - Availability Tracking
 * ===========================================
 *
 * Monitors Redis connectivity and provides health status for fallback decisions.
 * Prevents excessive health checks while maintaining responsiveness to failures.
 *
 * @format
 */

import { redisService } from "../../../infrastructure";
import { logger } from "../../../core/logging";

/**
 * Redis health monitoring service.
 * Tracks Redis availability and provides health status for rate limiting decisions.
 * Implements caching to avoid excessive health checks.
 */
class RedisHealthMonitor {
    /** Health check interval in milliseconds */
    private readonly CHECK_INTERVAL_MS = 30000; // 30 seconds

    /** Current Redis health status */
    private healthy = true;

    /** Timestamp of last health check */
    private lastCheck = 0;

    /**
     * Check Redis health with caching to prevent excessive checks
     *
     * @returns Promise resolving to true if Redis is healthy, false otherwise
     */
    async checkHealth(): Promise<boolean> {
        const now = Date.now();

        // Return cached result if check interval hasn't elapsed
        if (now - this.lastCheck < this.CHECK_INTERVAL_MS) {
            return this.healthy;
        }

        this.lastCheck = now;

        try {
            const isHealthy = await redisService.isHealthy();

            // Log status changes
            if (this.healthy !== isHealthy) {
                logger.info("Redis health status changed", {
                    wasHealthy: this.healthy,
                    nowHealthy: isHealthy,
                    timestamp: new Date().toISOString(),
                });
                this.healthy = isHealthy;
            }

            return isHealthy;
        } catch (error) {
            // On error, mark as unhealthy if previously healthy
            if (this.healthy) {
                logger.warn("Redis health check failed, switching to in-memory fallback", {
                    error: error instanceof Error ? error.message : String(error),
                    timestamp: new Date().toISOString(),
                });
                this.healthy = false;
            }
            return false;
        }
    }

    /**
     * Get current health status without performing a new check
     *
     * @returns Current cached health status
     */
    getCurrentHealth(): boolean {
        return this.healthy;
    }

    /**
     * Get timestamp of last health check
     *
     * @returns Unix timestamp of last check
     */
    getLastCheckTime(): number {
        return this.lastCheck;
    }

    /**
     * Force a health check and update status
     * Useful for manual health verification or testing
     *
     * @returns Promise resolving to current health status
     */
    async forceHealthCheck(): Promise<boolean> {
        // Reset last check time to force a new check
        this.lastCheck = 0;
        return this.checkHealth();
    }

    /**
     * Manually set health status
     * Useful for testing or administrative overrides
     *
     * @param healthy - New health status
     */
    setHealthStatus(healthy: boolean): void {
        if (this.healthy !== healthy) {
            logger.info("Redis health status manually set", {
                previousStatus: this.healthy,
                newStatus: healthy,
                timestamp: new Date().toISOString(),
            });
            this.healthy = healthy;
        }
    }

    /**
     * Get health statistics for monitoring
     *
     * @returns Object containing health metrics
     */
    getHealthStats(): {
        healthy: boolean;
        lastCheck: number;
        secondsSinceLastCheck: number;
        checkIntervalSeconds: number;
    } {
        const now = Date.now();
        return {
            healthy: this.healthy,
            lastCheck: this.lastCheck,
            secondsSinceLastCheck: Math.round((now - this.lastCheck) / 1000),
            checkIntervalSeconds: Math.round(this.CHECK_INTERVAL_MS / 1000),
        };
    }
}

// Global Redis health monitor instance
const redisHealthMonitor = new RedisHealthMonitor();

/**
 * Legacy function for backward compatibility
 * @deprecated Use redisHealthMonitor.checkHealth() instead

async function checkRedisHealth(): Promise<boolean> {
    return redisHealthMonitor.checkHealth();
}

export { RedisHealthMonitor, redisHealthMonitor, checkRedisHealth };
 */