/**
 * ===========================================
 * 🩺 HEALTH MONITOR - MULTI-LAYER HEALTH CHECKS
 * ===========================================
 *
 * Performs comprehensive health assessment of the trading engine
 * across multiple layers to ensure operational integrity.
 *
 * HEALTH CHECK LAYERS:
 * 1. Process Liveness: OS process existence
 * 2. HTTP Connectivity: REST API responsiveness
 * 3. WebSocket Health: Real-time connection status
 * 4. Bot Operational: Active trading status
 * 5. System Resources: Memory and performance metrics
 *
 * HEALTH ASSESSMENT:
 * - Overall health determination from all layers
 * - Individual layer status reporting
 * - Health trend analysis and alerting
 *
 * @format
 */

import axios from "axios";
import { performanceLogger as logger } from "../../logging/context-aware-logger.service";
import { ProcessSpawner } from "./process-spawner";

export interface EngineHealth {
    // Core health indicators
    processAlive: boolean;
    httpResponsive: boolean;
    websocketConnected: boolean;
    botsResponding: boolean;

    // Operational metrics
    lastTradeActivity: Date;
    memoryUsage: number;
    errorRate: number;

    // Assessment
    overallHealthy: boolean;
    healthScore: number; // 0-100
    issues: string[];

    // Metadata
    timestamp: Date;
    checkDuration: number;
}

export interface HealthCheckConfig {
    enabledLayers: {
        processLiveness: boolean;
        httpConnectivity: boolean;
        websocketHealth: boolean;
        botOperational: boolean;
        systemResources: boolean;
    };
    timeouts: {
        httpTimeout: number;
        websocketTimeout: number;
        botCheckTimeout: number;
    };
    thresholds: {
        maxMemoryUsage: number;
        maxErrorRate: number;
        staleTradeThreshold: number; // minutes
    };
}

export class HealthMonitor {
    private config: HealthCheckConfig;
    private processSpawner: ProcessSpawner;
    private port: number;

    private lastHealthCheck: EngineHealth | null = null;
    private healthHistory: EngineHealth[] = [];

    constructor(processSpawner: ProcessSpawner, port = 4000, config?: Partial<HealthCheckConfig>) {
        this.processSpawner = processSpawner;
        this.port = port;

        this.config = {
            enabledLayers: {
                processLiveness: true,
                httpConnectivity: true,
                websocketHealth: false, // TODO: Implement WebSocket checks
                botOperational: false,  // TODO: Implement bot checks
                systemResources: false, // TODO: Implement resource monitoring
                ...config?.enabledLayers,
            },
            timeouts: {
                httpTimeout: 3000,
                websocketTimeout: 3000,
                botCheckTimeout: 5000,
                ...config?.timeouts,
            },
            thresholds: {
                maxMemoryUsage: 500 * 1024 * 1024, // 500MB
                maxErrorRate: 0.1, // 10%
                staleTradeThreshold: 30, // 30 minutes
                ...config?.thresholds,
            },
        };
    }

