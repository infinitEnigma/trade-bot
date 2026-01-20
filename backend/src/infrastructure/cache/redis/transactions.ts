/**
 * ===========================================
 * 🔄 REDIS TRANSACTIONS
 * ===========================================
 *
 * Handles Redis transactions with intelligent conflict resolution.
 * Uses the TransactionRecoveryManager for enterprise-grade reliability.
 *
 * RESPONSIBILITIES:
 * - WATCH/MULTI/EXEC operations
 * - Intelligent retry strategies
 * - Conflict-aware backoff
 * - Circuit breaker integration
 *
 * @format
 */

import { RedisConnectionManager } from "./connection-manager";
import { logger } from "../../../core/logging";

export interface TransactionOptions {
    context?: string;        // Context for logging and analytics
    priority?: 'low' | 'normal' | 'high' | 'critical';
    timeout?: number;        // Operation timeout in ms
    retryStrategy?: RetryStrategy;
}

export interface SmartRetryResult<T> {
    success: boolean;
    result?: T;
    error?: string;
    attempts?: number;
    totalDelay?: number;
    strategy?: RetryStrategy;
}

/**
 * Intelligent retry strategies for Redis transactions
 */
enum RetryStrategy {
    IMMEDIATE_RETRY = 'immediate',     // Critical ops: 10ms, 20ms, 30ms
    EXPONENTIAL_BACKOFF = 'backoff',   // Standard ops: 100ms → 30s
    CIRCUIT_BREAKER = 'circuit',       // High conflict: extended delays
    ADAPTIVE_DELAY = 'adaptive',       // ML-based optimal delays
}

/**
 * Transaction context for analytics
 */
interface TransactionContext {
    maxRetries: number;
    context: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
    timeout?: number;
}

/**
 * Conflict statistics for adaptive learning
 */
interface ConflictStats {
    totalConflicts: number;
    recentConflicts: number;
    successRate: number;
    averageDelay: number;
    lastConflictTime: number;
}

export class RedisTransactions {
    private transactionRecoveryManager: TransactionRecoveryManager;

    constructor(private connectionManager: RedisConnectionManager) {
        this.transactionRecoveryManager = new TransactionRecoveryManager();
    }

    /**
     * Execute atomic operations with intelligent conflict resolution
     */
    async watchMultiExec<T>(
        watchKeys: string[],
        operation: (multi: any) => Promise<T>,
        maxRetries: number = 5,
        options?: TransactionOptions
    ): Promise<SmartRetryResult<T>> {
        return this.transactionRecoveryManager.executeWithSmartRetry(
            watchKeys,
            operation,
            {
                maxRetries,
                context: options?.context || 'unknown',
                priority: options?.priority || 'normal',
                timeout: options?.timeout,
            }
        );
    }
}

/**
 * ===========================================
 * 🚀 TRANSACTION RECOVERY MANAGER
 * ===========================================
 *
 * Intelligent Redis transaction recovery with:
 * - Conflict-aware retry strategies
 * - Proper exponential backoff with jitter
 * - Circuit breaker integration
 * - Adaptive learning from historical patterns
 * - Comprehensive failure analysis
 *
 * SOLVES CRITICAL ISSUES:
 * - Identical operation retries (now intelligent)
 * - Insufficient backoff (now 100ms → 30s range)
 * - No escalation strategy (now circuit breaker + adaptive)
 *
 * @format
 */
class TransactionRecoveryManager {
    private conflictHistory = new Map<string, ConflictStats>();
    private circuitBreakerFailures = 0;
    private circuitBreakerState: 'closed' | 'open' | 'half_open' = 'closed';
    private circuitBreakerLastFailure = 0;
    private readonly CIRCUIT_BREAKER_THRESHOLD = 10;
    private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

    // Adaptive learning
    private successRates = new Map<string, number>();
    private optimalDelays = new Map<string, number>();

    // Exponential backoff configuration
    private readonly BASE_DELAY = 100;     // Start at 100ms
    private readonly MAX_DELAY = 30000;    // Max 30 seconds
    private readonly MULTIPLIER = 2;       // Double each time
    private readonly JITTER_FACTOR = 0.1;  // 10% random jitter

