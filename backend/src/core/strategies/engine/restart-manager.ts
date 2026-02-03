/**
 * ===========================================
 * 🔄 RESTART MANAGER - INTELLIGENT RECOVERY POLICIES
 * ===========================================
 *
 * Manages intelligent restart policies for the trading engine with
 * exponential backoff, circuit breaker coordination, and recovery tracking.
 *
 * RESTART POLICIES:
 * - Immediate: Restart immediately on failure
 * - Exponential Backoff: Wait longer between attempts
 * - Manual Only: Require manual intervention
 * - Time Windowed: Only restart during trading hours
 *
 * RECOVERY TRACKING:
 * - Attempt history and success rates
 * - Backoff delay calculation
 * - Circuit breaker state coordination
 * - Recovery time monitoring
 *
 * @format
 */

import { logger } from "../../logging";

export enum RestartPolicy {
    IMMEDIATE = 'immediate',         // Restart immediately on failure
    EXPONENTIAL_BACKOFF = 'backoff', // Wait longer between attempts
    MANUAL_ONLY = 'manual',          // Require manual intervention
    TIME_WINDOWED = 'windowed',      // Only restart during trading hours
}

export interface RestartAttempt {
    timestamp: number;
    success: boolean;
    reason: string;
    backoffDelay: number;
    attemptNumber: number;
}

export interface RestartResult {
    success: boolean;
    error?: string;
    attemptNumber: number;
    totalAttempts: number;
    nextRetryIn?: number; // milliseconds
}

export interface RestartConfig {
    policy: RestartPolicy;
    maxAttempts: number;
    baseBackoffMs: number; // Base delay for exponential backoff
    maxBackoffMs: number;  // Maximum backoff delay
    backoffMultiplier: number; // Exponential backoff multiplier
    jitterFactor: number;  // Random jitter to prevent thundering herd
    tradingHoursOnly: boolean; // For TIME_WINDOWED policy
    tradingHoursStart: string; // HH:MM format
    tradingHoursEnd: string;   // HH:MM format
}

export class RestartManager {
    private config: RestartConfig;
    private restartHistory: RestartAttempt[] = [];
    private lastRestartAttempt = 0;

    constructor(config?: Partial<RestartConfig>) {
        this.config = {
            policy: RestartPolicy.EXPONENTIAL_BACKOFF,
            maxAttempts: 5,
            baseBackoffMs: 2000, // 2 seconds
            maxBackoffMs: 300000, // 5 minutes
            backoffMultiplier: 2,
            jitterFactor: 0.1, // 10% jitter
            tradingHoursOnly: false,
            tradingHoursStart: '09:30',
            tradingHoursEnd: '16:00',
            ...config,
        };
    }

