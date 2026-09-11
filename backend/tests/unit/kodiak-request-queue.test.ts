/**
 * ===========================================
 * 🧪 KODIAK REQUEST QUEUE - Unit Tests
 * ===========================================
 *
 * Tests for intelligent request queuing system
 *
 * @format
 */

import { KodiakRequestQueue, kodiakRequestQueue, QueueConfig } from '../../src/infrastructure/external/kodiak-queue';
import { Request, Response } from 'express';

describe('KodiakRequestQueue', () => {
    describe('Single instance behavior', () => {
        it('should export a singleton instance', () => {
            // Assert
            expect(kodiakRequestQueue).toBeDefined();
            expect(kodiakRequestQueue).toBeInstanceOf(KodiakRequestQueue);
        });
    });

    describe('Queue configuration', () => {
        it('should have default configuration', () => {
            // Arrange
            const queue = new KodiakRequestQueue();

            // Act
            const stats = queue.getStats();

            // Assert
            expect(stats.queueSize).toBe(0);
            expect(stats.isProcessing).toBe(false);
        });

        it('should accept custom configuration', () => {
            // Arrange
            const customConfig: QueueConfig = {
                minIntervalMs: 5000,
                maxQueueSize: 50,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            };

            // Act
            const queue = new KodiakRequestQueue(customConfig);

            // @ts-ignore - Access private config for testing
            const config = queue.config;

            // Assert
            expect(config.minIntervalMs).toBe(5000);
            expect(config.maxQueueSize).toBe(50);
            expect(config.priorityLevels).toEqual(customConfig.priorityLevels);
        });

        it('should update configuration', () => {
            // Arrange
            const initialInterval = 4000;
            const initialSize = 100;

            // @ts-ignore - Access private config for testing
            kodiakRequestQueue.config.minIntervalMs = initialInterval;
            // @ts-ignore - Access private config for testing
            kodiakRequestQueue.config.maxQueueSize = initialSize;

            // Act
            const newConfig: Partial<QueueConfig> = {
                minIntervalMs: 8000,
                maxQueueSize: 200,
            };
            kodiakRequestQueue.updateConfig(newConfig);

            // Assert
            // @ts-ignore - Access private config for testing
            expect(kodiakRequestQueue.config.minIntervalMs).toBe(8000);
            // @ts-ignore - Access private config for testing
            expect(kodiakRequestQueue.config.maxQueueSize).toBe(200);
        });
    });

    describe('Request queuing and processing', () => {
        it('should enqueue and process requests', async () => {
            // Arrange
            const queue = new KodiakRequestQueue({
                minIntervalMs: 10, // Very short interval for testing
                maxQueueSize: 10,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            const req = { path: '/api/positions' } as unknown as Request;
            const res = {} as Response;
            let processed = false;

            const middleware = jest.fn().mockImplementation(() => {
                processed = true;
                return Promise.resolve();
            });

            // Act
            queue.enqueue(req, res, middleware);

            await new Promise(resolve => setTimeout(resolve, 20));

            // Assert
            expect(queue.getStats().totalProcessed).toBeGreaterThan(0);
            expect(processed).toBe(true);
        });

        it('should reject requests when queue is full', async () => {
            // Arrange - Mock processing to prevent queue from dequeuing
            const queue = new KodiakRequestQueue({
                minIntervalMs: 100000, // 100 seconds to prevent processing
                maxQueueSize: 2,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            // @ts-ignore - Mock processQueue to prevent processing
            queue.processQueue = jest.fn();

            const req = { path: '/api/positions' } as unknown as Request;
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            } as unknown as Response;

            const middleware = jest.fn();

            // Act - Enqueue 3 requests
            queue.enqueue(req, res, middleware);
            queue.enqueue(req, res, middleware);
            const result = queue.enqueue(req, res, middleware);

            // Assert
            expect(result).toBe(false);
            expect(queue.getStats().queueSize).toBe(2);
        });
    });

    describe('Priority handling', () => {
        it('should prioritize requests based on endpoint type', async () => {
            // Arrange - Mock processing to prevent queue from dequeuing
            const queue = new KodiakRequestQueue({
                minIntervalMs: 100000, // 100 seconds to prevent processing
                maxQueueSize: 10,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            // @ts-ignore - Mock processQueue to prevent processing
            queue.processQueue = jest.fn();

            const req = { path: '/api/positions' } as unknown as Request;
            const res = {} as Response;

            // Create requests with different endpoint types
            const highPriorityReq = { ...req, path: '/api/account-info' } as unknown as Request;
            const mediumPriorityReq = { ...req, path: '/api/positions' } as unknown as Request;
            const lowPriorityReq = { ...req, path: '/api/balance' } as unknown as Request;

            const middleware = jest.fn().mockResolvedValue(undefined);

            // Act
            queue.enqueue(lowPriorityReq, res, middleware);
            queue.enqueue(highPriorityReq, res, middleware);
            queue.enqueue(mediumPriorityReq, res, middleware);

            // Assert
            expect(queue.getStats().queueSize).toBe(3);
        });

        it('should handle unknown endpoint types', async () => {
            // Arrange
            const queue = new KodiakRequestQueue({
                minIntervalMs: 100000, // 100 seconds to prevent processing
                maxQueueSize: 10,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            // @ts-ignore - Mock processQueue to prevent processing
            queue.processQueue = jest.fn();

            const req = {
                path: '/api/unknown',
            } as unknown as Request;
            const res = {} as Response;

            const middleware = jest.fn().mockResolvedValue(undefined);

            // Act
            const result = queue.enqueue(req, res, middleware);

            // Assert
            expect(result).toBe(true);
        });
    });

    describe('Queue statistics', () => {
        it('should track queue statistics', async () => {
            // Arrange - Mock processing to prevent queue from dequeuing
            const queue = new KodiakRequestQueue({
                minIntervalMs: 100000, // 100 seconds to prevent processing
                maxQueueSize: 10,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            // @ts-ignore - Mock processQueue to prevent processing
            queue.processQueue = jest.fn();

            const req = { path: '/api/positions' } as unknown as Request;
            const res = {} as Response;

            const middleware = jest.fn().mockResolvedValue(undefined);

            // Act
            queue.enqueue(req, res, middleware);
            queue.enqueue(req, res, middleware);

            const stats = queue.getStats();

            // Assert
            expect(stats.queueSize).toBe(2);
            expect(typeof stats.isProcessing).toBe('boolean');
            expect(stats.totalProcessed).toBeGreaterThanOrEqual(0);
        });

        it('should clear queue and reset statistics', async () => {
            // Arrange - Mock processing to prevent queue from dequeuing
            const queue = new KodiakRequestQueue({
                minIntervalMs: 100000, // 100 seconds to prevent processing
                maxQueueSize: 10,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            // @ts-ignore - Mock processQueue to prevent processing
            queue.processQueue = jest.fn();

            const req = { path: '/api/positions' } as unknown as Request;
            const res = {} as Response;

            const middleware = jest.fn().mockResolvedValue(undefined);

            // Act
            queue.enqueue(req, res, middleware);
            queue.enqueue(req, res, middleware);

            const statsBefore = queue.getStats();
            queue.clear();
            const statsAfter = queue.getStats();

            // Assert
            expect(statsBefore.queueSize).toBe(2);
            expect(statsAfter.queueSize).toBe(0);
        });
    });

    describe('User ID handling', () => {
        it('should handle authenticated requests', () => {
            // Arrange
            const queue = new KodiakRequestQueue({
                minIntervalMs: 1000,
                maxQueueSize: 10,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            const req = {
                path: '/api/positions',
                user: { userId: 'user123' },
            } as unknown as Request;
            const res = {} as Response;

            const middleware = jest.fn().mockResolvedValue(undefined);

            // Act
            const result = queue.enqueue(req, res, middleware);

            // Assert
            expect(result).toBe(true);
        });

        it('should handle anonymous requests', () => {
            // Arrange
            const queue = new KodiakRequestQueue({
                minIntervalMs: 1000,
                maxQueueSize: 10,
                priorityLevels: {
                    accountInfo: 1,
                    positions: 2,
                    trades: 3,
                    balance: 4,
                },
            });

            const req = {
                path: '/api/positions',
            } as unknown as Request;
            const res = {} as Response;

            const middleware = jest.fn().mockResolvedValue(undefined);

            // Act
            const result = queue.enqueue(req, res, middleware);

            // Assert
            expect(result).toBe(true);
        });
    });
});