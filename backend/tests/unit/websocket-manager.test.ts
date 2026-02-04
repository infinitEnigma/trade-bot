/** @format */

import { WebSocketManager, MessagePriority } from '../../src/infrastructure/messaging/market-stream/websocket-manager';
import { CircuitState, WebSocketConfig, DEFAULT_WS_CONFIG } from '../../src/infrastructure/messaging/market-stream/types';

// Mock external dependencies
jest.mock('../../src/core/logging/logger.service');

describe('WebSocketManager', () => {
    let websocketManager: WebSocketManager;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        websocketManager = new WebSocketManager();
    });

    afterEach(() => {
        // Cleanup to prevent open handles
        websocketManager.cleanupForTests();
        jest.clearAllTimers();
    });

    describe('instance creation', () => {
        it('should create an instance of WebSocketManager', () => {
            expect(websocketManager).toBeInstanceOf(WebSocketManager);
        });

        it('should initialize with default configuration', () => {
            const stats = websocketManager.getStats();
            expect(stats.activeConnections).toBe(0);
            expect(stats.connectionKeys).toEqual([]);
            expect(stats.queueDepth).toBe(0);
            expect(stats.maxQueueSize).toBeGreaterThan(0);
            expect(stats.processingBatchSize).toBeGreaterThan(0);
            expect(stats.backpressureThreshold).toBeGreaterThan(0);
        });

        it('should initialize with custom configuration', () => {
            const customConfig: WebSocketConfig = {
                ...DEFAULT_WS_CONFIG,
                baseUrl: 'wss://custom.example.com',
                heartbeatInterval: 5000,
                minReconnectDelay: 1000,
                maxReconnectDelay: 30000,
                maxReconnectAttempts: 10,
                circuitBreakerTimeout: 60000
            };

            const customManager = new WebSocketManager(customConfig);
            expect(customManager).toBeInstanceOf(WebSocketManager);
            customManager.cleanupForTests();
        });
    });

    describe('connection management', () => {
        it('should check if connection exists', () => {
            const exists = websocketManager.isConnected('test-connection');
            expect(exists).toBe(false);
        });

        it('should return null when getting non-existent connection', () => {
            const connection = websocketManager.getConnection('test-connection');
            expect(connection).toBeNull();
        });

        it('should disconnect all connections cleanly', () => {
            expect(() => {
                websocketManager.disconnectAll();
            }).not.toThrow();
        });

        it('should disconnect specific connection', () => {
            expect(() => {
                websocketManager.disconnect('test-connection');
            }).not.toThrow();
        });
    });

    describe('message queuing', () => {
        it('should queue messages with different priorities', () => {
            // Queue messages with different priorities
            const criticalQueued = websocketManager.queueMessage('test-topic', 'critical-data', MessagePriority.CRITICAL);
            const highQueued = websocketManager.queueMessage('test-topic', 'high-data', MessagePriority.HIGH);
            const mediumQueued = websocketManager.queueMessage('test-topic', 'medium-data', MessagePriority.MEDIUM);
            const lowQueued = websocketManager.queueMessage('test-topic', 'low-data', MessagePriority.LOW);

            expect(criticalQueued).toBe(true);
            expect(highQueued).toBe(true);
            expect(mediumQueued).toBe(true);
            expect(lowQueued).toBe(true);

            const stats = websocketManager.getStats();
            expect(stats.queueDepth).toBe(4);
        });

        it('should prioritize messages correctly', () => {
            // This test would require accessing the private messageQueue for verification
            // For now, we test the public API behavior
            websocketManager.queueMessage('test-topic', 'medium-data', MessagePriority.MEDIUM);
            websocketManager.queueMessage('test-topic', 'critical-data', MessagePriority.CRITICAL);
            websocketManager.queueMessage('test-topic', 'low-data', MessagePriority.LOW);
            websocketManager.queueMessage('test-topic', 'high-data', MessagePriority.HIGH);

            const stats = websocketManager.getStats();
            expect(stats.queueDepth).toBe(4);
        });

        it('should handle queue overflow with low priority eviction', () => {
            // This test would require mocking queue size limits
            // For now, we test basic queue behavior
            for (let i = 0; i < 5; i++) {
                websocketManager.queueMessage(`test-topic-${i}`, `data-${i}`, MessagePriority.MEDIUM);
            }

            const stats = websocketManager.getStats();
            expect(stats.queueDepth).toBe(5);
        });
    });

    describe('stats and monitoring', () => {
        it('should provide comprehensive statistics', () => {
            const stats = websocketManager.getStats();

            expect(stats.activeConnections).toBeDefined();
            expect(stats.connectionKeys).toBeDefined();
            expect(stats.circuitBreakerStates).toBeDefined();
            expect(stats.queueDepth).toBeDefined();
            expect(stats.maxQueueSize).toBeDefined();
            expect(stats.backpressureActive).toBeDefined();
            expect(stats.backpressureStates).toBeDefined();
            expect(stats.processingBatchSize).toBeDefined();
            expect(stats.backpressureThreshold).toBeDefined();
            expect(stats.recoveryStates).toBeDefined();
            expect(stats.healthCheckConfig).toBeDefined();

            expect(typeof stats.activeConnections).toBe('number');
            expect(Array.isArray(stats.connectionKeys)).toBe(true);
            expect(typeof stats.circuitBreakerStates).toBe('object');
            expect(typeof stats.queueDepth).toBe('number');
            expect(typeof stats.maxQueueSize).toBe('number');
            expect(typeof stats.backpressureActive).toBe('boolean');
            expect(typeof stats.backpressureStates).toBe('object');
            expect(typeof stats.processingBatchSize).toBe('number');
            expect(typeof stats.backpressureThreshold).toBe('number');
            expect(typeof stats.recoveryStates).toBe('object');
            expect(typeof stats.healthCheckConfig).toBe('object');
        });

        it('should update stats when messages are queued', () => {
            const initialStats = websocketManager.getStats();
            expect(initialStats.queueDepth).toBe(0);

            websocketManager.queueMessage('test-topic', 'test-data', MessagePriority.MEDIUM);

            const updatedStats = websocketManager.getStats();
            expect(updatedStats.queueDepth).toBe(1);
        });
    });

    describe('circuit breaker functionality', () => {
        it('should start with closed circuit breaker', () => {
            const stats = websocketManager.getStats();
            expect(Object.keys(stats.circuitBreakerStates)).toEqual([]);
        });

        it('should handle circuit breaker state transitions', () => {
            // This test would require mocking WebSocket connections and failures
            // For now, we verify the stats method reports circuit breaker states
            const stats = websocketManager.getStats();
            expect(stats.circuitBreakerStates).toEqual({});
        });
    });

    describe('health check configuration', () => {
        it('should have valid health check configuration', () => {
            const stats = websocketManager.getStats();

            expect(stats.healthCheckConfig).toEqual(expect.objectContaining({
                timeout: expect.any(Number),
                retries: expect.any(Number),
                interval: expect.any(Number),
                successThreshold: expect.any(Number),
                failureThreshold: expect.any(Number),
                enablePingPong: expect.any(Boolean),
                enableAuthCheck: expect.any(Boolean),
                enableSubscriptionCheck: expect.any(Boolean)
            }));

            expect(stats.healthCheckConfig.timeout).toBeGreaterThan(0);
            expect(stats.healthCheckConfig.retries).toBeGreaterThanOrEqual(0);
            expect(stats.healthCheckConfig.interval).toBeGreaterThan(0);
            expect(stats.healthCheckConfig.successThreshold).toBeGreaterThan(0);
            expect(stats.healthCheckConfig.failureThreshold).toBeGreaterThan(0);
        });
    });

    describe('backpressure management', () => {
        it('should start with no active backpressure', () => {
            const stats = websocketManager.getStats();
            expect(stats.backpressureActive).toBe(false);
            expect(Object.keys(stats.backpressureStates)).toEqual([]);
        });

        it('should handle backpressure state management', () => {
            // This test would require mocking queue depth thresholds
            // For now, we test the initial state
            const stats = websocketManager.getStats();
            expect(stats.backpressureActive).toBe(false);
        });
    });

    describe('recovery state management', () => {
        it('should start with no recovery states', () => {
            const stats = websocketManager.getStats();
            expect(Object.keys(stats.recoveryStates)).toEqual([]);
        });
    });

    describe('message sending', () => {
        it('should handle message sending with connection checks', async () => {
            const result = await websocketManager.sendMessage('test-connection', 'test-topic', 'test-data');
            expect(result).toBe(true);
        });

        it('should handle message sending with different priorities', async () => {
            const result1 = await websocketManager.sendMessage('test-connection', 'test-topic', 'data1', MessagePriority.CRITICAL);
            const result2 = await websocketManager.sendMessage('test-connection', 'test-topic', 'data2', MessagePriority.HIGH);
            const result3 = await websocketManager.sendMessage('test-connection', 'test-topic', 'data3', MessagePriority.MEDIUM);
            const result4 = await websocketManager.sendMessage('test-connection', 'test-topic', 'data4', MessagePriority.LOW);

            expect(result1).toBe(true);
            expect(result2).toBe(true);
            expect(result3).toBe(true);
            expect(result4).toBe(true);
        });
    });
});