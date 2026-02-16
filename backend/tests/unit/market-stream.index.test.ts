/** @format */

import { MarketStreamService } from '../../src/infrastructure/messaging/market-stream/index';
import { WebSocketManager } from '../../src/infrastructure/messaging/market-stream/websocket-manager';
import { AuthManager } from '../../src/infrastructure/messaging/market-stream/auth-manager';
import { CacheManager } from '../../src/infrastructure/messaging/market-stream/cache-manager';
import { SubscriptionManager } from '../../src/infrastructure/messaging/market-stream/subscription-manager';
import { MessageHandler } from '../../src/infrastructure/messaging/market-stream/message-handler';

// Mock external dependencies
jest.mock('../../src/core/logging/logger.service');
jest.mock('../../src/infrastructure/messaging/market-stream/websocket-manager');
jest.mock('../../src/infrastructure/messaging/market-stream/auth-manager');
jest.mock('../../src/infrastructure/messaging/market-stream/cache-manager');
jest.mock('../../src/infrastructure/messaging/market-stream/subscription-manager');
jest.mock('../../src/infrastructure/messaging/market-stream/message-handler');
jest.mock('../../src/database/pool');
jest.mock('../../src/infrastructure/security/encryption.service');

// Mock third-party modules
jest.mock('bs58', () => ({
    decode: jest.fn()
}));

jest.mock('@noble/ed25519', () => ({
    sign: jest.fn()
}));

// Mock the dynamic import for encryption service
jest.mock('../../src/infrastructure/security/encryption.service', () => ({
    encryptionService: {
        decryptApiKey: jest.fn(),
        decryptSecretKey: jest.fn()
    }
}));