    /**
     * Perform comprehensive multi-layer health check
     */
    async performMultiLayerHealthCheck(): Promise<EngineHealth> {
        const startTime = Date.now();
        const health: EngineHealth = {
            processAlive: false,
            httpResponsive: false,
            websocketConnected: false,
            botsResponding: false,
            lastTradeActivity: new Date(0),
            memoryUsage: 0,
            errorRate: 0,
            overallHealthy: false,
            healthScore: 0,
            issues: [],
            timestamp: new Date(),
            checkDuration: 0,
        };

        try {
            // Layer 1: Process Liveness Check
            if (this.config.enabledLayers.processLiveness) {
                health.processAlive = this.checkProcessLiveness();
                if (!health.processAlive) {
                    health.issues.push("Process is not alive");
                }
            }

            // Layer 2: HTTP Connectivity Check
            if (this.config.enabledLayers.httpConnectivity) {
                health.httpResponsive = await this.checkHTTPHealth();
                if (!health.httpResponsive) {
                    health.issues.push("HTTP endpoint not responding");
                }
            }

            // Layer 3: WebSocket Health Check
            if (this.config.enabledLayers.websocketHealth) {
                health.websocketConnected = await this.checkWebSocketHealth();
                if (!health.websocketConnected) {
                    health.issues.push("WebSocket connections unhealthy");
                }
            }

            // Layer 4: Bot Operational Health Check
            if (this.config.enabledLayers.botOperational) {
                const botHealth = await this.checkBotOperationalHealth();
                health.botsResponding = botHealth.healthy;
                health.lastTradeActivity = botHealth.lastTradeActivity;
                if (!health.botsResponding) {
                    health.issues.push("Bot operations unhealthy");
                }
            }

            // Layer 5: System Resources Check
            if (this.config.enabledLayers.systemResources) {
                const resources = await this.checkSystemResources();
                health.memoryUsage = resources.memoryUsage;
                health.errorRate = resources.errorRate;
                if (resources.memoryUsage > this.config.thresholds.maxMemoryUsage) {
                    health.issues.push(`High memory usage: ${resources.memoryUsage} bytes`);
                }
                if (resources.errorRate > this.config.thresholds.maxErrorRate) {
                    health.issues.push(`High error rate: ${resources.errorRate}`);
                }
            }

            // Calculate overall health
            health.overallHealthy = this.assessOverallHealth(health);
            health.healthScore = this.calculateHealthScore(health);
            health.checkDuration = Date.now() - startTime;

            // Store in history for trend analysis
            this.storeHealthCheck(health);

        } catch (error) {
            logger.error("Health check failed", error as Error, {
                error: error instanceof Error ? error.message : String(error),
            });
            health.overallHealthy = false;
            health.healthScore = 0;
            health.issues.push(`Health check error: ${error}`);
            health.checkDuration = Date.now() - startTime;
        }

        return health;
    }

    /**
     * Check process liveness at OS level
     */
    private checkProcessLiveness(): boolean {
        return this.processSpawner.isAlive();
    }

