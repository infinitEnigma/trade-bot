/**
 * ===========================================
 * ⚡ CIRCUIT BREAKER - FAILURE ISOLATION
 * ===========================================
 *
 * Implements circuit breaker pattern to prevent cascading failures
 * and provide graceful degradation when external dependencies fail.
 *
 * CIRCUIT STATES:
 * - Closed: Normal operation, requests pass through
 * - Open: Failure threshold exceeded, requests fail fast
 * - Half-Open: Testing if service has recovered
 *
 * FAILURE DETECTION:
 * - Consecutive failure counting
 * - Timeout-based failure detection
 * - Configurable failure thresholds
 *
 * RECOVERY MECHANISM:
 * - Automatic state transitions
 * - Configurable recovery timeouts
 * - Half-open testing with single request
 *
 * @format
 */

import logger from "../../logging/logger.service";

export enum CircuitState {
    CLOSED = 'closed',     // Normal operation
    OPEN = 'open',         // Failing, requests blocked
    HALF_OPEN = 'half_open' // Testing recovery
}

export interface CircuitBreakerConfig {
    failureThreshold: number;     // Failures before opening
    recoveryTimeout: number;      // Time before attempting recovery (ms)
    monitoringPeriod: number;     // Time window for failure counting (ms)
    successThreshold: number;     // Successes needed to close circuit
    timeout: number;             // Request timeout (ms)
}

export interface CircuitBreakerStats {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
    lastSuccessTime: number;
    nextAttemptTime: number;
}

