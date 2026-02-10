/**
 * Password Hashing Worker Service
 *
 * Non-blocking password hashing using worker threads to prevent
 * event loop blocking during computationally expensive bcrypt operations.
 */

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import * as os from 'os';
import { logger } from '../core/logging';
import * as bcrypt from 'bcryptjs';
import * as path from 'path';

/**
 * Worker message interface
 */
interface WorkerMessage {
    id: string;
    success: boolean;
    result?: string | boolean;
    error?: string;
    stack?: string;
}

/**
 * Hash task data interfaces
 */
interface HashTaskData {
    password: string;
    rounds: number;
}

interface CompareTaskData {
    password: string;
    hash: string;
}

/**
 * Password hashing task interfaces
 */
interface HashTask {
    id: string;
    action: 'hash';
    data: HashTaskData;
    resolve: (result: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    startTime: number;
    workerId?: number;
    retryCount?: number;
}

interface CompareTask {
    id: string;
    action: 'compare';
    data: CompareTaskData;
    resolve: (result: boolean) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    startTime: number;
    workerId?: number;
    retryCount?: number;
}

type PasswordTask = HashTask | CompareTask;

/**
 * Worker thread pool for non-blocking password operations
 */
class PasswordWorkerPool extends EventEmitter {
    private workers: Worker[] = [];
    private availableWorkers: Worker[] = [];
    private taskQueue: PasswordTask[] = [];
    private activeTasks = new Map<string, PasswordTask>();
    private nextTaskId = 0;
    private isShuttingDown = false;
    private workerHealthCheckInterval: NodeJS.Timeout | null = null;
    private lastHealthCheck = Date.now();

    constructor(private poolSize: number = Math.max(2, Math.floor(os.cpus().length / 2))) {
        super();
        this.initializePool();
        this.startHealthCheck();
        logger.info('Password worker pool initialized', {
            poolSize,
            availableCpus: os.cpus().length,
        });
    }

    /**
     * Initialize the worker thread pool
     */
    private initializePool(): void {
        // Enhanced test environment detection for worker pool
        const isTestEnvironment = this.isTestEnvironment();
        const poolSize = isTestEnvironment ? Math.max(1, Math.floor(this.poolSize / 2)) : this.poolSize;

        logger.info('Initializing worker pool', {
            originalPoolSize: this.poolSize,
            actualPoolSize: poolSize,
            isTestEnvironment
        });

        for (let i = 0; i < poolSize; i++) {
            this.createWorker();
        }
    }

    /**
     * Start periodic health checks for worker threads
     */
    private startHealthCheck(): void {
        this.workerHealthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, 10000); // Check every 10 seconds
    }

    /**
     * Perform health check on worker threads
     */
    private performHealthCheck(): void {
        const stats = this.getStats();
        this.lastHealthCheck = Date.now();

        // Log health status if there are issues
        if (stats.availableWorkers === 0 && stats.totalWorkers > 0) {
            logger.warn('All workers busy', { stats });
        }

        if (stats.queuedTasks > 5) {
            logger.warn('High task queue', { queuedTasks: stats.queuedTasks });
        }

        // Check for stuck tasks (tasks running longer than expected)
        const now = Date.now();
        for (const [taskId, task] of this.activeTasks) {
            const duration = now - task.startTime;
            if (duration > 45000) { // Tasks running longer than 45 seconds
                logger.warn('Task potentially stuck', {
                    taskId,
                    duration,
                    action: task.action
                });
            }
        }
    }

    /**
     * Create a new worker thread
     */
    private createWorker(): void {
        const workerScriptPath = path.join(__dirname, 'password-worker-thread.js');
        const worker = new Worker(workerScriptPath, {
            workerData: {},
            resourceLimits: {
                maxOldGenerationSizeMb: 512, // Prevent memory leaks
                maxYoungGenerationSizeMb: 64,
            },
        });

        worker.on('message', (message) => {
            this.handleWorkerMessage(worker, message);
        });

        worker.on('error', (error) => {
            logger.error('Password worker error', {
                error: (error as Error).message,
                stack: (error as Error).stack
            });
            this.handleWorkerError(worker, error as Error);
        });

        worker.on('exit', (code, signal) => {
            logger.warn('Password worker exited', { code, signal });
            this.handleWorkerExit(worker, code);
        });

        // Handle worker thread uncaught exceptions
        worker.on('message', (message) => {
            if (message && typeof message === 'object' && message.type === 'uncaughtException') {
                this.handleWorkerUncaughtException(worker, new Error(message.error || 'Unknown error'));
            }
        });

        worker.on('online', () => {
            logger.debug('Password worker online', { workerId: worker.threadId });
        });

        worker.on('messageerror', (error) => {
            logger.error('Password worker message error', {
                error: error.message,
                stack: error.stack
            });
        });

        this.workers.push(worker);
        this.availableWorkers.push(worker);
    }