    /**
     * Check HTTP health endpoint
     */
    private async checkHTTPHealth(): Promise<boolean> {
        try {
            const response = await axios.get(
                `http://localhost:${this.port}/api/engine/health`,
                { timeout: this.config.timeouts.httpTimeout }
            );
            return response.data?.status === 'healthy';
        } catch (error) {
            logger.error("HTTP health check failed", error as Error, {
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    /**
     * Check WebSocket health (placeholder)
     */
    private async checkWebSocketHealth(): Promise<boolean> {
        // TODO: Implement WebSocket health checks
        // Check if WebSocket connections are active and responsive
        return true;
    }

    /**
     * Check bot operational health (placeholder)
     */
    private async checkBotOperationalHealth(): Promise<{ healthy: boolean; lastTradeActivity: Date }> {
        // TODO: Implement bot operational health checks
        // Check if bots are running, trading, and not erroring
        return {
            healthy: true,
            lastTradeActivity: new Date(),
        };
    }

    /**
     * Check system resources (placeholder)
     */
    private async checkSystemResources(): Promise<{ memoryUsage: number; errorRate: number }> {
        // TODO: Implement system resource monitoring
        // Get actual process memory usage and error rates
        return {
            memoryUsage: 0,
            errorRate: 0,
        };
    }

    /**
     * Assess overall health from all layers
     */
    private assessOverallHealth(health: EngineHealth): boolean {
        // Critical requirements: process must be alive and HTTP must respond
        if (!health.processAlive || !health.httpResponsive) {
            return false;
        }

        // Additional checks if enabled
        if (this.config.enabledLayers.websocketHealth && !health.websocketConnected) {
            return false;
        }

        if (this.config.enabledLayers.botOperational && !health.botsResponding) {
            return false;
        }

        // Check resource thresholds
        if (this.config.enabledLayers.systemResources) {
            if (health.memoryUsage > this.config.thresholds.maxMemoryUsage) {
                return false;
            }
            if (health.errorRate > this.config.thresholds.maxErrorRate) {
                return false;
            }
        }

        return true;
    }

    /**
     * Calculate health score (0-100)
     */
    private calculateHealthScore(health: EngineHealth): number {
        let score = 0;
        let totalWeight = 0;

        // Process liveness (critical - 40 points)
        if (health.processAlive) {
            score += 40;
        }
        totalWeight += 40;

        // HTTP connectivity (critical - 30 points)
        if (health.httpResponsive) {
            score += 30;
        }
        totalWeight += 30;

        // WebSocket health (important - 15 points)
        if (this.config.enabledLayers.websocketHealth) {
            if (health.websocketConnected) {
                score += 15;
            }
            totalWeight += 15;
        }

        // Bot operational (important - 10 points)
        if (this.config.enabledLayers.botOperational) {
            if (health.botsResponding) {
                score += 10;
            }
            totalWeight += 10;
        }

        // System resources (minor - 5 points)
        if (this.config.enabledLayers.systemResources) {
            const resourceScore = Math.max(0, 5 - (health.errorRate * 50) - (health.memoryUsage / this.config.thresholds.maxMemoryUsage));
            score += Math.max(0, resourceScore);
            totalWeight += 5;
        }

        return totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;
    }

    /**
     * Store health check in history for trend analysis
     */
    private storeHealthCheck(health: EngineHealth): void {
        this.lastHealthCheck = health;
        this.healthHistory.push(health);

        // Keep only last 100 health checks
        if (this.healthHistory.length > 100) {
            this.healthHistory.shift();
        }
    }

    /**
     * Get health trend analysis
     */
    getHealthTrend(): {
        currentHealth: EngineHealth | null;
        averageHealthScore: number;
        healthStability: 'stable' | 'degrading' | 'improving';
        recentIssues: string[];
    } {
        const recentChecks = this.healthHistory.slice(-10); // Last 10 checks

        if (recentChecks.length === 0) {
            return {
                currentHealth: null,
                averageHealthScore: 0,
                healthStability: 'stable',
                recentIssues: [],
            };
        }

        const averageHealthScore = Math.round(
            recentChecks.reduce((sum, check) => sum + check.healthScore, 0) / recentChecks.length
        );

        // Analyze trend
        let stability: 'stable' | 'degrading' | 'improving' = 'stable';
        if (recentChecks.length >= 3) {
            const recent = recentChecks.slice(-3);
            const trend = recent[2].healthScore - recent[0].healthScore;
            if (trend < -10) stability = 'degrading';
            else if (trend > 10) stability = 'improving';
        }

        // Collect recent issues
        const recentIssues = recentChecks
            .flatMap(check => check.issues)
            .filter((issue, index, arr) => arr.indexOf(issue) === index) // Unique
            .slice(0, 5); // Top 5

        return {
            currentHealth: this.lastHealthCheck,
            averageHealthScore,
            healthStability: stability,
            recentIssues,
        };
    }

    /**
     * Check if health has significantly degraded
     */
    hasHealthDegraded(significantThreshold = 20): boolean {
        if (this.healthHistory.length < 2) return false;

        const current = this.lastHealthCheck;
        const previous = this.healthHistory[this.healthHistory.length - 2];

        if (!current || !previous) return false;

        return (previous.healthScore - current.healthScore) >= significantThreshold;
    }

    /**
     * Get detailed health report
     */
    getHealthReport(): {
        summary: EngineHealth | null;
        trend: ReturnType<HealthMonitor['getHealthTrend']>;
        recommendations: string[];
    } {
        const summary = this.lastHealthCheck;
        const trend = this.getHealthTrend();
        const recommendations: string[] = [];

        if (summary) {
            if (!summary.overallHealthy) {
                recommendations.push("Engine is not healthy - investigate issues immediately");
            }

            if (trend.healthStability === 'degrading') {
                recommendations.push("Health is degrading - monitor closely");
            }

            if (summary.issues.length > 0) {
                recommendations.push(`Address ${summary.issues.length} health issues`);
            }

            if (summary.healthScore < 70) {
                recommendations.push("Health score is low - consider restart or maintenance");
            }
        } else {
            recommendations.push("No health data available - run health check");
        }

        return {
            summary,
            trend,
            recommendations,
        };
    }
}
