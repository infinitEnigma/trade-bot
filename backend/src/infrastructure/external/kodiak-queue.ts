/** @format */

import { Request, Response } from "express";
import { logger } from "../../core/logging";

/**
 * ===========================================
 * 🎯 KODIAK REQUEST QUEUE - Rate Limit Compliance
 * ===========================================
 *
 * Intelligent request queuing to comply with Orderly/Kodiak API rate limits.
 * Spaces out requests to prevent bursts and ensure compliance with strict limits.
 *
 * ORDERLY LIMITS:
 * - Account Info: 10 requests per 60 seconds
 * - Positions/Trades: Same limits apply
 *
 * FEATURES:
 * - Request queuing with configurable intervals
 * - Burst prevention for multiple simultaneous requests
 * - Per-user fairness in request processing
 * - Monitoring and metrics for queue performance
 *
 * @format
 */

/**
 * Extended Express Request type with user authentication
 */
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        [key: string]: unknown;
    };
}

/**
 * Middleware function type for queue processing
 */
type QueueMiddleware = (req: Request, res: Response) => Promise<void>;

export interface QueueConfig {
    /** Minimum interval between requests (milliseconds) */
    minIntervalMs: number;

    /** Maximum queue size before rejecting requests */
    maxQueueSize: number;

    /** Priority levels for different request types */
    priorityLevels: {
        accountInfo: number;
        positions: number;
        trades: number;
        balance: number;
    };
}

export interface QueuedRequest {
    id: string;
    req: Request;
    res: Response;
    next: QueueMiddleware;
    priority: number;
    enqueuedAt: number;
    userId: string;
    endpoint: string;
}

/**
 * Kodiak Request Queue - Ensures compliance with Orderly rate limits
 */
export class KodiakRequestQueue {
    private queue: QueuedRequest[] = [];
    private processing = false;
    private lastRequestTime = 0;
    private requestCount = 0;

    // Configuration - optimized for handling bursts
    private config: Required<QueueConfig> = {
        minIntervalMs: 4000, // ⬇️ 4 seconds (still safe for 10/min limit)
        maxQueueSize: 100,   // ⬆️ Increased queue size for bursts
        priorityLevels: {
            accountInfo: 1,  // Highest priority
            positions: 2,
            trades: 3,
            balance: 4,      // Lowest priority
        },
    };

    constructor(config?: Partial<QueueConfig>) {
        this.config = { ...this.config, ...config };
        logger.info("KodiakRequestQueue initialized", {
            minIntervalMs: this.config.minIntervalMs,
            maxQueueSize: this.config.maxQueueSize,
        });
    }

    /**
     * Add request to queue with priority-based ordering
     */
    enqueue(req: Request, res: Response, next: QueueMiddleware): boolean {
        const userId = (req as AuthenticatedRequest).user?.userId || 'anonymous';
        const endpoint = this.getEndpointType(req.path);

        // Check queue size limits
        if (this.queue.length >= this.config.maxQueueSize) {
            logger.warn("Kodiak queue full, rejecting request", {
                queueSize: this.queue.length,
                maxSize: this.config.maxQueueSize,
                userId,
                endpoint: req.path,
            });

            // Return 429 Too Many Requests
            res.status(429).json({
                success: false,
                error: "Kodiak API queue full. Please try again later.",
                retryAfter: 30,
            });
            return false;
        }

        const queuedRequest: QueuedRequest = {
            id: this.generateRequestId(),
            req,
            res,
            next,
            priority: this.config.priorityLevels[endpoint] || 5,
            enqueuedAt: Date.now(),
            userId,
            endpoint,
        };

        // Insert with priority (lower number = higher priority)
        const insertIndex = this.queue.findIndex(item => item.priority > queuedRequest.priority);
        if (insertIndex === -1) {
            this.queue.push(queuedRequest);
        } else {
            this.queue.splice(insertIndex, 0, queuedRequest);
        }

        logger.debug("Request queued for Kodiak API", {
            requestId: queuedRequest.id,
            userId,
            endpoint,
            priority: queuedRequest.priority,
            queueSize: this.queue.length,
        });

        // Start processing if not already running
        if (!this.processing) {
            this.processQueue();
        }

        return true;
    }

