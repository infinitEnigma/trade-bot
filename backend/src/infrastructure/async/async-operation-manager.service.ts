/**
 * ===========================================
 * 🔄 ASYNC OPERATION MANAGER
 * ===========================================
 *
 * Manages async operations with preserved correlation context.
 * Ensures background jobs and async tasks maintain request tracing.
 *
 * RESPONSIBILITIES:
 * - Context propagation across async boundaries
 * - Background job management with correlation
 * - Async operation timing and monitoring
 * - Error handling with context preservation
 * - Performance tracking across operations
 *
 * @format
 */

import { AsyncLocalStorage } from "async_hooks";
import { randomBytes } from "crypto";
import {
    getCurrentContext,
    createChildContext,
    RequestContext,
} from "../../shared/utils/context";
import { contextLogger, ContextAwareLogger } from "../../core/logging";

export interface AsyncOperationOptions {
    userId?: string;
    userLevel?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    timeout?: number;
    retries?: number;
    component?: string;
}

export interface BackgroundJob {
    id: string;
    name: string;
    function: () => Promise<void>;
    context: RequestContext | undefined;
    submittedAt: number;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    priority: 'low' | 'normal' | 'high' | 'critical';
}

/**
 * Manages async operations with context preservation
 */
export class AsyncOperationManager {
    private jobQueue: Map<string, BackgroundJob> = new Map();
    private activeJobs: Map<string, BackgroundJob> = new Map();
    private jobTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private maxConcurrentJobs = 10;

    /**
     * Execute async operation with preserved context
     */
    async executeWithContext<T>(
        operationName: string,
        operation: () => Promise<T>,
        options: AsyncOperationOptions = {}
    ): Promise<T> {
        const currentContext = getCurrentContext();

        if (!currentContext) {
            // No context to preserve, execute normally
            contextLogger.debug(`Executing operation without context: ${operationName}`);
            return operation();
        }

        // Create child context for this operation
        const childContext = createChildContext(operationName);

        // Copy user information with option overrides
        childContext.userId = options.userId || currentContext.userId;
        childContext.userLevel = options.userLevel || currentContext.userLevel;

        const logger = new ContextAwareLogger(options.component || 'async-operation');

        // Create a new AsyncLocalStorage instance for this operation
        const als = new AsyncLocalStorage<RequestContext>();
        return als.run(childContext, async () => {
            const timer = logger.startOperation(operationName, {
                operationType: 'async',
                priority: options.priority || 'normal',
            });

            try {
                logger.debug(`Starting async operation: ${operationName}`, {
                    hasParentContext: !!currentContext,
                    parentCorrelationId: currentContext.correlationId,
                    childRequestId: childContext.requestId,
                });

                const result = await operation();

                timer.success({
                    operationType: 'async_complete',
                });

                return result;

            } catch (error) {
                timer.failure(error as Error, {
                    operationType: 'async_error',
                });

                throw error;
            }
        });
    }

    /**
     * Schedule background job with context preservation
     */
    submitJob(
        jobName: string,
        jobFunction: () => Promise<void>,
        options: AsyncOperationOptions & { delayMs?: number } = {}
    ): string {
        const jobId = `job_${Date.now()}_${randomBytes(4).toString('hex')}`;
        const currentContext = getCurrentContext();

        const job: BackgroundJob = {
            id: jobId,
            name: jobName,
            function: jobFunction,
            context: currentContext,
            submittedAt: Date.now(),
            status: 'queued',
            priority: options.priority || 'normal',
        };

        this.jobQueue.set(jobId, job);

        contextLogger.info("Background job submitted", {
            jobId,
            jobName,
            hasContext: !!currentContext,
            priority: job.priority,
            delay: options.delayMs || 0,
        });

        // Schedule execution
        if (options.delayMs && options.delayMs > 0) {
            this.scheduleDelayedJob(job, options.delayMs);
        } else {
            this.processJob(job);
        }

        return jobId;
    }

    /**
     * Schedule job with delay
     */
    private scheduleDelayedJob(job: BackgroundJob, delayMs: number): void {
        const timeout = setTimeout(() => {
            this.jobTimeouts.delete(job.id);
            this.processJob(job);
        }, delayMs);

        this.jobTimeouts.set(job.id, timeout);
    }

