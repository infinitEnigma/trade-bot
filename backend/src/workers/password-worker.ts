/**
 * Password Hashing Worker Service
 *
 * Non-blocking password hashing using worker threads to prevent
 * event loop blocking during computationally expensive bcrypt operations.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import logger from '../core/logging/logger.service';

// Worker thread script for password hashing
const WORKER_SCRIPT = `
const { parentPort, workerData } = require('worker_threads');
const bcrypt = require('bcryptjs');

parentPort.on('message', async (message) => {
  const { id, action, data } = message;

  try {
    switch (action) {
      case 'hash': {
        const { password, rounds } = data;
        const hash = await bcrypt.hash(password, rounds);
        parentPort.postMessage({ id, success: true, result: hash });
        break;
      }

      case 'compare': {
        const { password: comparePassword, hash } = data;
        const isValid = await bcrypt.compare(comparePassword, hash);
        parentPort.postMessage({ id, success: true, result: isValid });
        break;
      }

      default:
        parentPort.postMessage({
          id,
          success: false,
          error: 'Unknown action: ' + action
        });
    }
  } catch (error) {
    parentPort.postMessage({
      id,
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});
`;

/**
 * Password hashing task interface
 */
interface HashTask {
    id: string;
    action: 'hash' | 'compare';
    data: any;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

/**
 * Worker thread pool for non-blocking password operations
 */
class PasswordWorkerPool extends EventEmitter {
    private workers: Worker[] = [];
    private availableWorkers: Worker[] = [];
    private taskQueue: HashTask[] = [];
    private activeTasks = new Map<string, HashTask>();
    private nextTaskId = 0;
    private isShuttingDown = false;

    constructor(private poolSize: number = Math.max(2, Math.floor(os.cpus().length / 2))) {
        super();
        this.initializePool();
        logger.info('Password worker pool initialized', {
            poolSize,
            availableCpus: os.cpus().length,
        });
    }

    /**
     * Initialize the worker thread pool
     */
    private initializePool(): void {
        for (let i = 0; i < this.poolSize; i++) {
            this.createWorker();
        }
    }

    /**
     * Create a new worker thread
     */
    private createWorker(): void {
        const worker = new Worker(WORKER_SCRIPT, {
            eval: true,
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
            logger.error('Password worker error', { error: (error as Error).message });
            this.handleWorkerError(worker, error as Error);
        });

        worker.on('exit', (code) => {
            logger.warn('Password worker exited', { code });
            this.handleWorkerExit(worker, code);
        });

        this.workers.push(worker);
        this.availableWorkers.push(worker);
    }

    /**
     * Handle messages from worker threads
     */
    private handleWorkerMessage(worker: Worker, message: any): void {
        const { id, success, result, error } = message;
        const task = this.activeTasks.get(id);

        if (!task) {
            logger.warn('Received message for unknown task', { id });
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
            task.resolve(result);
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

        const worker = this.availableWorkers.shift()!;
        const task = this.taskQueue.shift()!;

        // Remove from available workers temporarily
        this.activeTasks.set(task.id, task);

        // Send task to worker
        worker.postMessage({
            id: task.id,
            action: task.action,
            data: task.data,
        });

        // Set timeout (30 seconds for password operations)
        task.timeout = setTimeout(() => {
            logger.warn('Password task timeout', { taskId: task.id });
            this.activeTasks.delete(task.id);
            task.reject(new Error('Password operation timeout'));

            // Make worker available again
            if (!this.availableWorkers.includes(worker)) {
                this.availableWorkers.push(worker);
            }

            // Process next task
            this.processQueue();
        }, 30000);
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
                timeout: null as any,
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
            const task: HashTask = {
                id: `compare_${this.nextTaskId++}_${Date.now()}`,
                action: 'compare',
                data: { password, hash },
                resolve,
                reject,
                timeout: null as any,
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

        // Reject all pending tasks
        for (const task of this.taskQueue) {
            task.reject(new Error('Worker pool shutting down'));
        }
        this.taskQueue.length = 0;

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
}

// Global singleton instance
export const passwordWorkerPool = new PasswordWorkerPool();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
    await passwordWorkerPool.shutdown();
});

process.on('SIGINT', async () => {
    await passwordWorkerPool.shutdown();
});

// Export convenience functions
export const hashPassword = (password: string, rounds: number = 12): Promise<string> => {
    return passwordWorkerPool.hashPassword(password, rounds);
};

export const comparePassword = (password: string, hash: string): Promise<boolean> => {
    return passwordWorkerPool.comparePassword(password, hash);
};

export default passwordWorkerPool;