    /**
     * Handle messages from worker threads
     */
    private handleWorkerMessage(worker: Worker, message: WorkerMessage): void {
        const { id, success, result, error } = message;
        const task = this.activeTasks.get(id);

        if (!task) {
            // NEW: Check if we're shutting down before logging unknown task
            if (!this.isShuttingDown) {
                logger.warn('Received message for unknown task', { id });
            }

            return;
        }

        // Clear timeout
        clearTimeout(task.timeout);
        this.activeTasks.delete(id);

        // Make worker available again
        if (!this.availableWorkers.includes(worker)) {
            this.availableWorkers.push(worker);
        }

        // Complete the task
        if (success) {
            if (task.action === 'hash') {
                (task as HashTask).resolve(result as string);
            } else {
                (task as CompareTask).resolve(result as boolean);
            }
        } else {
            const err = new Error(error || 'Worker task failed');
            task.reject(err);
        }

        // Process next task in queue
        this.processQueue();
    }

    /**
     * Handle worker thread errors
     */
    private handleWorkerError(worker: Worker, error: Error): void {
        logger.error('Password worker thread error', {
            error: error.message,
            stack: error.stack,
        });

        // Remove from available workers
        const availableIndex = this.availableWorkers.indexOf(worker);
        if (availableIndex !== -1) {
            this.availableWorkers.splice(availableIndex, 1);
        }

        // Fail all active tasks on this worker
        for (const [taskId, task] of this.activeTasks) {
            // Simple heuristic: assume tasks on errored workers failed
            // In production, you'd want more sophisticated task tracking
            task.reject(new Error('Worker thread error'));
            this.activeTasks.delete(taskId);
        }

        // Replace the worker
        if (!this.isShuttingDown) {
            this.replaceWorker(worker);
        }
    }

    /**
     * Handle worker thread uncaught exceptions
     */
    private handleWorkerUncaughtException(worker: Worker, error: Error): void {
        logger.error('Password worker uncaught exception', {
            error: error.message,
            stack: error.stack,
        });

        // Terminate the worker immediately
        try {
            worker.terminate();
        } catch (terminateError) {
            logger.warn('Failed to terminate worker after uncaught exception', {
                error: terminateError instanceof Error ? terminateError.message : String(terminateError),
            });
        }

        // Remove from pools
        const workerIndex = this.workers.indexOf(worker);
        if (workerIndex !== -1) {
            this.workers.splice(workerIndex, 1);
        }

        const availableIndex = this.availableWorkers.indexOf(worker);
        if (availableIndex !== -1) {
            this.availableWorkers.splice(availableIndex, 1);
        }

        // Replace the worker
        if (!this.isShuttingDown) {
            this.replaceWorker(worker);
        }
    }

    /**
     * Handle worker thread exit
     */
    private handleWorkerExit(worker: Worker, code: number): void {
        logger.info('Password worker thread exited', { code });

        // Remove from pools
        const workerIndex = this.workers.indexOf(worker);
        if (workerIndex !== -1) {
            this.workers.splice(workerIndex, 1);
        }

        const availableIndex = this.availableWorkers.indexOf(worker);
        if (availableIndex !== -1) {
            this.availableWorkers.splice(availableIndex, 1);
        }

        // Replace the worker if not shutting down
        if (!this.isShuttingDown && code !== 0) {
            this.replaceWorker(worker);
        }
    }

