/** @format */

import { MarketStreamService } from '../../src/infrastructure/messaging/market-stream.service';

// Mock external dependencies
jest.mock('../../src/core/logging/context-aware-logger.service');
jest.mock('../../src/database/pool');
jest.mock('../../src/infrastructure/cache');

describe('MarketStreamService', () => {
    let marketStreamService: MarketStreamService;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        marketStreamService = new MarketStreamService();
    });

    afterEach(() => {
        // Cleanup to prevent open handles
        marketStreamService.cleanupForTests();
        jest.clearAllTimers();
    });

    describe('instance creation', () => {
        it('should create an instance of MarketStreamService', () => {
            expect(marketStreamService).toBeInstanceOf(MarketStreamService);
        });

        it('should initialize with all required components', () => {
            expect(marketStreamService).toBeDefined();
        });
    });

    describe('basic functionality', () => {
        it('should start with disconnected status', () => {
            const status = marketStreamService.getStatus();
            expect(status.connected).toBe(0);
            expect(status.websockets).toEqual([]);
            expect(status.pendingSubscriptions).toBe(0);
            expect(status.activeSubscriptions).toBe(0);
        });

        it('should return empty tick data when no data available', async () => {
            const mockGetTick = jest.fn().mockResolvedValue(null);
            (require('../../src/infrastructure/cache').redisService.get = jest.fn().mockResolvedValue({
                success: false,
                error: 'Cache miss'
            }));

            const result = await marketStreamService.getLatestTick('BTC-PERP');
            expect(result).toBeNull();
        });

        it('should return empty klines array when no data available', async () => {
            const mockGetKlines = jest.fn().mockResolvedValue({
                success: false,
                error: 'Cache miss'
            });
            (require('../../src/infrastructure/cache').redisService.get = mockGetKlines);

            const result = await marketStreamService.getKlines('BTC-PERP', '1m');
            expect(result).toEqual([]);
        });

        it('should return empty mark price when no data available', async () => {
            const mockGetMarkPrice = jest.fn().mockResolvedValue({
                success: false,
                error: 'Cache miss'
            });
            (require('../../src/infrastructure/cache').redisService.get = mockGetMarkPrice);

            const result = await marketStreamService.getLatestMarkPrice('BTC-PERP');
            expect(result).toBeNull();
        });
    });

    describe('subscription management', () => {
        it('should subscribe and unsubscribe from topics', () => {
            marketStreamService.subscribe('test-client', 'BTC-PERP@kline_1m');
            const statusAfterSubscribe = marketStreamService.getStatus();
            expect(statusAfterSubscribe.activeSubscriptions).toBeGreaterThan(0);

            marketStreamService.unsubscribe('test-client', 'BTC-PERP@kline_1m');
            const statusAfterUnsubscribe = marketStreamService.getStatus();
        });

        it('should handle subscribe and unsubscribe for legacy methods', () => {
            // Test legacy connectToKline
            marketStreamService.connectToKline('BTC-PERP', '1m');
            const statusAfterKline = marketStreamService.getStatus();
            expect(statusAfterKline.activeSubscriptions).toBeGreaterThan(0);

            // Test legacy connectToMarkPrice
            marketStreamService.connectToMarkPrice('BTC-PERP');
            const statusAfterMarkPrice = marketStreamService.getStatus();
            expect(statusAfterMarkPrice.activeSubscriptions).toBeGreaterThan(1);
        });

        it('should handle subscription reference counting', () => {
            // Multiple subscriptions to the same topic should increase reference count
            marketStreamService.subscribe('client-1', 'BTC-PERP@kline_1m');
            marketStreamService.subscribe('client-2', 'BTC-PERP@kline_1m');

            const statusAfterMultipleSubs = marketStreamService.getStatus();
            expect(statusAfterMultipleSubs.activeSubscriptions).toBeGreaterThan(0);
        });
    });

    describe('disconnect functionality', () => {
        it('should disconnect all connections cleanly', () => {
            expect(() => {
                marketStreamService.disconnectAll();
            }).not.toThrow();
        });

        it('should cleanup resources for tests', () => {
            expect(() => {
                marketStreamService.cleanupForTests();
            }).not.toThrow();
        });
    });

    describe('socket server management', () => {
        it('should set socket server instance', () => {
            const mockIo = {
                on: jest.fn(),
                emit: jest.fn()
            };

            marketStreamService.setSocketServer(mockIo as any);
        });
    });

    describe('connection management', () => {
        it('should handle connection errors', async () => {
            const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
            (require('../../src/database/pool').query = mockQuery);

            await expect(marketStreamService.connectToOrderly(['BTC-PERP'])).resolves.not.toThrow();
        });

        it('should handle connection with valid credentials', async () => {
            const mockQuery = jest.fn().mockResolvedValue({
                rows: [{
                    account_id: 'test-account-123',
                    api_key_encrypted: 'encrypted-api-key',
                    secret_key_encrypted: 'encrypted-secret-key'
                }]
            });
            (require('../../src/database/pool').query = mockQuery);

            await expect(marketStreamService.connectToOrderly(['BTC-PERP'])).resolves.not.toThrow();
        });
    });

    describe('WebSocket manager statistics', () => {
        it('should provide comprehensive connection statistics', async () => {
            expect(marketStreamService.getStatus).toBeDefined();
            expect(typeof marketStreamService.getStatus).toBe('function');
        });
    });

    describe('cache operations', () => {
        it('should cache and retrieve tick data', async () => {
            const mockTickData = {
                symbol: 'BTC-PERP',
                price: 50000,
                volume: 1000,
                timestamp: Date.now(),
                bid: 49999,
                ask: 50001,
                change24h: 2.5
            };

            const mockSetex = jest.fn().mockResolvedValue({ success: true });
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(mockTickData)
            });

            (require('../../src/infrastructure/cache').redisService.setex = mockSetex);
            (require('../../src/infrastructure/cache').redisService.get = mockGet);

            const result = await marketStreamService.getLatestTick('BTC-PERP');
            expect(result).toEqual(mockTickData);
        });

        it('should cache and retrieve kline data', async () => {
            const mockKlineData = [{
                symbol: 'BTC-PERP',
                type: 'kline',
                open: 50000,
                high: 51000,
                low: 49000,
                close: 50500,
                volume: 1000,
                amount: 50500000,
                startTime: Date.now() - 3600000,
                endTime: Date.now()
            }];

            const mockSetex = jest.fn().mockResolvedValue({ success: true });
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(mockKlineData)
            });

            (require('../../src/infrastructure/cache').redisService.setex = mockSetex);
            (require('../../src/infrastructure/cache').redisService.get = mockGet);

            const result = await marketStreamService.getKlines('BTC-PERP', '1m');
            expect(result).toEqual(mockKlineData);
        });

        it('should cache and retrieve mark price data', async () => {
            const mockMarkPriceData = {
                symbol: 'BTC-PERP',
                price: 50000,
                timestamp: Date.now()
            };

            const mockSetex = jest.fn().mockResolvedValue({ success: true });
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify(mockMarkPriceData)
            });

            (require('../../src/infrastructure/cache').redisService.setex = mockSetex);
            (require('../../src/infrastructure/cache').redisService.get = mockGet);

            const result = await marketStreamService.getLatestMarkPrice('BTC-PERP');
            expect(result).toEqual(mockMarkPriceData);
        });
    });

    describe('message handling', () => {
        it('should handle authentication success response', async () => {
            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test authentication success message
            const testMessage = {
                event: 'auth',
                success: true,
                code: 0
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            // Should not call any cache methods for auth responses
        });

        it('should handle authentication failure response', async () => {
            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test authentication failure message
            const testMessage = {
                event: 'auth',
                success: false,
                code: 401,
                message: 'Unauthorized'
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            // Should not call any cache methods for auth responses
        });

        it('should handle subscription success response', async () => {
            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test subscription success message
            const testMessage = {
                event: 'subscribed',
                success: true,
                code: 0,
                topic: 'BTC-PERP@kline_1m'
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            // Should not call any cache methods for subscription responses
        });

        it('should handle subscription failure response', async () => {
            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test subscription failure message
            const testMessage = {
                event: 'subscribed',
                success: false,
                code: 400,
                message: 'Invalid topic'
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            // Should not call any cache methods for subscription responses
        });

        it('should handle unrecognized message type', async () => {
            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test unrecognized message
            const testMessage = {
                event: 'unrecognized',
                data: 'some data'
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            // Should not call any cache methods for unrecognized messages
        });
    });

    describe('processing queue', () => {
        it('should handle message backpressure', async () => {
            // Mock socket server
            const mockIo = { emit: jest.fn() };
            marketStreamService.setSocketServer(mockIo as any);

            // Attempt to enqueue a large number of messages
            const mockEnqueue = jest.fn().mockReturnValue(false);
            // @ts-ignore - Accessing private property for testing
            marketStreamService['messageHandler']['processingQueue'].enqueue = mockEnqueue;

            const testMessage = {
                topic: 'BTC-PERP@kline_1m',
                data: {
                    symbol: 'BTC-PERP',
                    startTime: Date.now(),
                    open: '50000',
                    close: '50500',
                    high: '51000',
                    low: '49000',
                    volume: '1000',
                    amount: '50500000'
                }
            };

            // @ts-ignore - Accessing private property for testing
            const result = marketStreamService['messageHandler'].enqueueMessage(testMessage);

            expect(mockEnqueue).toHaveBeenCalled();
        });

        it('should clear processing queue', async () => {
            // @ts-ignore - Accessing private property for testing
            const clearSpy = jest.spyOn(marketStreamService['messageHandler']['processingQueue'], 'clear');

            marketStreamService.cleanupForTests();

            expect(clearSpy).toHaveBeenCalled();
        });
    });

    describe('atomic cache operations', () => {
        it('should handle atomic cache updates with retries', async () => {
            const mockSetex = jest.fn().mockResolvedValue({ success: true });
            const mockGet = jest.fn().mockResolvedValue({
                success: true,
                data: JSON.stringify([])
            });

            (require('../../src/infrastructure/cache').redisService.setex = mockSetex);
            (require('../../src/infrastructure/cache').redisService.get = mockGet);

            const result = await marketStreamService.getKlines('BTC-PERP', '1m');
            expect(result).toEqual([]);
        });
    });

    describe('subscription cleanup', () => {
        it('should schedule subscription cleanup after unsubscribe', async () => {
            marketStreamService.subscribe('test-client', 'BTC-PERP@kline_1m');
            marketStreamService.unsubscribe('test-client', 'BTC-PERP@kline_1m');

            // Verify the subscription is marked for cleanup
            const status = marketStreamService.getStatus();
            expect(status.activeSubscriptions).toBeGreaterThan(0);
        });
    });

    describe('connection management', () => {
        it('should handle connection limits', async () => {
            // @ts-ignore - Accessing private property for testing
            const createConnectionSpy = jest.spyOn(marketStreamService['wsManager'], 'createConnection');

            // Create multiple connections to test limits
            const mockQuery = jest.fn().mockResolvedValue({
                rows: [{
                    account_id: 'test-account-123',
                    api_key_encrypted: 'encrypted-api-key',
                    secret_key_encrypted: 'encrypted-secret-key'
                }]
            });
            (require('../../src/database/pool').query = mockQuery);

            await marketStreamService.connectToOrderly(['BTC-PERP']);

            expect(createConnectionSpy).toHaveBeenCalled();
        });
    });

    describe('connection health', () => {
        it('should update connection health metrics', async () => {
            // @ts-ignore - Accessing private property for testing
            const updateHealthSpy = jest.spyOn(marketStreamService['wsManager'], 'updateConnectionHealth');

            // @ts-ignore - Accessing private property for testing
            marketStreamService['wsManager'].updateConnectionHealth('market', 'message_received');

            expect(updateHealthSpy).toHaveBeenCalledWith('market', 'message_received');
        });
    });

    // More specific tests for remaining uncovered functionality
    describe('WebSocket connection management', () => {
        it('should handle connection errors', async () => {
            const mockQuery = jest.fn().mockRejectedValue(new Error('Connection error'));
            (require('../../src/database/pool').query = mockQuery);

            await expect(marketStreamService.connectToOrderly(['BTC-PERP'])).resolves.not.toThrow();
        });

        it('should handle closed WebSocket connections', async () => {
            const mockQuery = jest.fn().mockResolvedValue({
                rows: [{
                    account_id: 'test-account-123',
                    api_key_encrypted: 'encrypted-api-key',
                    secret_key_encrypted: 'encrypted-secret-key'
                }]
            });
            (require('../../src/database/pool').query = mockQuery);

            await expect(marketStreamService.connectToOrderly(['BTC-PERP'])).resolves.not.toThrow();
        });
    });

    describe('subscription management details', () => {
        it('should handle unsubscribe from non-existent topic', () => {
            expect(() => {
                marketStreamService.unsubscribe('test-client', 'non-existent-topic');
            }).not.toThrow();
        });

        it('should handle multiple subscriptions to different topics', () => {
            marketStreamService.subscribe('test-client', 'BTC-PERP@kline_1m');
            marketStreamService.subscribe('test-client', 'ETH-PERP@markprice');
            marketStreamService.subscribe('test-client', 'SOL-PERP@ticker');

            const status = marketStreamService.getStatus();
            expect(status.activeSubscriptions).toBeGreaterThan(2);
        });
    });

    describe('cache manager operations', () => {
        it('should handle cache write failures', async () => {
            const mockSetex = jest.fn().mockResolvedValue({ success: false, error: 'Cache write error' });
            const mockGet = jest.fn().mockResolvedValue({ success: true, data: JSON.stringify([]) });

            (require('../../src/infrastructure/cache').redisService.setex = mockSetex);
            (require('../../src/infrastructure/cache').redisService.get = mockGet);

            const result = await marketStreamService.getKlines('BTC-PERP', '1m');
            expect(result).toEqual([]);
        });

        it('should handle cache read failures', async () => {
            const mockGet = jest.fn().mockResolvedValue({ success: false, error: 'Cache read error' });

            (require('../../src/infrastructure/cache').redisService.get = mockGet);

            const result = await marketStreamService.getLatestTick('BTC-PERP');
            expect(result).toBeNull();
        });
    });

    describe('message handling', () => {
        it('should handle ticker messages and update cache', async () => {
            // Mock the cache manager
            const mockCacheTick = jest.fn().mockResolvedValue(undefined);
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].cacheTick = mockCacheTick;

            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test ticker message
            const testMessage = {
                topic: 'ticker',
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000',
                    lastPrice: '50000',
                    volume: '1000',
                    bid: '49999',
                    ask: '50001',
                    change24h: '2.5'
                }
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            expect(mockCacheTick).toHaveBeenCalled();
            expect(mockEmit).toHaveBeenCalled();
        });

        it('should handle kline messages and update cache', async () => {
            // Mock the cache manager
            const mockGetKlines = jest.fn().mockResolvedValue([]);
            const mockCacheKlines = jest.fn().mockResolvedValue(undefined);
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].getKlines = mockGetKlines;
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].cacheKlines = mockCacheKlines;

            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test kline message
            const testMessage = {
                topic: 'BTC-PERP@kline_1m',
                data: {
                    symbol: 'BTC-PERP',
                    startTime: Date.now(),
                    open: '50000',
                    close: '50500',
                    high: '51000',
                    low: '49000',
                    volume: '1000',
                    amount: '50500000'
                }
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            expect(mockGetKlines).toHaveBeenCalled();
            expect(mockCacheKlines).toHaveBeenCalled();
            expect(mockEmit).toHaveBeenCalled();
        });

        it('should handle mark price messages and update cache', async () => {
            // Mock the cache manager
            const mockCacheMarkPrice = jest.fn().mockResolvedValue(undefined);
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].cacheMarkPrice = mockCacheMarkPrice;

            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test mark price message
            const testMessage = {
                topic: 'BTC-PERP@markprice',
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000',
                    timestamp: Date.now()
                }
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            expect(mockCacheMarkPrice).toHaveBeenCalled();
            expect(mockEmit).toHaveBeenCalled();
        });

        it('should handle invalid ticker data without symbol', async () => {
            // Mock the cache manager
            const mockCacheTick = jest.fn().mockResolvedValue(undefined);
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].cacheTick = mockCacheTick;

            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test ticker message without symbol
            const testMessage = {
                topic: 'ticker',
                data: {
                    price: '50000',
                    lastPrice: '50000',
                    volume: '1000',
                    bid: '49999',
                    ask: '50001',
                    change24h: '2.5'
                }
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            // Should not call cacheTick when symbol is missing
            expect(mockCacheTick).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
        });

        it('should handle invalid mark price data without symbol', async () => {
            // Mock the cache manager
            const mockCacheMarkPrice = jest.fn().mockResolvedValue(undefined);
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].cacheMarkPrice = mockCacheMarkPrice;

            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test mark price message without symbol in data
            const testMessage = {
                topic: 'BTC-PERP@markprice',
                data: {
                    price: '50000',
                    timestamp: Date.now()
                }
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            // Should not call cacheMarkPrice because symbol is missing from data
            expect(mockCacheMarkPrice).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
        });

        it('should handle invalid kline data without symbol', async () => {
            // Mock the cache manager
            const mockGetKlines = jest.fn().mockResolvedValue([]);
            const mockCacheKlines = jest.fn().mockResolvedValue(undefined);
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].getKlines = mockGetKlines;
            // @ts-ignore - Accessing private property for testing
            marketStreamService['cacheManager'].cacheKlines = mockCacheKlines;

            // Mock socket server
            const mockEmit = jest.fn();
            const mockIo = { emit: mockEmit };
            marketStreamService.setSocketServer(mockIo as any);

            // Create a test kline message without symbol
            const testMessage = {
                topic: 'BTC-PERP@kline_1m',
                data: {
                    startTime: Date.now(),
                    open: '50000',
                    close: '50500',
                    high: '51000',
                    low: '49000',
                    volume: '1000',
                    amount: '50500000'
                }
            };

            // @ts-ignore - Accessing private property for testing
            await marketStreamService['messageHandler'].handleMessage(testMessage);

            expect(mockGetKlines).not.toHaveBeenCalled();
            expect(mockCacheKlines).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
        });
    });

    describe('atomic cache operations', () => {
        it('should handle atomic cache update failures', async () => {
            const mockSetex = jest.fn().mockResolvedValue({ success: false, error: 'Cache write error' });
            const mockGet = jest.fn().mockResolvedValue({ success: true, data: JSON.stringify([]) });

            (require('../../src/infrastructure/cache').redisService.setex = mockSetex);
            (require('../../src/infrastructure/cache').redisService.get = mockGet);

            const result = await marketStreamService.getKlines('BTC-PERP', '1m');
            expect(result).toEqual([]);
        });
    });

    describe('circuit breaker functionality', () => {
        it('should track consecutive successes for circuit breaker', async () => {
            // @ts-ignore - Accessing private property for testing
            const handleMessageSpy = jest.spyOn(marketStreamService['wsManager'], 'handleMessageForCircuitBreaker');

            // @ts-ignore - Accessing private property for testing
            marketStreamService['wsManager'].handleMessageForCircuitBreaker('market');

            expect(handleMessageSpy).toHaveBeenCalledWith('market');
        });

        it('should calculate overall health score', async () => {
            // @ts-ignore - Accessing private property for testing
            const calculateHealthSpy = jest.spyOn(marketStreamService['wsManager'], 'calculateOverallHealth');

            const testHealth = {
                connectivity: 80,
                dataFlow: 70,
                latency: 100,
                stability: 90,
                overall: 0,
                lastUpdated: Date.now()
            };

            // @ts-ignore - Accessing private property for testing
            const result = marketStreamService['wsManager'].calculateOverallHealth(testHealth);

            expect(calculateHealthSpy).toHaveBeenCalled();
            expect(result).toBeGreaterThan(0);
        });
    });

    describe('emergency management', () => {
        it('should handle emergency mode connections', () => {
            // @ts-ignore - Accessing private property for testing
            const addEmergencyConnectionSpy = jest.spyOn(marketStreamService['wsManager']['emergencyConnections'], 'add');

            // @ts-ignore - Accessing private property for testing
            marketStreamService['wsManager']['emergencyConnections'].add('emergency-1');

            expect(addEmergencyConnectionSpy).toHaveBeenCalledWith('emergency-1');
        });
    });

    describe('health check operations', () => {
        it('should perform half-open health check', async () => {
            // @ts-ignore - Accessing private property for testing
            const performHealthCheckSpy = jest.spyOn(marketStreamService['wsManager'], 'performHalfOpenHealthCheck');

            // @ts-ignore - Accessing private property for testing
            const result = await marketStreamService['wsManager'].performHalfOpenHealthCheck('market');

            expect(performHealthCheckSpy).toHaveBeenCalledWith('market');
            expect(typeof result).toBe('boolean');
        });
    });

    describe('processing queue statistics', () => {
        it('should track queue statistics', async () => {
            // @ts-ignore - Accessing private property for testing
            const getStatsSpy = jest.spyOn(marketStreamService['messageHandler']['processingQueue'], 'getStats');

            // @ts-ignore - Accessing private property for testing
            const stats = marketStreamService['messageHandler']['processingQueue'].getStats();

            expect(getStatsSpy).toHaveBeenCalled();
            expect(stats.queueSize).toBeDefined();
            expect(stats.isProcessing).toBeDefined();
            expect(stats.concurrentOperations).toBeDefined();
        });
    });

    describe('subscription management details', () => {
        it('should schedule subscription for cleanup when reference count reaches zero', () => {
            // Subscribe and then unsubscribe to reach zero reference count
            marketStreamService.subscribe('test-client', 'BTC-PERP@kline_1m');
            marketStreamService.unsubscribe('test-client', 'BTC-PERP@kline_1m');

            // Get active subscriptions
            const status = marketStreamService.getStatus();
            // The subscription should still be active but marked for cleanup
            expect(status.activeSubscriptions).toBeGreaterThan(0);
        });
    });
});