    /**
     * Attempt intelligent restart with current policy
     */
    async attemptIntelligentRestart(reason: string): Promise<RestartResult> {
        const now = Date.now();
        const attemptNumber = this.restartHistory.length + 1;

        // Check if we've exceeded max attempts
        if (attemptNumber > this.config.maxAttempts) {
            return {
                success: false,
                error: `Maximum restart attempts (${this.config.maxAttempts}) exceeded`,
                attemptNumber,
                totalAttempts: this.restartHistory.length,
            };
        }

        // Check restart policy constraints
        const policyCheck = this.checkRestartPolicy(now);
        if (!policyCheck.allowed) {
            return {
                success: false,
                error: policyCheck.reason,
                attemptNumber,
                totalAttempts: this.restartHistory.length,
                nextRetryIn: policyCheck.nextRetryIn,
            };
        }

        // Calculate backoff delay
        const backoffDelay = this.calculateBackoffDelay(attemptNumber);

        // Check if we're still in backoff period
        if (now - this.lastRestartAttempt < backoffDelay) {
            const remainingDelay = backoffDelay - (now - this.lastRestartAttempt);
            return {
                success: false,
                error: 'Still in backoff period',
                attemptNumber,
                totalAttempts: this.restartHistory.length,
                nextRetryIn: remainingDelay,
            };
        }

        // Record attempt start
        this.lastRestartAttempt = now;
        const attempt: RestartAttempt = {
            timestamp: now,
            success: false, // Will update on completion
            reason,
            backoffDelay,
            attemptNumber,
        };

        this.restartHistory.push(attempt);

        logger.info("Attempting intelligent restart", {
            attemptNumber,
            policy: this.config.policy,
            reason,
            backoffDelay,
            maxAttempts: this.config.maxAttempts,
        });

        try {
            // Perform the actual restart (delegated to caller)
            // This method handles policy and timing, not the actual restart
            await this.performRestart();

            // Mark attempt as successful
            attempt.success = true;

            logger.info("Intelligent restart completed successfully", {
                attemptNumber,
                totalAttempts: this.restartHistory.length,
            });

            return {
                success: true,
                attemptNumber,
                totalAttempts: this.restartHistory.length,
            };

        } catch (error) {
            logger.error("Intelligent restart failed", {
                attemptNumber,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                attemptNumber,
                totalAttempts: this.restartHistory.length,
                nextRetryIn: attemptNumber < this.config.maxAttempts ? this.calculateBackoffDelay(attemptNumber + 1) : undefined,
            };
        }
    }

    /**
     * Perform the actual restart (placeholder - implemented by caller)
     */
    protected async performRestart(): Promise<void> {
        // This is a placeholder - the actual restart logic is implemented
        // by the caller (ProcessSupervisor or EngineManager)
        // This allows the RestartManager to focus on policy and timing
        logger.debug("Performing restart (delegated to caller)");
    }

    /**
     * Check if restart is allowed based on current policy
     */
    private checkRestartPolicy(now: number): { allowed: boolean; reason?: string; nextRetryIn?: number } {
        switch (this.config.policy) {
            case RestartPolicy.IMMEDIATE:
                return { allowed: true };

            case RestartPolicy.EXPONENTIAL_BACKOFF:
                return { allowed: true };

            case RestartPolicy.MANUAL_ONLY:
                return {
                    allowed: false,
                    reason: 'Manual restart required - automatic restarts disabled',
                };

            case RestartPolicy.TIME_WINDOWED:
                return this.checkTradingHoursPolicy(now);

            default:
                return {
                    allowed: false,
                    reason: `Unknown restart policy: ${this.config.policy}`,
                };
        }
    }

    /**
     * Check if current time is within trading hours for TIME_WINDOWED policy
     */
    private checkTradingHoursPolicy(now: number): { allowed: boolean; reason?: string; nextRetryIn?: number } {
        if (!this.config.tradingHoursOnly) {
            return { allowed: true };
        }

        const currentTime = new Date(now);
        const currentHour = currentTime.getHours();
        const currentMinute = currentTime.getMinutes();
        const currentMinutes = currentHour * 60 + currentMinute;

        const [startHour, startMinute] = this.config.tradingHoursStart.split(':').map(Number);
        const [endHour, endMinute] = this.config.tradingHoursEnd.split(':').map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        const isWithinTradingHours = currentMinutes >= startMinutes && currentMinutes <= endMinutes;

        if (isWithinTradingHours) {
            return { allowed: true };
        }

        // Calculate next retry time (start of next trading day)
        const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
        tomorrow.setHours(startHour, startMinute, 0, 0);
        const nextRetryIn = tomorrow.getTime() - now;

        return {
            allowed: false,
            reason: `Outside trading hours (${this.config.tradingHoursStart}-${this.config.tradingHoursEnd})`,
            nextRetryIn,
        };
    }

    /**
     * Calculate backoff delay using exponential backoff with jitter
     */
    protected calculateBackoffDelay(attemptNumber: number): number {
        if (this.config.policy === RestartPolicy.IMMEDIATE) {
            return 0;
        }

        // Exponential backoff: base * (multiplier ^ (attempt - 1))
        const exponentialDelay = this.config.baseBackoffMs * Math.pow(this.config.backoffMultiplier, attemptNumber - 1);

        // Cap at maximum backoff
        const cappedDelay = Math.min(exponentialDelay, this.config.maxBackoffMs);

        // Add jitter to prevent thundering herd
        const jitter = cappedDelay * this.config.jitterFactor * (Math.random() * 2 - 1); // ±jitterFactor
        const finalDelay = Math.max(0, cappedDelay + jitter);

        return Math.round(finalDelay);
    }

    /**
     * Get restart statistics and analysis
     */
    getRestartStatistics(): {
        totalAttempts: number;
        successfulAttempts: number;
        failedAttempts: number;
        successRate: number;
        averageBackoffDelay: number;
        currentBackoffDelay: number;
        nextRetryIn?: number;
        policy: RestartPolicy;
        canAttemptRestart: boolean;
    } {
        const totalAttempts = this.restartHistory.length;
        const successfulAttempts = this.restartHistory.filter(a => a.success).length;
        const failedAttempts = totalAttempts - successfulAttempts;
        const successRate = totalAttempts > 0 ? successfulAttempts / totalAttempts : 0;

        const averageBackoffDelay = totalAttempts > 0
            ? this.restartHistory.reduce((sum, a) => sum + a.backoffDelay, 0) / totalAttempts
            : 0;

        const currentBackoffDelay = this.calculateBackoffDelay(totalAttempts + 1);

        const nextRetryIn = this.getNextRetryTime();

        return {
            totalAttempts,
            successfulAttempts,
            failedAttempts,
            successRate: Math.round(successRate * 100) / 100,
            averageBackoffDelay: Math.round(averageBackoffDelay),
            currentBackoffDelay: Math.round(currentBackoffDelay),
            nextRetryIn,
            policy: this.config.policy,
            canAttemptRestart: totalAttempts < this.config.maxAttempts,
        };
    }

    /**
     * Get time until next retry is allowed
     */
    private getNextRetryTime(): number | undefined {
        if (this.restartHistory.length >= this.config.maxAttempts) {
            return undefined; // No more retries allowed
        }

        const now = Date.now();
        const nextAttemptNumber = this.restartHistory.length + 1;
        const backoffDelay = this.calculateBackoffDelay(nextAttemptNumber);

        // Check policy constraints
        const policyCheck = this.checkRestartPolicy(now + backoffDelay);
        if (!policyCheck.allowed && policyCheck.nextRetryIn) {
            return policyCheck.nextRetryIn;
        }

        const timeSinceLastAttempt = now - this.lastRestartAttempt;
        if (timeSinceLastAttempt < backoffDelay) {
            return backoffDelay - timeSinceLastAttempt;
        }

        return 0; // Can retry immediately
    }

    /**
     * Reset restart state (useful for manual interventions)
     */
    resetRestartState(): void {
        this.restartHistory = [];
        this.lastRestartAttempt = 0;
        logger.info("Restart state reset - all counters cleared");
    }

    /**
     * Update restart configuration
     */
    updateConfig(newConfig: Partial<RestartConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logger.info("Restart configuration updated", { newConfig });
    }

    /**
     * Check if restart should be attempted for a given failure reason
     */
    shouldAttemptRestartForReason(reason: string): boolean {
        // Define which failure reasons should trigger restarts
        const restartableReasons = [
            'process_crash',
            'process_unhealthy',
            'health_check_failed',
            'connection_lost',
        ];

        const nonRestartableReasons = [
            'manual_shutdown',
            'configuration_error',
            'insufficient_permissions',
            'out_of_memory',
        ];

        if (nonRestartableReasons.includes(reason)) {
            return false;
        }

        if (restartableReasons.includes(reason)) {
            return true;
        }

        // For unknown reasons, default to allowing restart
        logger.warn("Unknown failure reason, defaulting to allow restart", { reason });
        return true;
    }

    /**
     * Get detailed restart analysis
     */
    getRestartAnalysis(): {
        statistics: ReturnType<RestartManager['getRestartStatistics']>;
        recentAttempts: RestartAttempt[];
        recommendations: string[];
        healthStatus: 'healthy' | 'degraded' | 'critical';
    } {
        const statistics = this.getRestartStatistics();
        const recentAttempts = this.restartHistory.slice(-5); // Last 5 attempts
        const recommendations: string[] = [];

        // Determine health status
        let healthStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';

        if (statistics.failedAttempts > statistics.successfulAttempts) {
            healthStatus = 'degraded';
        }

        if (statistics.failedAttempts >= 3 || !statistics.canAttemptRestart) {
            healthStatus = 'critical';
        }

        // Generate recommendations
        if (!statistics.canAttemptRestart) {
            recommendations.push("Maximum restart attempts reached - manual intervention required");
        }

        if (statistics.successRate < 0.5 && statistics.totalAttempts >= 3) {
            recommendations.push("Low success rate - investigate root cause before further attempts");
        }

        if (statistics.averageBackoffDelay > 60000) { // 1 minute
            recommendations.push("High average backoff delay - consider adjusting restart policy");
        }

        if (this.config.policy === RestartPolicy.MANUAL_ONLY) {
            recommendations.push("Manual restart policy active - automatic recovery disabled");
        }

        return {
            statistics,
            recentAttempts,
            recommendations,
            healthStatus,
        };
    }
}