    /**
     * Replace a failed worker
     */
    private replaceWorker(oldWorker: Worker): void {
        logger.info('Replacing failed password worker');
        try {
            oldWorker.terminate();
        } catch (error) {
            logger.warn('Error terminating failed worker', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Create new worker after a short delay
        setTimeout(() => {
            if (!this.isShuttingDown) {
                this.createWorker();
            }
        }, 1000);
    }

    /**
     * Process the task queue
     */
    private processQueue(): void {
        if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
            return;
        }

        const worker = this.availableWorkers.shift();
        const task = this.taskQueue.shift();

        if (!worker || !task) {
            return;
        }

        // Remove from available workers temporarily
        this.activeTasks.set(task.id, task);

        // Enhanced test environment detection for timeout
        const isTestEnvironment = this.isTestEnvironment();
        const timeoutDuration = isTestEnvironment ? 10000 : 45000; // 10s for tests, 45s for production

        // Send task to worker with enhanced error handling and debug logging
        try {
            logger.debug('Sending task to worker', {
                taskId: task.id,
                action: task.action,
                workerId: worker.threadId,
                queueLength: this.taskQueue.length,
                availableWorkers: this.availableWorkers.length,
                isTestEnvironment
            });

            worker.postMessage({
                id: task.id,
                action: task.action,
                data: task.data,
            });

            // Set timeout with retry logic (10 seconds for tests, 45 seconds for production)
            task.timeout = setTimeout(() => {
                this.handleTaskTimeout(task, worker);
            }, timeoutDuration);
        } catch (error) {
            logger.error('Failed to send task to worker', {
                taskId: task.id,
                workerId: worker.threadId,
                error: error instanceof Error ? error.message : String(error),
                isTestEnvironment
            });

            // Make worker available again
            if (!this.availableWorkers.includes(worker)) {
                this.availableWorkers.push(worker);
            }

            // Reject task and process next
            task.reject(new Error('Failed to send task to worker'));
            this.processQueue();
        }
    }

    /**
     * Handle task timeout with retry logic
     */
    private async handleTaskTimeout(task: PasswordTask, worker: Worker): Promise<void> {
        const isTestEnvironment = this.isTestEnvironment();
        const duration = Date.now() - task.startTime;

        logger.warn('Password task timeout - attempting recovery', {
            taskId: task.id,
            action: task.action,
            duration,
            isTestEnvironment
        });

        // Remove from active tasks
        this.activeTasks.delete(task.id);

        // Check if worker is still responsive
        const isWorkerResponsive = await this.checkWorkerResponsiveness(worker);

        if (isWorkerResponsive) {
            // Worker is responsive, make it available again
            if (!this.availableWorkers.includes(worker)) {
                this.availableWorkers.push(worker);
            }

            // Retry the task once (only in production, skip retries in tests for faster failure)
            if (!task.retryCount && !isTestEnvironment) {
                task.retryCount = 1;
                this.taskQueue.unshift(task); // Put task back at front of queue
                logger.info('Retrying timed-out task', { taskId: task.id, isTestEnvironment });
            } else {
                // Max retries reached or in test environment, reject task
                const errorMessage = isTestEnvironment
                    ? 'Password operation timeout in test environment (no retries)'
                    : 'Password operation timeout after retries';
                task.reject(new Error(errorMessage));
            }
        } else {
            // Worker is not responsive, replace it immediately
            logger.error('Worker unresponsive, replacing immediately', {
                workerId: worker.threadId,
                isTestEnvironment
            });
            this.replaceWorker(worker);

            // Retry the task (only in production, skip retries in tests for faster failure)
            if (!task.retryCount && !isTestEnvironment) {
                task.retryCount = 1;
                this.taskQueue.unshift(task); // Put task back at front of queue
                logger.info('Retrying task with new worker', { taskId: task.id, isTestEnvironment });
            } else {
                // Max retries reached or in test environment, reject task
                const errorMessage = isTestEnvironment
                    ? 'Password operation timeout - worker unresponsive in test environment'
                    : 'Password operation timeout - worker unresponsive';
                task.reject(new Error(errorMessage));
            }
        }

        // Process next task
        this.processQueue();
    }

    /**
     * Check if worker is responsive
     */
    private async checkWorkerResponsiveness(worker: Worker): Promise<boolean> {
        const isTestEnvironment = this.isTestEnvironment();
        const responsivenessTimeout = isTestEnvironment ? 500 : 1000; // 500ms for tests, 1s for production

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, responsivenessTimeout);

            const handleMessage = (message: any) => {
                if (message && message.type === 'healthCheckResponse') {
                    clearTimeout(timeout);
                    worker.off('message', handleMessage);
                    resolve(true);
                }
            };

            worker.on('message', handleMessage);

            // Send health check
            try {
                worker.postMessage({
                    id: `health_${Date.now()}`,
                    action: 'healthCheck',
                    data: {}
                });
            } catch (error) {
                clearTimeout(timeout);
                resolve(false);
            }
        });
    }

    /**
     * Hash a password using worker threads (non-blocking)
     */
    async hashPassword(password: string, rounds: number = 12): Promise<string> {
        return new Promise((resolve, reject) => {
            const task: HashTask = {
                id: `hash_${this.nextTaskId++}_${Date.now()}`,
                action: 'hash',
                data: { password, rounds },
                resolve,
                reject,
                timeout: null as unknown as NodeJS.Timeout,
                startTime: Date.now(),
            };

            this.taskQueue.push(task);
            this.processQueue();
        });
    }

    /**
     * Compare password with hash using worker threads (non-blocking)
     */
    async comparePassword(password: string, hash: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const task: CompareTask = {
                id: `compare_${this.nextTaskId++}_${Date.now()}`,
                action: 'compare',
                data: { password, hash },
                resolve,
                reject,
                timeout: null as unknown as NodeJS.Timeout,
                startTime: Date.now(),
            };

            this.taskQueue.push(task);
            this.processQueue();
        });
    }

    /**
     * Get pool statistics
     */
    getStats(): {
        poolSize: number;
        availableWorkers: number;
        activeTasks: number;
        queuedTasks: number;
        totalWorkers: number;
    } {
        return {
            poolSize: this.poolSize,
            availableWorkers: this.availableWorkers.length,
            activeTasks: this.activeTasks.size,
            queuedTasks: this.taskQueue.length,
            totalWorkers: this.workers.length,
        };
    }

    /**
     * Health check for the worker pool
     */
    async healthCheck(): Promise<{
        healthy: boolean;
        stats: {
            poolSize: number;
            availableWorkers: number;
            activeTasks: number;
            queuedTasks: number;
            totalWorkers: number;
        };
        errors: string[];
    }> {
        const stats = this.getStats();
        const errors: string[] = [];

        // Check if we have minimum viable workers
        if (stats.availableWorkers === 0 && stats.totalWorkers === 0) {
            errors.push('No workers available');
        }

        // Check if pool is severely degraded
        if (stats.totalWorkers < Math.floor(this.poolSize / 2)) {
            errors.push(`Worker pool degraded: ${stats.totalWorkers}/${this.poolSize} workers`);
        }

        // Check for excessive queue
        if (stats.queuedTasks > 10) {
            errors.push(`Excessive task queue: ${stats.queuedTasks} tasks waiting`);
        }

        return {
            healthy: errors.length === 0,
            stats,
            errors,
        };
    }

    /**
     * Shutdown the worker pool gracefully
     */
    async shutdown(): Promise<void> {
        logger.info('Shutting down password worker pool');
        this.isShuttingDown = true;

        // Clear health check interval
        if (this.workerHealthCheckInterval) {
            clearInterval(this.workerHealthCheckInterval);
            this.workerHealthCheckInterval = null;
        }

        // Reject all pending tasks
        for (const task of this.taskQueue) {
            task.reject(new Error('Worker pool shutting down'));
        }
        this.taskQueue.length = 0;

        // Clear active tasks
        for (const [taskId, task] of this.activeTasks) {
            task.reject(new Error('Worker pool shutting down'));
        }
        this.activeTasks.clear();

        // Terminate all workers
        const terminationPromises = this.workers.map(worker => {
            return new Promise<void>((resolve) => {
                worker.once('exit', () => resolve());
                worker.terminate();
            });
        });

        await Promise.all(terminationPromises);
        logger.info('Password worker pool shutdown complete');
    }

    /**
     * Check if we're running in a test environment
     */
    private isTestEnvironment(): boolean {
        return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
    }

    /**
     * Cleanup method for test environments
     * Gracefully shuts down the pool and removes process handlers
     */
    async cleanupForTests(): Promise<void> {
        try {
            // Set shutdown flag immediately
            this.isShuttingDown = true;

            // Clear health check interval
            if (this.workerHealthCheckInterval) {
                clearInterval(this.workerHealthCheckInterval);
                this.workerHealthCheckInterval = null;
            }

            // Reject all pending tasks
            for (const task of this.taskQueue) {
                try {
                    task.reject(new Error('Worker pool shutting down during test cleanup'));
                } catch (error) {
                    logger.warn('Warning: Failed to reject task during cleanup:', error);
                }
            }
            this.taskQueue.length = 0;

            // Clear active tasks
            for (const [taskId, task] of this.activeTasks) {
                try {
                    task.reject(new Error('Worker pool shutting down during test cleanup'));
                    clearTimeout(task.timeout);
                } catch (error) {
                    logger.warn('Warning: Failed to clear active task during cleanup:', error);
                }
            }
            this.activeTasks.clear();

            // Terminate all workers with simple, reliable logic
            console.info(`🔧 Terminating ${this.workers.length} workers...`);
            const terminationPromises = this.workers.map(worker => {
                return new Promise<void>((resolve) => {
                    // Set a hard timeout to ensure we don't get stuck
                    const timeout = setTimeout(() => {
                        worker.removeAllListeners();
                        resolve();
                    }, 1000); // 1 second timeout

                    // Listen for worker exit
                    worker.once('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });

                    // Try to terminate the worker
                    try {
                        worker.terminate().then(() => {
                            clearTimeout(timeout);
                            resolve();
                        }).catch(() => {
                            clearTimeout(timeout);
                            resolve();
                        });
                    } catch (error) {
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            });

            await Promise.all(terminationPromises);

            // Clear worker arrays
            this.workers.length = 0;
            this.availableWorkers.length = 0;

            // Remove process handlers to prevent interference with other tests
            try {
                process.removeListener('SIGTERM', async () => {
                    await this.shutdown();
                });
                process.removeListener('SIGINT', async () => {
                    await this.shutdown();
                });
            } catch (error) {
                logger.warn('Warning: Failed to remove process handlers:', error);
            }

        } catch (error) {
            logger.warn('Warning: Password worker pool cleanup failed:', error);
        }
    }
}

// Global singleton instance with lazy initialization
let _passwordWorkerPool: PasswordWorkerPool | null = null;
let _testWorkerPool: PasswordWorkerPool | null = null;

function getPasswordWorkerPool(): PasswordWorkerPool {
    // In test environment, use test-specific pool to avoid state leakage
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
        if (!_testWorkerPool) {
            _testWorkerPool = new PasswordWorkerPool();
        }
        return _testWorkerPool;
    }

    if (!_passwordWorkerPool) {
        _passwordWorkerPool = new PasswordWorkerPool();
    }
    return _passwordWorkerPool;
}

// Graceful shutdown handling - only register if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
    process.on('SIGTERM', async () => {
        if (_passwordWorkerPool) {
            await _passwordWorkerPool.shutdown();
        }
    });

    process.on('SIGINT', async () => {
        if (_passwordWorkerPool) {
            await _passwordWorkerPool.shutdown();
        }
    });
}

// Export singleton instance with lazy initialization
export const passwordWorkerPool = {
    get hashPassword() {
        return getPasswordWorkerPool().hashPassword.bind(getPasswordWorkerPool());
    },
    get comparePassword() {
        return getPasswordWorkerPool().comparePassword.bind(getPasswordWorkerPool());
    },
    get shutdown() {
        return getPasswordWorkerPool().shutdown.bind(getPasswordWorkerPool());
    },
    get cleanupForTests() {
        return getPasswordWorkerPool().cleanupForTests.bind(getPasswordWorkerPool());
    },
    get getStats() {
        return getPasswordWorkerPool().getStats.bind(getPasswordWorkerPool());
    },
    get healthCheck() {
        return getPasswordWorkerPool().healthCheck.bind(getPasswordWorkerPool());
    }
} as PasswordWorkerPool;

// Export convenience functions with lazy initialization
export const hashPassword = (password: string, rounds: number = 12): Promise<string> => {
    return getPasswordWorkerPool().hashPassword(password, rounds);
};

export const comparePassword = (password: string, hash: string): Promise<boolean> => {
    return getPasswordWorkerPool().comparePassword(password, hash);
};

export default passwordWorkerPool;
