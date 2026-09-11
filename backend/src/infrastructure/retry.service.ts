/**
 * Retry Service with Exponential Backoff
 *
 * Implements intelligent retry logic for transient errors with exponential backoff,
 * jitter, and circuit breaker patterns to improve system resilience.
 */

import { securityLogger as logger } from "../core/logging/context-aware-logger.service";
import { getContextForLogging } from "../shared/utils/context";
import { errorNotificationService, ErrorSeverity, ErrorCategory } from "../core/notifications/error-notification.service";

export interface RetryConfig {
    maxAttempts: number;
    baseDelay: number; // Base delay in milliseconds
    maxDelay: number; // Maximum delay between retries
    backoffFactor: number; // Exponential backoff multiplier
    jitter: boolean; // Add random jitter to prevent thundering herd
    retryableErrors?: (error: Error) => boolean; // Function to determine if error is retryable
}

export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: Error;
    attempts: number;
    totalDelay: number;
    aborted: boolean;
}

export class RetryService {
    private static readonly DEFAULT_CONFIG: RetryConfig = {
        maxAttempts: 3,
        baseDelay: 1000, // 1 second
        maxDelay: 30000, // 30 seconds
        backoffFactor: 2,
        jitter: true,
    };

    /**
     * Execute an operation with retry logic
     */
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        operationName: string,
        config: Partial<RetryConfig> = {}
    ): Promise<RetryResult<T>> {
        const finalConfig = { ...RetryService.DEFAULT_CONFIG, ...config };
        const startTime = Date.now();
        let lastError: Error | null = null;
        let totalDelay = 0;

        for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
            try {
                const result = await operation();
                return {
                    success: true,
                    result,
                    attempts: attempt,
                    totalDelay,
                    aborted: false,
                };
            } catch (error) {
                lastError = error as Error;

                // Check if this error is retryable
                const isRetryable = finalConfig.retryableErrors
                    ? finalConfig.retryableErrors(lastError)
                    : this.isDefaultRetryableError(lastError);

                if (!isRetryable || attempt === finalConfig.maxAttempts) {
                    // Not retryable or max attempts reached
                    logger.error(`${operationName} failed after ${attempt} attempts`, error as Error, {
                        ...getContextForLogging(),
                        operation: operationName,
                        attempts: attempt,
                        totalDelay,
                        duration: Date.now() - startTime,
                        error: lastError.message,
                        isRetryable,
                    });

                    // Notify about persistent failures
                    if (attempt > 1) {
                        await errorNotificationService.notifyError(
                            lastError,
                            {
                                category: ErrorCategory.SYSTEM,
                                operation: operationName,
                                metadata: {
                                    retryAttempts: attempt,
                                    totalDelay,
                                    duration: Date.now() - startTime,
                                },
                            },
                            attempt >= finalConfig.maxAttempts ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
                            attempt,
                            `Failed after ${attempt} attempts`
                        );
                    }

                    return {
                        success: false,
                        error: lastError,
                        attempts: attempt,
                        totalDelay,
                        aborted: false,
                    };
                }

                // Calculate delay for next attempt
                const delay = this.calculateDelay(attempt, finalConfig);

                logger.warn(`${operationName} attempt ${attempt} failed, retrying in ${delay}ms`, {
                    ...getContextForLogging(),
                    operation: operationName,
                    attempt,
                    delay,
                    error: lastError.message,
                });

                totalDelay += delay;
                await this.delay(delay);
            }
        }

        // This should never be reached, but TypeScript requires it
        return {
            success: false,
            error: lastError || new Error("Unknown error"),
            attempts: finalConfig.maxAttempts,
            totalDelay,
            aborted: false,
        };
    }

    /**
     * Execute with circuit breaker pattern
     */
    async executeWithCircuitBreaker<T>(
        operation: () => Promise<T>,
        operationName: string,
        circuitBreakerKey: string,
        config: Partial<RetryConfig> = {}
    ): Promise<RetryResult<T>> {
        // TODO: Implement circuit breaker logic
        // For now, just use regular retry
        return this.executeWithRetry(operation, operationName, config);
    }

    /**
     * Calculate delay for retry attempt using exponential backoff
     */
    private calculateDelay(attempt: number, config: RetryConfig): number {
        const exponentialDelay = config.baseDelay * Math.pow(config.backoffFactor, attempt - 1);
        const delayWithCap = Math.min(exponentialDelay, config.maxDelay);

        if (config.jitter) {
            // Add random jitter (±25% of the delay)
            const jitterRange = delayWithCap * 0.25;
            const jitter = (Math.random() - 0.5) * 2 * jitterRange;
            return Math.max(0, delayWithCap + jitter);
        }

        return delayWithCap;
    }

    /**
     * Check if an error is retryable by default
     */
    private isDefaultRetryableError(error: Error): boolean {
        const message = error.message.toLowerCase();
        const name = error.name.toLowerCase();

        // Network-related errors
        if (message.includes('timeout') ||
            message.includes('econnrefused') ||
            message.includes('enotfound') ||
            message.includes('econnreset') ||
            message.includes('network') ||
            name.includes('timeout')) {
            return true;
        }

        // HTTP 5xx errors
        if (message.includes('status code 5')) {
            return true;
        }

        // Database connection errors
        if (message.includes('connection') &&
            (message.includes('lost') || message.includes('failed') || message.includes('timeout'))) {
            return true;
        }

        // WebSocket connection errors
        if (message.includes('websocket') &&
            (message.includes('closed') || message.includes('failed'))) {
            return true;
        }

        // Default to not retryable
        return false;
    }

    /**
     * Utility function to create a delay
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
export const retryService = new RetryService();

/**
 * Convenience function for quick retry operations
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    config?: Partial<RetryConfig>
): Promise<T> {
    const result = await retryService.executeWithRetry(operation, operationName, config);

    if (!result.success) {
        throw result.error || new Error(`${operationName} failed after ${result.attempts} attempts`);
    }

    if (result.result === undefined) {
        throw new Error(`${operationName} completed successfully but returned no result`);
    }

    return result.result;
}

/**
 * Pre-configured retry configurations for common use cases
 */
