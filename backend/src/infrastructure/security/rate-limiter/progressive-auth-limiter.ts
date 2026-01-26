/**
 * ===========================================
 * 🚫 PROGRESSIVE AUTH LIMITER - Authentication Backoff
 * ===========================================
 *
 * Implements exponential backoff for failed authentication attempts.
 * Prevents brute force attacks by progressively increasing delays after failures.
 * Features automatic reset on successful authentication.
 *
 * @format
 */

import { redisService } from "../../../infrastructure";
import { logger } from "../../../core/logging";

/**
 * Progressive authentication limiter with exponential backoff.
 * Tracks failed login attempts and imposes increasing delays to prevent brute force attacks.
 *
 * Algorithm:
 * - 1st failure: No delay
 * - 2nd failure: 1-2 seconds (with jitter)
 * - 3rd failure: 2-4 seconds
 * - 4th failure: 4-8 seconds
 * - 5th+ failure: 8-16 seconds (capped)
 */
class ProgressiveAuthLimiter {
    /** Redis key prefix for storing failure counters */
    private readonly FAILURE_KEY_PREFIX = 'auth:failures:';

    /** Maximum number of failures to track before capping delay */
    private readonly MAX_FAILURES = 5;

    /** Base delay multiplier in milliseconds */
    private readonly BASE_DELAY_MS = 1000; // 1 second

    /** Maximum delay cap in milliseconds */
    private readonly MAX_DELAY_MS = 300000; // 5 minutes

    /**
     * Record a failed authentication attempt and calculate required delay
     *
     * @param identifier - User identifier (username, email, or IP)
     * @returns Object containing delay in milliseconds and total failure count
     */
    async recordFailure(identifier: string): Promise<{ delayMs: number; totalFailures: number }> {
        const key = `${this.FAILURE_KEY_PREFIX}${identifier}`;

        try {
            // Atomically increment failure count and get current value
            const result = await redisService.atomicReadModifyWrite(
                key,
                (current: number | null) => (current || 0) + 1,
                0,
                3 // maxRetries
            );

            if (!result.success) {
                logger.warn("Failed to record auth failure, using fallback", { identifier });
                return { delayMs: this.BASE_DELAY_MS, totalFailures: 1 };
            }

            const totalFailures = result.newValue ?? 1;
            const delayMs = this.calculateProgressiveDelay(totalFailures);

            // Set expiry on the failure counter (24 hours)
            await redisService.setex(key, 24 * 60 * 60, totalFailures.toString());

            logger.debug("Recorded authentication failure", {
                identifier,
                totalFailures,
                delayMs,
            });

            return { delayMs, totalFailures };
        } catch (error) {
            logger.error("Error recording auth failure", {
                identifier,
                error: error instanceof Error ? error.message : String(error),
            });
            return { delayMs: this.BASE_DELAY_MS, totalFailures: 1 };
        }
    }

    /**
     * Record a successful authentication and reset failure counter
     *
     * @param identifier - User identifier to reset
     */
    async recordSuccess(identifier: string): Promise<void> {
        const key = `${this.FAILURE_KEY_PREFIX}${identifier}`;

        try {
            await redisService.del(key);
            logger.debug("Reset authentication failure counter", { identifier });
        } catch (error) {
            logger.warn("Failed to reset auth failure counter", {
                identifier,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get current failure count and required delay for an identifier
     *
     * @param identifier - User identifier to check
     * @returns Object containing total failures and required delay
     */
    async getFailureInfo(identifier: string): Promise<{ totalFailures: number; delayMs: number }> {
        const key = `${this.FAILURE_KEY_PREFIX}${identifier}`;

        try {
            const result = await redisService.get(key);
            const totalFailures = result.success && result.data ? parseInt(result.data) : 0;
            const delayMs = totalFailures > 0 ? this.calculateProgressiveDelay(totalFailures) : 0;

            return { totalFailures, delayMs };
        } catch (error) {
            logger.warn("Failed to get auth failure info", {
                identifier,
                error: error instanceof Error ? error.message : String(error),
            });
            return { totalFailures: 0, delayMs: 0 };
        }
    }

    /**
     * Calculate progressive delay based on failure count using exponential backoff
     *
     * Formula: delay = base_delay * 2^(failures-1) + jitter
     * Jitter prevents thundering herd attacks (±10% randomization)
     *
     * @param failures - Number of consecutive failures
     * @returns Delay in milliseconds
     */
    private calculateProgressiveDelay(failures: number): number {
        if (failures <= 1) {
            return 0; // No delay for first failure
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, then cap at MAX_DELAY_MS
        const exponent = Math.min(failures - 1, 5); // Cap exponent to prevent overflow
        const delayMs = Math.min(this.BASE_DELAY_MS * Math.pow(2, exponent), this.MAX_DELAY_MS);

        // Add jitter (±10%) to prevent thundering herd
        const jitter = delayMs * 0.1 * (Math.random() * 2 - 1);
        return Math.max(0, Math.round(delayMs + jitter));
    }

    /**
     * Check if an identifier is currently in progressive backoff period
     *
     * @param identifier - User identifier to check
     * @returns True if identifier should be delayed
     */
    async isInBackoff(identifier: string): Promise<boolean> {
        const { delayMs } = await this.getFailureInfo(identifier);
        return delayMs > 0;
    }

    /**
     * Get the current backoff delay for an identifier without updating counters
     *
     * @param identifier - User identifier to check
     * @returns Current delay in milliseconds (0 if not in backoff)
     */
    async getCurrentDelay(identifier: string): Promise<number> {
        const { delayMs } = await this.getFailureInfo(identifier);
        return delayMs;
    }
}

// Global progressive auth limiter instance
const progressiveAuthLimiter = new ProgressiveAuthLimiter();

// Export for use in auth handlers to reset failure counter on success
export { ProgressiveAuthLimiter, progressiveAuthLimiter };