    /**
     * Execute transaction with intelligent conflict resolution
     */
    async executeWithSmartRetry<T>(
        watchKeys: string[],
        operation: (multi: any) => Promise<T>,
        context: TransactionContext
    ): Promise<SmartRetryResult<T>> {
        const keySignature = this.generateKeySignature(watchKeys);
        const conflictStats = this.getConflictStats(keySignature);

        // Select optimal retry strategy
        const strategy = this.selectRetryStrategy(conflictStats, context);

        // Execute with chosen strategy
        return this.executeWithStrategy(watchKeys, operation, strategy, context);
    }

    /**
     * Execute transaction with specific retry strategy
     */
    private async executeWithStrategy<T>(
        watchKeys: string[],
        operation: (multi: any) => Promise<T>,
        strategy: RetryStrategy,
        context: TransactionContext
    ): Promise<SmartRetryResult<T>> {
        const keySignature = this.generateKeySignature(watchKeys);
        let attempts = 0;
        let totalDelay = 0;
        const startTime = Date.now();

        while (attempts < context.maxRetries) {
            attempts++;

            // Check circuit breaker
            if (this.circuitBreakerState === 'open') {
                if (this.shouldResetCircuitBreaker()) {
                    this.circuitBreakerState = 'half_open';
                    logger.info("Circuit breaker transitioned to half-open", { keySignature });
                } else {
                    return {
                        success: false,
                        error: 'Circuit breaker open - transaction temporarily disabled',
                        attempts,
                        totalDelay,
                        strategy
                    };
                }
            }

            try {
                // Execute transaction
                const result = await this.attemptTransaction(watchKeys, operation);

                if (result.success) {
                    // Success - update learning models
                    this.recordSuccess(keySignature, attempts, totalDelay);
                    this.circuitBreakerFailures = 0;

                    return {
                        success: true,
                        result: result.data,
                        attempts,
                        totalDelay,
                        strategy
                    };
                } else {
                    // Transaction aborted - handle conflict
                    this.recordConflict(keySignature, attempts);

                    if (attempts >= context.maxRetries) {
                        // Max retries reached - escalate
                        this.handleMaxRetriesReached(keySignature, context);
                        return {
                            success: false,
                            error: `Transaction aborted after ${attempts} attempts`,
                            attempts,
                            totalDelay,
                            strategy
                        };
                    }

                    // Calculate and apply backoff delay
                    const delay = this.calculateDelay(strategy, keySignature, attempts, context);
                    totalDelay += delay;

                    logger.debug("Transaction conflict, applying backoff", {
                        keySignature,
                        attempt: attempts,
                        delay,
                        totalDelay,
                        strategy
                    });

                    await this.sleep(delay);
                    continue;
                }

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                // Circuit breaker for non-conflict errors
                this.circuitBreakerFailures++;
                if (this.circuitBreakerFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
                    this.circuitBreakerState = 'open';
                    this.circuitBreakerLastFailure = Date.now();
                    logger.warn("Circuit breaker opened due to repeated errors", {
                        failures: this.circuitBreakerFailures,
                        threshold: this.CIRCUIT_BREAKER_THRESHOLD
                    });
                }

                return {
                    success: false,
                    error: errorMessage,
                    attempts,
                    totalDelay,
                    strategy
                };
            }
        }

        return {
            success: false,
            error: 'Max retries exceeded',
            attempts: context.maxRetries,
            totalDelay,
            strategy
        };
    }

    /**
     * Attempt a single transaction execution
     */
    private async attemptTransaction<T>(
        watchKeys: string[],
        operation: (multi: any) => Promise<T>
    ): Promise<{ success: boolean; data?: T; aborted?: boolean }> {
        const client = redisService.getClient();

        try {
            // Watch keys for changes
            await client.watch(watchKeys);

            // Execute operation within transaction
            const multi = client.multi();
            const result = await operation(multi);

            // Execute transaction
            const execResult = await multi.exec();

            if (execResult === null) {
                // Transaction was aborted due to watched key changes
                return { success: false, aborted: true };
            }

            return { success: true, data: result };

        } catch (error) {
            throw error;
        } finally {
            // Always unwatch keys
            try {
                await client.unwatch();
            } catch (unwatchError) {
                // Ignore unwatch errors
            }
        }
    }