export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private config: CircuitBreakerConfig;

    // Failure tracking
    private failureCount = 0;
    private successCount = 0;
    private lastFailureTime = 0;
    private lastSuccessTime = 0;

    // Half-open testing
    private nextAttemptTime = 0;

    constructor(config?: Partial<CircuitBreakerConfig>) {
        this.config = {
            failureThreshold: 5,
            recoveryTimeout: 60000, // 1 minute
            monitoringPeriod: 60000, // 1 minute
            successThreshold: 3,
            timeout: 5000, // 5 seconds
            ...config,
        };
    }

    /**
     * Execute operation with circuit breaker protection
     */
    async executeWithCircuitBreaker<T>(
        operation: () => Promise<T>,
        context?: string
    ): Promise<{ success: boolean; result?: T; error?: string }> {
        // Check if circuit breaker allows execution
        if (!this.canExecute()) {
            const waitTime = Math.max(0, this.nextAttemptTime - Date.now());
            return {
                success: false,
                error: `Circuit breaker ${this.state} - ${waitTime > 0 ? `retry in ${Math.round(waitTime / 1000)}s` : 'service unavailable'}`
            };
        }

        try {
            // Execute operation with timeout
            const result = await this.executeWithTimeout(operation);

            // Record success
            this.onSuccess();

            logger.debug("Circuit breaker operation succeeded", {
                state: this.state,
                context,
            });

            return { success: true, result };

        } catch (error) {
            // Record failure
            this.onFailure();

            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.warn("Circuit breaker operation failed", {
                state: this.state,
                error: errorMessage,
                context,
                newState: this.state,
            });

            return { success: false, error: errorMessage };
        }
    }

    /**
     * Execute operation with timeout
     */
    private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise(async (resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Operation timed out after ${this.config.timeout}ms`));
            }, this.config.timeout);

            try {
                const result = await operation();
                clearTimeout(timeout);
                resolve(result);
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    /**
     * Check if operation can be executed based on circuit state
     */
    private canExecute(): boolean {
        const now = Date.now();

        switch (this.state) {
            case CircuitState.CLOSED:
                return true;

            case CircuitState.OPEN:
                // Check if recovery timeout has elapsed
                if (now >= this.nextAttemptTime) {
                    this.state = CircuitState.HALF_OPEN;
                    this.successCount = 0; // Reset success counter
                    logger.info("Circuit breaker entering half-open state");
                    return true;
                }
                return false;

            case CircuitState.HALF_OPEN:
                // In half-open, allow one request at a time
                return true;

            default:
                return false;
        }
    }

    /**
     * Handle successful operation
     */
    private onSuccess(): void {
        const now = Date.now();
        this.lastSuccessTime = now;
        this.successCount++;

        if (this.state === CircuitState.HALF_OPEN) {
            // In half-open state, require successThreshold successes to close
            if (this.successCount >= this.config.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.failureCount = 0;
                this.successCount = 0;
                logger.info("Circuit breaker closed - service recovered", {
                    successThreshold: this.config.successThreshold,
                });
            }
        } else if (this.state === CircuitState.CLOSED) {
            // Reset failure count on success in closed state
            this.failureCount = 0;
        }
    }

    /**
     * Handle failed operation
     */
    private onFailure(): void {
        const now = Date.now();
        this.lastFailureTime = now;
        this.failureCount++;

        // Check if we should open the circuit
        if (this.state === CircuitState.CLOSED && this.failureCount >= this.config.failureThreshold) {
            this.openCircuit();
        } else if (this.state === CircuitState.HALF_OPEN) {
            // Single failure in half-open reopens circuit
            this.openCircuit();
        }
    }

    /**
     * Open the circuit breaker
     */
    private openCircuit(): void {
        this.state = CircuitState.OPEN;
        this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;

        logger.warn("Circuit breaker opened", {
            failureThreshold: this.config.failureThreshold,
            recoveryTimeout: this.config.recoveryTimeout,
            nextAttemptIn: this.config.recoveryTimeout / 1000,
        });
    }

    /**
     * Manually reset circuit breaker (for testing or admin intervention)
     */
    reset(): void {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = 0;
        this.lastSuccessTime = 0;
        this.nextAttemptTime = 0;

        logger.info("Circuit breaker manually reset");
    }

    /**
     * Manually open circuit breaker (for maintenance)
     */
    open(): void {
        this.openCircuit();
    }

    /**
     * Get circuit breaker statistics
     */
    getStats(): CircuitBreakerStats {
        return {
            state: this.state,
            failures: this.failureCount,
            successes: this.successCount,
            lastFailureTime: this.lastFailureTime,
            lastSuccessTime: this.lastSuccessTime,
            nextAttemptTime: this.nextAttemptTime,
        };
    }

    /**
     * Get circuit breaker health status
     */
    getHealthStatus(): {
        healthy: boolean;
        state: CircuitState;
        issues: string[];
        recommendations: string[];
    } {
        const issues: string[] = [];
        const recommendations: string[] = [];
        let healthy = true;

        // Check current state
        if (this.state === CircuitState.OPEN) {
            healthy = false;
            issues.push("Circuit breaker is open - requests are failing fast");
            recommendations.push("Check service health and consider manual reset if issue is resolved");
        } else if (this.state === CircuitState.HALF_OPEN) {
            issues.push("Circuit breaker is testing recovery");
            recommendations.push("Monitor next few requests for successful recovery");
        }

        // Check failure patterns
        if (this.failureCount > 0) {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;
            if (timeSinceLastFailure < this.config.monitoringPeriod) {
                issues.push(`Recent failures detected (${this.failureCount} in last ${this.config.monitoringPeriod / 1000}s)`);
            }
        }

        // Check configuration
        if (this.config.failureThreshold < 1) {
            recommendations.push("Consider increasing failure threshold for stability");
        }

        if (this.config.recoveryTimeout < 10000) {
            recommendations.push("Consider increasing recovery timeout to prevent premature retries");
        }

        return {
            healthy,
            state: this.state,
            issues,
            recommendations,
        };
    }

    /**
     * Update circuit breaker configuration
     */
    updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logger.info("Circuit breaker configuration updated", { newConfig });
    }

    /**
     * Get current circuit breaker state
     */
    getState(): CircuitState {
        return this.state;
    }

    /**
     * Check if circuit breaker is allowing requests
     */
    isRequestAllowed(): boolean {
        return this.canExecute();
    }

    /**
     * Get detailed circuit breaker analysis
     */
    getAnalysis(): {
        stats: CircuitBreakerStats;
        health: ReturnType<CircuitBreaker['getHealthStatus']>;
        config: CircuitBreakerConfig;
        metrics: {
            failureRate: number;
            averageTimeBetweenFailures: number;
            uptimePercentage: number;
        };
    } {
        const stats = this.getStats();
        const health = this.getHealthStatus();

        // Calculate metrics
        const now = Date.now();
        const totalTime = now - Math.min(stats.lastFailureTime || now, stats.lastSuccessTime || now);

        let failureRate = 0;
        let averageTimeBetweenFailures = 0;
        let uptimePercentage = 100;

        if (stats.failures > 0 && totalTime > 0) {
            failureRate = (stats.failures / (totalTime / 1000)) * 60; // failures per minute
            averageTimeBetweenFailures = totalTime / stats.failures / 1000; // seconds

            if (stats.failures > stats.successes) {
                uptimePercentage = (stats.successes / (stats.failures + stats.successes)) * 100;
            }
        }

        return {
            stats,
            health,
            config: { ...this.config },
            metrics: {
                failureRate: Math.round(failureRate * 100) / 100,
                averageTimeBetweenFailures: Math.round(averageTimeBetweenFailures * 100) / 100,
                uptimePercentage: Math.round(uptimePercentage * 100) / 100,
            },
        };
    }
}