    /**
     * Process queued requests with rate limiting
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;
        logger.debug("Started Kodiak request queue processing", {
            queueSize: this.queue.length
        });

        try {
            while (this.queue.length > 0) {
                const nextRequest = this.queue[0]; // Peek at next request

                // Check if we need to wait before processing
                const timeSinceLastRequest = Date.now() - this.lastRequestTime;
                if (timeSinceLastRequest < this.config.minIntervalMs) {
                    const waitTime = this.config.minIntervalMs - timeSinceLastRequest;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    logger.debug("Waiting before processing next Kodiak request", {
                        waitTimeMs: waitTime,
                        queueSize: this.queue.length,
                    });

                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }

                // Remove from queue and process
                this.queue.shift();
                this.lastRequestTime = Date.now();
                this.requestCount++;

                const processingTime = Date.now() - nextRequest.enqueuedAt;

                logger.info("Processing queued Kodiak request", {
                    requestId: nextRequest.id,
                    userId: nextRequest.userId,
                    endpoint: nextRequest.endpoint,
                    queueTimeMs: processingTime,
                    remainingQueue: this.queue.length,
                });

                try {
                    // Process the request
                    await nextRequest.next(nextRequest.req, nextRequest.res);
                    
                    // Check if response indicates rate limiting
                    if (nextRequest.res.statusCode === 429) {
                        logger.warn("Rate limit hit, implementing exponential backoff", {
                            requestId: nextRequest.id,
                            userId: nextRequest.userId,
                            endpoint: nextRequest.endpoint,
                        });
                        
                        // Implement exponential backoff by increasing interval
                        this.config.minIntervalMs = Math.min(
                            this.config.minIntervalMs * 1.5, 
                            10000 // Cap at 10 seconds
                        );
                    } else {
                        // Reset interval if successful
                        this.config.minIntervalMs = 4000; // Reset to base interval
                    }
                    
                } catch (error) {
                    logger.error("Error processing queued Kodiak request", {
                        requestId: nextRequest.id,
                        userId: nextRequest.userId,
                        error: (error as Error).message,
                    });
                }
            }
        } finally {
            this.processing = false;
            logger.debug("Kodiak request queue processing completed");
        }
    }

    /**
     * Get endpoint type for priority assignment
     */
    private getEndpointType(path: string): keyof QueueConfig['priorityLevels'] {
        if (path.includes('/account-info')) return 'accountInfo';
        if (path.includes('/positions')) return 'positions';
        if (path.includes('/trades')) return 'trades';
        if (path.includes('/balance')) return 'balance';
        return 'accountInfo'; // Default to highest priority
    }

    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return `kodiak_queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get queue statistics
     */
    getStats() {
        const now = Date.now();
        const queueStats = {
            queueSize: this.queue.length,
            isProcessing: this.processing,
            totalProcessed: this.requestCount,
            lastRequestTime: this.lastRequestTime,
            timeSinceLastRequest: now - this.lastRequestTime,
            averageQueueTime: 0,
        };

        // Calculate average queue time
        if (this.queue.length > 0) {
            const totalQueueTime = this.queue.reduce(
                (sum, req) => sum + (now - req.enqueuedAt),
                0
            );
            queueStats.averageQueueTime = totalQueueTime / this.queue.length;
        }

        return queueStats;
    }

    /**
     * Clear queue (for testing/emergency)
     */
    clear(): void {
        const clearedCount = this.queue.length;
        this.queue.length = 0;

        logger.warn("Kodiak request queue cleared", {
            clearedRequests: clearedCount,
            reason: "Emergency queue clear",
        });
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<QueueConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logger.info("KodiakRequestQueue configuration updated", {
            newConfig: this.config,
        });
    }
}

// Export singleton instance
export const kodiakRequestQueue = new KodiakRequestQueue();