    /**
     * Select optimal retry strategy based on conflict history
     */
    private selectRetryStrategy(
        conflictStats: ConflictStats,
        context: TransactionContext
    ): RetryStrategy {
        // High priority transactions get immediate retry
        if (context.priority === 'critical') {
            return RetryStrategy.IMMEDIATE_RETRY;
        }

        // If recent conflict rate is high, use circuit breaker
        if (conflictStats.recentConflicts > 5) {
            return RetryStrategy.CIRCUIT_BREAKER;
        }

        // If success rate is low, use adaptive delay
        if (conflictStats.successRate < 0.5 && conflictStats.totalConflicts > 3) {
            return RetryStrategy.ADAPTIVE_DELAY;
        }

        // Default to exponential backoff
        return RetryStrategy.EXPONENTIAL_BACKOFF;
    }

    /**
     * Calculate delay based on retry strategy
     */
    private calculateDelay(
        strategy: RetryStrategy,
        keySignature: string,
        attempt: number,
        context: TransactionContext
    ): number {
        switch (strategy) {
            case RetryStrategy.IMMEDIATE_RETRY:
                return Math.min(50, attempt * 10); // Short delays: 10ms, 20ms, 30ms, 40ms, 50ms

            case RetryStrategy.EXPONENTIAL_BACKOFF:
                return this.calculateExponentialBackoff(attempt);

            case RetryStrategy.CIRCUIT_BREAKER:
                // Longer delays to reduce load
                return this.calculateExponentialBackoff(attempt) * 2;

            case RetryStrategy.ADAPTIVE_DELAY:
                return this.calculateAdaptiveDelay(keySignature, attempt);

            default:
                return this.calculateExponentialBackoff(attempt);
        }
    }

    /**
     * Calculate exponential backoff with jitter
     */
    private calculateExponentialBackoff(attempt: number): number {
        const exponentialDelay = Math.min(
            this.BASE_DELAY * Math.pow(this.MULTIPLIER, attempt - 1),
            this.MAX_DELAY
        );

        // Add jitter to prevent thundering herd
        const jitter = exponentialDelay * this.JITTER_FACTOR * (Math.random() * 2 - 1);
        const finalDelay = Math.max(10, exponentialDelay + jitter);

        return Math.round(finalDelay);
    }

    /**
     * Calculate adaptive delay based on historical performance
     */
    private calculateAdaptiveDelay(keySignature: string, attempt: number): number {
        const successRate = this.successRates.get(keySignature) || 0.5;
        const optimalDelay = this.optimalDelays.get(keySignature) || this.BASE_DELAY;

        // For low success rates, increase delay more aggressively
        const adaptiveMultiplier = successRate < 0.3 ? 3 : successRate < 0.7 ? 2 : 1.5;
        const baseDelay = optimalDelay * adaptiveMultiplier;

        const exponentialDelay = Math.min(
            baseDelay * Math.pow(this.MULTIPLIER, attempt - 1),
            this.MAX_DELAY
        );

        return Math.round(exponentialDelay);
    }

    /**
     * Get conflict statistics for a key signature
     */
    private getConflictStats(keySignature: string): ConflictStats {
        const existing = this.conflictHistory.get(keySignature);

        if (existing) {
            // Calculate recent conflicts (last 5 minutes)
            const recentThreshold = Date.now() - 5 * 60 * 1000;
            const recentConflicts = existing.lastConflictTime > recentThreshold ? 1 : 0;

            return {
                ...existing,
                recentConflicts,
                successRate: existing.totalConflicts > 0 ?
                    (existing.totalConflicts - existing.recentConflicts) / existing.totalConflicts : 1
            };
        }

        return {
            totalConflicts: 0,
            recentConflicts: 0,
            successRate: 1,
            averageDelay: 0,
            lastConflictTime: 0
        };
    }