export const RETRY_CONFIGS = {
    // Fast retries for quick operations (API calls, cache operations)
    FAST: {
        maxAttempts: 3,
        baseDelay: 500, // 500ms
        maxDelay: 5000, // 5 seconds
        backoffFactor: 2,
        jitter: true,
    } as RetryConfig,

    // Standard retries for most operations
    STANDARD: {
        maxAttempts: 3,
        baseDelay: 1000, // 1 second
        maxDelay: 10000, // 10 seconds
        backoffFactor: 2,
        jitter: true,
    } as RetryConfig,

    // Slow retries for expensive operations (database writes, external APIs)
    SLOW: {
        maxAttempts: 5,
        baseDelay: 2000, // 2 seconds
        maxDelay: 30000, // 30 seconds
        backoffFactor: 1.5,
        jitter: true,
    } as RetryConfig,

    // Aggressive retries for critical operations
    AGGRESSIVE: {
        maxAttempts: 5,
        baseDelay: 1000, // 1 second
        maxDelay: 60000, // 1 minute
        backoffFactor: 2,
        jitter: true,
    } as RetryConfig,
};

/**
 * Custom retryable error checkers for specific scenarios
 */
export const RETRY_CONDITIONS = {
    // Retry on network errors
    NETWORK_ERRORS: (error: Error): boolean => {
        const message = error.message.toLowerCase();
        return message.includes('timeout') ||
            message.includes('econnrefused') ||
            message.includes('enotfound') ||
            message.includes('network');
    },

    // Retry on HTTP errors (5xx, some 4xx)
    HTTP_ERRORS: (error: Error): boolean => {
        const message = error.message.toLowerCase();
        return message.includes('status code 5') ||
            message.includes('502') ||
            message.includes('503') ||
            message.includes('504');
    },

    // Retry on database connection errors
    DATABASE_CONNECTION: (error: Error): boolean => {
        const message = error.message.toLowerCase();
        return message.includes('connection') &&
            (message.includes('lost') ||
                message.includes('failed') ||
                message.includes('timeout'));
    },

    // Retry on WebSocket errors
    WEBSOCKET_ERRORS: (error: Error): boolean => {
        const message = error.message.toLowerCase();
        return message.includes('websocket') &&
            (message.includes('closed') ||
                message.includes('failed') ||
                message.includes('reconnect'));
    },

    // Combined network and HTTP errors
    NETWORK_AND_HTTP: (error: Error): boolean => {
        return RETRY_CONDITIONS.NETWORK_ERRORS(error) ||
            RETRY_CONDITIONS.HTTP_ERRORS(error);
    },
};