    /**
     * Process a background job
     */
    private async processJob(job: BackgroundJob): Promise<void> {
        // Check concurrent job limit
        if (this.activeJobs.size >= this.maxConcurrentJobs) {
            contextLogger.warn("Job queue backpressure - too many concurrent jobs", {
                jobId: job.id,
                jobName: job.name,
                activeJobs: this.activeJobs.size,
                maxConcurrent: this.maxConcurrentJobs,
            });

            // Re-queue job for later processing
            setTimeout(() => this.processJob(job), 1000);
            return;
        }

        job.status = 'running';
        this.activeJobs.set(job.id, job);
        this.jobQueue.delete(job.id);

        const logger = new ContextAwareLogger('background-job');

        if (!job.context) {
            // No context to preserve, execute normally
            try {
                await job.function();
                job.status = 'completed';
                logger.info("Background job completed (no context)", {
                    jobId: job.id,
                    jobName: job.name,
                });
            } catch (error) {
                job.status = 'failed';
                logger.error("Background job failed (no context)", error as Error, {
                    jobId: job.id,
                    jobName: job.name,
                });
            } finally {
                this.activeJobs.delete(job.id);
            }
            return;
        }

        // Execute with preserved context
        const als = new AsyncLocalStorage<RequestContext>();
        await als.run(job.context, async () => {
            const timer = logger.startOperation(job.name, {
                jobId: job.id,
                operationType: 'background_job',
                priority: job.priority,
            });

            try {
                logger.info("Background job started with context", {
                    jobId: job.id,
                    jobName: job.name,
                    correlationId: job.context?.correlationId || 'unknown',
                    userId: job.context?.userId || 'unknown',
                });

                await job.function();

                job.status = 'completed';
                timer.success({
                    operationType: 'background_job_complete',
                });

            } catch (error) {
                job.status = 'failed';
                timer.failure(error as Error, {
                    operationType: 'background_job_error',
                });
            } finally {
                this.activeJobs.delete(job.id);
            }
        });
    }

    /**
     * Cancel a background job
     */
    cancelJob(jobId: string): boolean {
        // Check if job is queued
        const queuedJob = this.jobQueue.get(jobId);
        if (queuedJob) {
            this.jobQueue.delete(jobId);
            contextLogger.info("Cancelled queued job", { jobId, jobName: queuedJob.name });
            return true;
        }

        // Check if job is scheduled
        const timeout = this.jobTimeouts.get(jobId);
        if (timeout) {
            clearTimeout(timeout);
            this.jobTimeouts.delete(jobId);
            this.jobQueue.delete(jobId);
            contextLogger.info("Cancelled scheduled job", { jobId });
            return true;
        }

        // Cannot cancel running jobs
        const activeJob = this.activeJobs.get(jobId);
        if (activeJob) {
            contextLogger.warn("Cannot cancel running job", { jobId, jobName: activeJob.name });
            return false;
        }

        contextLogger.warn("Job not found for cancellation", { jobId });
        return false;
    }

    /**
     * Get job status
     */
    getJobStatus(jobId: string): BackgroundJob | null {
        return this.jobQueue.get(jobId) ||
            this.activeJobs.get(jobId) ||
            null;
    }

    /**
     * Get operation statistics
     */
    getStats() {
        const queuedJobs = Array.from(this.jobQueue.values());
        const activeJobs = Array.from(this.activeJobs.values());

        const stats = {
            queue: {
                size: this.jobQueue.size,
                jobs: queuedJobs.map(job => ({
                    id: job.id,
                    name: job.name,
                    priority: job.priority,
                    submittedAt: job.submittedAt,
                })),
            },
            active: {
                count: this.activeJobs.size,
                maxConcurrent: this.maxConcurrentJobs,
                jobs: activeJobs.map(job => ({
                    id: job.id,
                    name: job.name,
                    priority: job.priority,
                    submittedAt: job.submittedAt,
                    hasContext: !!job.context,
                })),
            },
            scheduled: {
                count: this.jobTimeouts.size,
            },
        };

        return stats;
    }