    /**
     * Record successful transaction
     */
    private recordSuccess(keySignature: string, attempts: number, totalDelay: number): void {
        // Update adaptive learning
        const currentRate = this.successRates.get(keySignature) || 0.5;
        const newRate = currentRate * 0.9 + 0.1; // Slight increase on success
        this.successRates.set(keySignature, newRate);

        // If success on first attempt, reduce optimal delay
        if (attempts === 1 && totalDelay < 1000) {
            const currentOptimal = this.optimalDelays.get(keySignature) || this.BASE_DELAY;
            this.optimalDelays.set(keySignature, Math.max(50, currentOptimal * 0.9));
        }

        logger.debug("Transaction success recorded", {
            keySignature,
            attempts,
            totalDelay,
            newSuccessRate: Math.round(newRate * 100) / 100
        });
    }

    /**
     * Record transaction conflict
     */
    private recordConflict(keySignature: string, attempt: number): void {
        const stats = this.getConflictStats(keySignature);

        stats.totalConflicts++;
        stats.lastConflictTime = Date.now();

        // Update success rate (decrease on conflict)
        const currentRate = this.successRates.get(keySignature) || 0.5;
        const newRate = currentRate * 0.95; // Slight decrease on conflict
        this.successRates.set(keySignature, newRate);

        // Increase optimal delay on repeated conflicts
        if (stats.totalConflicts > 3) {
            const currentOptimal = this.optimalDelays.get(keySignature) || this.BASE_DELAY;
            this.optimalDelays.set(keySignature, Math.min(this.MAX_DELAY, currentOptimal * 1.1));
        }

        this.conflictHistory.set(keySignature, stats);

        logger.debug("Transaction conflict recorded", {
            keySignature,
            totalConflicts: stats.totalConflicts,
            newSuccessRate: Math.round(newRate * 100) / 100
        });
    }

    /**
     * Handle max retries reached - escalate appropriately
     */
    private handleMaxRetriesReached(keySignature: string, context: TransactionContext): void {
        logger.warn("Max transaction retries reached", {
            keySignature,
            context: context.context,
            priority: context.priority,
            maxRetries: context.maxRetries
        });

        // For high priority transactions, could trigger alerts or alternative handling
        if (context.priority === 'critical') {
            logger.error("Critical transaction failed after max retries", {
                keySignature,
                context: context.context
            });
        }
    }

    /**
     * Check if circuit breaker should reset
     */
    private shouldResetCircuitBreaker(): boolean {
        const timeSinceLastFailure = Date.now() - this.circuitBreakerLastFailure;
        return timeSinceLastFailure >= this.CIRCUIT_BREAKER_TIMEOUT;
    }

    /**
     * Generate key signature for conflict tracking
     */
    private generateKeySignature(watchKeys: string[]): string {
        // Sort keys for consistent signature
        const sortedKeys = [...watchKeys].sort();
        // Simple hash of sorted keys
        return sortedKeys.join('|').slice(0, 50); // Limit length
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get recovery manager statistics
     */
    getRecoveryStats() {
        return {
            circuitBreaker: {
                state: this.circuitBreakerState,
                failures: this.circuitBreakerFailures,
                lastFailure: this.circuitBreakerLastFailure,
                threshold: this.CIRCUIT_BREAKER_THRESHOLD
            },
            adaptiveLearning: {
                trackedKeys: this.successRates.size,
                averageSuccessRate: Array.from(this.successRates.values()).reduce((a, b) => a + b, 0) / Math.max(1, this.successRates.size),
                optimalDelaysConfigured: this.optimalDelays.size
            },
            conflictHistory: {
                trackedSignatures: this.conflictHistory.size,
                totalConflicts: Array.from(this.conflictHistory.values()).reduce((sum, stats) => sum + stats.totalConflicts, 0)
            }
        };
    }
}

// Import for internal use (avoid circular dependency)
import { redisService } from "../redis.service";