describe('MarketStreamService', () => {
    let marketStreamService: MarketStreamService;

    // Mock instances
    let mockWsManager: jest.Mocked<WebSocketManager>;
    let mockAuthManager: jest.Mocked<AuthManager>;
    let mockCacheManager: jest.Mocked<CacheManager>;
    let mockSubscriptionManager: jest.Mocked<SubscriptionManager>;
    let mockMessageHandler: jest.Mocked<MessageHandler>;

    // Mock dependencies
    const mockWebSocket = {
        on: jest.fn(),
        send: jest.fn(),
        readyState: 1 // OPEN
    } as any;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Create mock instances
        mockWsManager = {
            createConnection: jest.fn(),
            getConnection: jest.fn(),
            isConnected: jest.fn(),
            disconnectAll: jest.fn(),
            cleanupAllIntervals: jest.fn(),
            getStats: jest.fn(),
            startQueueProcessor: jest.fn()
        } as unknown as jest.Mocked<WebSocketManager>;

        mockAuthManager = {
            getAccountId: jest.fn(),
            authenticate: jest.fn()
        } as unknown as jest.Mocked<AuthManager>;

        mockCacheManager = {
            getTick: jest.fn(),
            getKlines: jest.fn(),
            getMarkPrice: jest.fn(),
            getStats: jest.fn()
        } as unknown as jest.Mocked<CacheManager>;

        mockSubscriptionManager = {
            addPendingSubscription: jest.fn(),
            getPendingSubscriptions: jest.fn(),
            clearPendingSubscription: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            clearAll: jest.fn(),
            getStats: jest.fn(),
            getDetailedStats: jest.fn()
        } as unknown as jest.Mocked<SubscriptionManager>;

        mockMessageHandler = {
            handleMessage: jest.fn(),
            setSocketServer: jest.fn(),
            setWebSocketManager: jest.fn(),
            clearProcessingQueue: jest.fn(),
            getStats: jest.fn()
        } as unknown as jest.Mocked<MessageHandler>;

        // Create MarketStreamService instance with mock dependencies
        marketStreamService = new MarketStreamService(
            mockWsManager,
            mockAuthManager,
            mockCacheManager,
            mockMessageHandler,
            mockSubscriptionManager
        );
    });

    describe('instance creation', () => {
        it('should create an instance of MarketStreamService', () => {
            expect(marketStreamService).toBeInstanceOf(MarketStreamService);
        });

        it('should initialize with all required components', () => {
            expect(marketStreamService).toBeDefined();
        });
    });

    describe('socket server management', () => {
        it('should set socket server instance', () => {
            const mockIo = {
                on: jest.fn(),
                emit: jest.fn()
            };

            marketStreamService.setSocketServer(mockIo as any);
            expect(mockMessageHandler.setSocketServer).toHaveBeenCalledWith(mockIo);
            expect(mockMessageHandler.setWebSocketManager).toHaveBeenCalledWith(mockWsManager);
        });
    });

    describe('connection management', () => {
        it('should connect to Orderly with valid symbols', async () => {
            const mockAccountId = 'test-account-123';

            // Mock dependencies
            mockAuthManager.getAccountId.mockResolvedValue(mockAccountId);
            mockAuthManager.authenticate.mockResolvedValue();
            mockWsManager.createConnection.mockResolvedValue(mockWebSocket);
            mockWsManager.getConnection.mockReturnValue(mockWebSocket);
            mockWsManager.isConnected.mockReturnValue(true);
            mockSubscriptionManager.getPendingSubscriptions.mockReturnValue(['BTC-PERP@kline_1m']);
            mockSubscriptionManager.clearPendingSubscription.mockImplementation();

            await marketStreamService.connectToOrderly(['BTC-PERP']);

            expect(mockAuthManager.getAccountId).toHaveBeenCalled();
            expect(mockWsManager.createConnection).toHaveBeenCalledWith(mockAccountId);
            expect(mockSubscriptionManager.addPendingSubscription).toHaveBeenCalled();
        });

        it('should handle connection errors gracefully', async () => {
            const testError = new Error('Connection failed');
            mockAuthManager.getAccountId.mockRejectedValue(testError);

            await marketStreamService.connectToOrderly(['BTC-PERP']);

            expect(mockAuthManager.getAccountId).toHaveBeenCalled();
        });

        it('should handle no account ID returned from auth manager', async () => {
            mockAuthManager.getAccountId.mockResolvedValue(null);

            await marketStreamService.connectToOrderly(['BTC-PERP']);

            expect(mockAuthManager.getAccountId).toHaveBeenCalled();
            expect(mockWsManager.createConnection).not.toHaveBeenCalled();
        });
    });

    describe('subscription management', () => {
        it('should subscribe and unsubscribe from topics', () => {
            marketStreamService.subscribe('test-client', 'BTC-PERP@kline_1m');
            marketStreamService.unsubscribe('test-client', 'BTC-PERP@kline_1m');

            expect(mockSubscriptionManager.subscribe).toHaveBeenCalledWith('test-client', 'BTC-PERP@kline_1m');
            expect(mockSubscriptionManager.unsubscribe).toHaveBeenCalledWith('test-client', 'BTC-PERP@kline_1m');
        });

        it('should handle subscribe and unsubscribe for legacy methods', () => {
            // Test legacy connectToKline
            marketStreamService.connectToKline('BTC-PERP', '1m');
            // Test legacy connectToMarkPrice
            marketStreamService.connectToMarkPrice('BTC-PERP');

            expect(mockSubscriptionManager.subscribe).toHaveBeenCalledWith('legacy-client', 'BTC-PERP@kline_1m');
            expect(mockSubscriptionManager.subscribe).toHaveBeenCalledWith('legacy-client', 'BTC-PERP@markprice');
        });
    });

    describe('cache operations', () => {
        it('should retrieve latest tick data from cache', async () => {
            const mockTickData = {
                symbol: 'BTC-PERP',
                price: 50000,
                volume: 1000,
                timestamp: Date.now(),
                bid: 49999,
                ask: 50001,
                change24h: 2.5
            };

            mockCacheManager.getTick.mockResolvedValue(mockTickData);

            const result = await marketStreamService.getLatestTick('BTC-PERP');
            expect(result).toEqual(mockTickData);
            expect(mockCacheManager.getTick).toHaveBeenCalledWith('BTC-PERP');
        });

        it('should retrieve kline data from cache', async () => {
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

            mockCacheManager.getKlines.mockResolvedValue(mockKlineData);

            const result = await marketStreamService.getKlines('BTC-PERP', '1m');
            expect(result).toEqual(mockKlineData);
            expect(mockCacheManager.getKlines).toHaveBeenCalledWith('BTC-PERP', '1m', 300);
        });

        it('should retrieve latest mark price data from cache', async () => {
            const mockMarkPriceData = {
                symbol: 'BTC-PERP',
                price: 50000,
                timestamp: Date.now()
            };

            mockCacheManager.getMarkPrice.mockResolvedValue(mockMarkPriceData);

            const result = await marketStreamService.getLatestMarkPrice('BTC-PERP');
            expect(result).toEqual(mockMarkPriceData);
            expect(mockCacheManager.getMarkPrice).toHaveBeenCalledWith('BTC-PERP');
        });
    });

    describe('disconnect functionality', () => {
        it('should disconnect all connections cleanly', () => {
            marketStreamService.disconnectAll();

            expect(mockWsManager.disconnectAll).toHaveBeenCalled();
            expect(mockSubscriptionManager.clearAll).toHaveBeenCalled();
        });
    });

    describe('status and statistics', () => {
        it('should return service status with disconnected state', () => {
            mockWsManager.isConnected.mockReturnValue(false);
            mockSubscriptionManager.getStats.mockReturnValue({
                activeSubscriptions: 0,
                totalReferences: 0,
                topics: []
            });
            mockSubscriptionManager.getPendingSubscriptions.mockReturnValue([]);

            const status = marketStreamService.getStatus();
            expect(status.connected).toBe(false);
            expect(status.websockets).toEqual([]);
            expect(status.pendingSubscriptions).toBe(0);
            expect(status.subscriptionStats).toEqual({
                activeSubscriptions: 0,
                totalReferences: 0,
                topics: []
            });
        });

        it('should return service status with connected state', () => {
            mockWsManager.isConnected.mockReturnValue(true);
            mockSubscriptionManager.getStats.mockReturnValue({
                activeSubscriptions: 2,
                totalReferences: 3,
                topics: ['BTC-PERP@kline_1m', 'ETH-PERP@markprice']
            });
            mockSubscriptionManager.getPendingSubscriptions.mockReturnValue(['ETH-PERP@kline_1m']);

            const status = marketStreamService.getStatus();
            expect(status.connected).toBe(true);
            expect(status.websockets).toEqual(['market']);
            expect(status.pendingSubscriptions).toBe(1);
            expect(status.subscriptionStats).toEqual({
                activeSubscriptions: 2,
                totalReferences: 3,
                topics: ['BTC-PERP@kline_1m', 'ETH-PERP@markprice']
            });
        });

        it('should return detailed service statistics', async () => {
            mockWsManager.getStats.mockReturnValue({
                activeConnections: 1,
                connectionKeys: ['market'],
                circuitBreakerStates: {},
                queueDepth: 0,
                maxQueueSize: 10000,
                backpressureActive: false,
                backpressureStates: {},
                processingBatchSize: 50,
                backpressureThreshold: 1000,
                recoveryStates: {},
                healthCheckConfig: {
                    timeout: 5000,
                    retries: 2,
                    interval: 10000,
                    successThreshold: 2,
                    failureThreshold: 3,
                    enablePingPong: true,
                    enableAuthCheck: false,
                    enableSubscriptionCheck: false
                }
            });
            mockCacheManager.getStats.mockResolvedValue({
                redisConnected: true,
                cacheKeys: ['tick:BTC-PERP', 'kline:BTC-PERP:1m']
            });
            mockSubscriptionManager.getDetailedStats.mockReturnValue({
                activeSubscriptions: [
                    {
                        topic: 'BTC-PERP@kline_1m',
                        count: 2,
                        lastUsed: Date.now(),
                        age: 0
                    }
                ],
                pendingSubscriptions: [],
                cleanupTimers: 0
            });
            mockMessageHandler.getStats.mockReturnValue({
                hasSocketServer: true,
                activeRooms: ['BTC-PERP', 'ETH-PERP']
            });

            const stats = await marketStreamService.getDetailedStats();
            expect(stats.websocket).toEqual({
                activeConnections: 1,
                connectionKeys: ['market'],
                circuitBreakerStates: {},
                queueDepth: 0,
                maxQueueSize: 10000,
                backpressureActive: false,
                backpressureStates: {},
                processingBatchSize: 50,
                backpressureThreshold: 1000,
                recoveryStates: {},
                healthCheckConfig: {
                    timeout: 5000,
                    retries: 2,
                    interval: 10000,
                    successThreshold: 2,
                    failureThreshold: 3,
                    enablePingPong: true,
                    enableAuthCheck: false,
                    enableSubscriptionCheck: false
                }
            });
            // Check if cache stats have the correct structure
            expect(stats.cache).toEqual(
                expect.objectContaining({
                    redisConnected: true,
                    cacheKeys: expect.arrayContaining(['tick:BTC-PERP', 'kline:BTC-PERP:1m'])
                })
            );
            expect(stats.subscriptions).toEqual({
                activeSubscriptions: [
                    expect.objectContaining({
                        topic: 'BTC-PERP@kline_1m',
                        count: 2
                    })
                ],
                pendingSubscriptions: [],
                cleanupTimers: 0
            });
            expect(stats.messageHandler).toEqual({
                hasSocketServer: true,
                activeRooms: ['BTC-PERP', 'ETH-PERP']
            });
        });
    });
});