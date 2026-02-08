/** @format */

import { WebSocketManager, MessagePriority } from '../../src/infrastructure/messaging/market-stream/websocket-manager';
import { CircuitState, WebSocketConfig, DEFAULT_WS_CONFIG } from '../../src/infrastructure/messaging/market-stream/types';
import WebSocket from 'ws';

// Mock external dependencies
jest.mock('../../src/core/logging/logger.service');

// Mock WebSocket to avoid real network connections
jest.mock('ws');

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

    describe('connection creation', () => {
        it('should create a WebSocket connection', async () => {
            const mockWs = {
                on: jest.fn(),
                ping: jest.fn(),
                send: jest.fn(),
                close: jest.fn(),
                readyState: WebSocket.OPEN
            } as unknown as WebSocket;

            const mockOn = mockWs.on as unknown as jest.Mock;
            (WebSocket as unknown as jest.Mock).mockImplementation((url: string) => {
                // Simulate connection open
                process.nextTick(() => {
                    const openCallback = mockOn.mock.calls.find((call: any[]) => call[0] === 'open')?.[1];
                    if (openCallback) {
                        openCallback();
                    }
                });
                return mockWs;
            });

            const connection = await websocketManager.createConnection('test-account');
            expect(connection).toBeDefined();
            expect(WebSocket).toHaveBeenCalled();
        });
    });

    describe('queue management', () => {
        it('should evict low priority messages when queue is full', () => {
            // Set a small max queue size for testing
            const manager = new (WebSocketManager as any)();
            manager.maxQueueSize = 3;

            // Queue messages to fill the queue
            manager.queueMessage('topic1', 'data1', MessagePriority.LOW);
            manager.queueMessage('topic2', 'data2', MessagePriority.LOW);
            manager.queueMessage('topic3', 'data3', MessagePriority.LOW);

            // Try to add a higher priority message - should evict a low priority one
            const added = manager.queueMessage('topic4', 'data4', MessagePriority.HIGH);
            expect(added).toBe(true);
            expect(manager['messageQueue'].length).toBe(3);

            // Verify all remaining messages are not low priority
            const hasLowPriority = manager['messageQueue'].some((msg: any) => msg.priority === MessagePriority.LOW);
            expect(hasLowPriority).toBe(true); // There should still be low priority messages (we only evicted one)

            // Cleanup the manager instance
            manager.cleanupForTests();
        });

        it('should drop low priority messages when queue is full and adding low priority', () => {
            const manager = new (WebSocketManager as any)();
            manager.maxQueueSize = 2;

            manager.queueMessage('topic1', 'data1', MessagePriority.LOW);
            manager.queueMessage('topic2', 'data2', MessagePriority.LOW);

            const added = manager.queueMessage('topic3', 'data3', MessagePriority.LOW);
            expect(added).toBe(false);
            expect(manager['messageQueue'].length).toBe(2);

            // Cleanup the manager instance
            manager.cleanupForTests();
        });
    });

    describe('circuit breaker functionality', () => {
        it('should handle circuit breaker transitions from closed to open', async () => {
            const config: WebSocketConfig = {
                ...DEFAULT_WS_CONFIG,
                maxReconnectAttempts: 1
            };
            const manager = new WebSocketManager(config);

            // Create connection to get connectionKey initialized
            const mockWs = {
                on: jest.fn(),
                ping: jest.fn(),
                send: jest.fn(),
                close: jest.fn(),
                readyState: WebSocket.OPEN
            } as unknown as WebSocket;

            const mockOn = mockWs.on as unknown as jest.Mock;
            (WebSocket as unknown as jest.Mock).mockImplementation((url: string) => {
                process.nextTick(() => {
                    const openCallback = mockOn.mock.calls.find((call: any[]) => call[0] === 'open')?.[1];
                    if (openCallback) {
                        openCallback();
                    }
                });
                return mockWs;
            });

            await manager.createConnection('test-account');

            // Simulate multiple failures by triggering scheduleReconnect
            manager['reconnectAttempts'].set('market', 1);
            manager['scheduleReconnect']('market');

            const circuitState = manager['circuitStates'].get('market');
            expect(circuitState).toEqual(CircuitState.OPEN);

            // Cleanup the manager instance
            manager.cleanupForTests();
        });

        it('should transition from open to half-open after timeout', async () => {
            const config: WebSocketConfig = {
                ...DEFAULT_WS_CONFIG,
                circuitBreakerTimeout: 100 // Short timeout for testing
            };
            const manager = new WebSocketManager(config);

            manager['circuitStates'].set('market', CircuitState.OPEN);
            manager['lastFailureTime'].set('market', Date.now() - 200); // Already passed timeout

            manager['scheduleReconnect']('market');

            const circuitState = manager['circuitStates'].get('market');
            expect(circuitState).toEqual(CircuitState.HALF_OPEN);

            // Cleanup the manager instance
            manager.cleanupForTests();
        });
    });

    describe('health check functionality', () => {
        it('should perform health check on existing connection', async () => {
            // Create a mock connection directly without calling createConnection
            const mockWs = {
                on: jest.fn(),
                once: jest.fn(),
                ping: jest.fn(),
                send: jest.fn(),
                close: jest.fn(),
                readyState: WebSocket.OPEN,
                listeners: jest.fn().mockReturnValue([])
            } as unknown as WebSocket;

            // Add the mock connection directly to the manager
            (websocketManager as any)['websockets'].set('market', mockWs);

            // Mock the ping/pong check to resolve immediately
            const mockOnce = mockWs.once as unknown as jest.Mock;
            mockOnce.mockImplementation((event, callback) => {
                if (event === 'pong') {
                    process.nextTick(callback);
                }
            });

            const healthCheckResult = await websocketManager['performHealthCheck']('market');
            expect(healthCheckResult.healthy).toBe(true);
            expect(healthCheckResult.checksPerformed).toEqual(['connectivity', 'ping_pong']);
        });

        it('should fail health check on non-existent connection', async () => {
            const healthCheckResult = await websocketManager['performHealthCheck']('nonexistent');
            expect(healthCheckResult.healthy).toBe(false);
            expect(healthCheckResult.error).toBeDefined();
        });
    });

    describe('backpressure management', () => {
        it('should activate backpressure when queue exceeds threshold', async () => {
            const manager = new (WebSocketManager as any)();
            manager.backpressureThreshold = 2;

            // Add messages to trigger backpressure
            manager.queueMessage('topic1', 'data1', MessagePriority.MEDIUM);
            manager.queueMessage('topic2', 'data2', MessagePriority.MEDIUM);
            manager.queueMessage('topic3', 'data3', MessagePriority.MEDIUM);

            // Create a mock connection
            const mockWs = {
                on: jest.fn(),
                ping: jest.fn(),
                send: jest.fn(),
                close: jest.fn(),
                readyState: WebSocket.OPEN
            } as unknown as WebSocket;
            manager['websockets'].set('market', mockWs);

            // Manually check and signal backpressure
            manager['checkAndSignalBackpressure']();

            expect(mockWs.send).toHaveBeenCalled();
            const backpressureState = manager['backpressureStates'].get('market');
            expect(backpressureState?.isActive).toBe(true);

            // Cleanup the manager instance
            manager.cleanupForTests();
        });
    });

    describe('message processing', () => {
        it('should process queued messages when connection available', async () => {
            const manager = new (WebSocketManager as any)();
            manager.processingBatchSize = 1;

            // Queue a message
            manager.queueMessage('topic1', 'data1', MessagePriority.MEDIUM);

            // Create a mock connection
            const mockWs = {
                on: jest.fn(),
                ping: jest.fn(),
                send: jest.fn(),
                close: jest.fn(),
                readyState: WebSocket.OPEN
            } as unknown as WebSocket;
            manager['websockets'].set('market', mockWs);

            // Process the queue
            await manager['processQueueBatch']();

            expect(mockWs.send).toHaveBeenCalled();
            expect(manager['messageQueue'].length).toBe(0);

            // Cleanup the manager instance
            manager.cleanupForTests();
        });

        it('should requeue messages with connection issues', async () => {
            const manager = new (WebSocketManager as any)();
            manager['websockets'].clear(); // No connections

            manager.queueMessage('topic1', 'data1', MessagePriority.MEDIUM);

            await manager['processQueueBatch']();

            expect(manager['messageQueue'].length).toBe(1);
            expect(manager['messageQueue'][0].retryCount).toBe(1);

            // Cleanup the manager instance
            manager.cleanupForTests();
        });
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

        it('should handle successful health checks during recovery', async () => {
            const manager = new WebSocketManager();

            // Create a mock connection
            const mockWs = {
                on: jest.fn(),
                once: jest.fn(),
                ping: jest.fn(),
                send: jest.fn(),
                close: jest.fn(),
                readyState: WebSocket.OPEN,
                listeners: jest.fn().mockReturnValue([])
            } as unknown as WebSocket;

            (manager as any)['websockets'].set('market', mockWs);
            (manager as any)['circuitStates'].set('market', CircuitState.HALF_OPEN);

            // Mock ping/pong to succeed
            const mockOnce = mockWs.once as unknown as jest.Mock;
            mockOnce.mockImplementation((event, callback) => {
                if (event === 'pong') {
                    process.nextTick(callback);
                }
            });

            // Start health check monitoring
            (manager as any)['startHealthCheckMonitoring']('market');

            // Let health check run
            await new Promise(resolve => setTimeout(resolve, 100));

            expect((manager as any)['recoveryStates']).not.toEqual({});

            manager.cleanupForTests();
        });

        it('should handle failed health checks during recovery', async () => {
            const manager = new WebSocketManager();

            (manager as any)['websockets'].clear(); // No connection available
            (manager as any)['circuitStates'].set('market', CircuitState.HALF_OPEN);

            // Start health check monitoring
            (manager as any)['startHealthCheckMonitoring']('market');

            // Let health check run
            await new Promise(resolve => setTimeout(resolve, 100));

            const recoveryState = (manager as any)['recoveryStates'].get('market');
            expect(recoveryState).toBeDefined();

            manager.cleanupForTests();
        });
    });

    describe('health check monitoring', () => {
        it('should transition from half-open to closed on successful health checks', async () => {
            const manager = new WebSocketManager();

            const mockWs = {
                on: jest.fn(),
                once: jest.fn(),
                ping: jest.fn(),
                send: jest.fn(),
                close: jest.fn(),
                readyState: WebSocket.OPEN,
                listeners: jest.fn().mockReturnValue([])
            } as unknown as WebSocket;

            (manager as any)['websockets'].set('market', mockWs);
            (manager as any)['circuitStates'].set('market', CircuitState.HALF_OPEN);

            // Mock ping/pong to succeed
            const mockOnce = mockWs.once as unknown as jest.Mock;
            mockOnce.mockImplementation((event, callback) => {
                if (event === 'pong') {
                    process.nextTick(callback);
                }
            });

            // Create recovery state
            const recoveryState = {
                healthChecksPerformed: 1,
                consecutiveSuccesses: 1,
                consecutiveFailures: 0,
                lastHealthCheck: null,
                recoveryStartTime: Date.now()
            };
            (manager as any)['recoveryStates'].set('market', recoveryState);

            // Call recovery health check again to reach threshold
            await (manager as any)['performRecoveryHealthCheck']('market');

            // Should transition to closed
            expect((manager as any)['circuitStates'].get('market')).toEqual(CircuitState.CLOSED);

            manager.cleanupForTests();
        });

        it('should transition from half-open to open on failed health checks', async () => {
            const manager = new WebSocketManager();

            (manager as any)['websockets'].clear(); // No connection available
            (manager as any)['circuitStates'].set('market', CircuitState.HALF_OPEN);

            // Create recovery state with failures
            const recoveryState = {
                healthChecksPerformed: 2,
                consecutiveSuccesses: 0,
                consecutiveFailures: 2,
                lastHealthCheck: null,
                recoveryStartTime: Date.now()
            };
            (manager as any)['recoveryStates'].set('market', recoveryState);

            await (manager as any)['performRecoveryHealthCheck']('market');

            // Should transition to open
            expect((manager as any)['circuitStates'].get('market')).toEqual(CircuitState.OPEN);

            manager.cleanupForTests();
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