    /**
     * Set maximum concurrent jobs
     */
    setMaxConcurrentJobs(max: number): void {
        this.maxConcurrentJobs = Math.max(1, max);
        contextLogger.info("Updated max concurrent jobs", {
            oldValue: this.maxConcurrentJobs,
            newValue: max,
        });
    }

    /**
     * Clean up completed jobs (for memory management)
     */
    cleanupCompletedJobs(maxAge: number = 3600000): number { // 1 hour default
        const _cutoffTime = Date.now() - maxAge;
        const cleaned = 0;

        // Note: In a real implementation, we'd keep a history of completed jobs
        // For now, this is a placeholder

        if (cleaned > 0) {
            contextLogger.debug("Cleaned up old jobs", { cleaned, maxAge });
        }

        return cleaned;
    }

    /**
     * Graceful shutdown - wait for active jobs to complete
     */
    async shutdown(timeoutMs: number = 30000): Promise<void> {
        contextLogger.info("Async operation manager shutting down", {
            activeJobs: this.activeJobs.size,
            queuedJobs: this.jobQueue.size,
            scheduledJobs: this.jobTimeouts.size,
            timeout: timeoutMs,
        });

        // Cancel all scheduled jobs
        for (const [jobId, timeout] of this.jobTimeouts) {
            clearTimeout(timeout);
            const job = this.jobQueue.get(jobId);
            if (job) {
                job.status = 'cancelled';
            }
        }
        this.jobTimeouts.clear();

        // Wait for active jobs to complete or timeout
        if (this.activeJobs.size > 0) {
            const shutdownPromise = new Promise<void>((resolve) => {
                const checkInterval = setInterval(() => {
                    if (this.activeJobs.size === 0) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });

            const timeoutPromise = new Promise<void>((resolve) => {
                setTimeout(() => {
                    contextLogger.warn("Shutdown timeout reached, forcing exit", {
                        remainingJobs: this.activeJobs.size,
                    });
                    resolve();
                }, timeoutMs);
            });

            await Promise.race([shutdownPromise, timeoutPromise]);
        }

        contextLogger.info("Async operation manager shutdown complete", {
            finalActiveJobs: this.activeJobs.size,
        });
    }

    /**
     * Cleanup method for test environments
     * Cancels all jobs and clears all intervals
     */
    cleanupForTests(): void {
        try {
            // Cancel all scheduled jobs
            for (const [jobId, timeout] of this.jobTimeouts) {
                clearTimeout(timeout);
                const job = this.jobQueue.get(jobId);
                if (job) {
                    job.status = 'cancelled';
                }
            }
            this.jobTimeouts.clear();

            // Clear job queue
            this.jobQueue.clear();

            // Note: We don't wait for active jobs to complete in tests
            // as this could cause test timeouts
            if (this.activeJobs.size > 0) {
                contextLogger.warn("Active jobs still running during test cleanup", {
                    activeJobs: this.activeJobs.size,
                });
            }

            contextLogger.info("Async operation manager cleaned up for tests", {
                cancelledJobs: this.jobTimeouts.size,
                clearedQueue: this.jobQueue.size,
            });
        } catch (error) {
            contextLogger.error("Error during async operation manager cleanup", error as Error, {});
        }
    }
}

// Singleton instance
let asyncOperationManager: AsyncOperationManager;

/**
 * Get the async operation manager instance
 */
export function getAsyncOperationManager(): AsyncOperationManager {
    if (!asyncOperationManager) {
        asyncOperationManager = new AsyncOperationManager();
    }
    return asyncOperationManager;
}

// Default export (remove duplicate declaration)

/**
 * Convenience functions for common use cases
 */

/**
 * Execute operation with context preservation
 */
export async function executeAsync<T>(
    operationName: string,
    operation: () => Promise<T>,
    options?: AsyncOperationOptions
): Promise<T> {
    return asyncOperationManager.executeWithContext(operationName, operation, options);
}

/**
 * Submit background job with context preservation
 */
export function submitBackgroundJob(
    jobName: string,
    jobFunction: () => Promise<void>,
    options?: AsyncOperationOptions & { delayMs?: number }
): string {
    return asyncOperationManager.submitJob(jobName, jobFunction, options);
}

/**
 * Create context-bound logger for a component
 */
export function createContextLogger(componentName: string): ContextAwareLogger {
    return new ContextAwareLogger(componentName);
}
