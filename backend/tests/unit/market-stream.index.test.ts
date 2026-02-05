/** @format */

import { MarketStreamService } from '../../src/infrastructure/messaging/market-stream/index';

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

    // Mock dependencies
    const mockWebSocket = {
        on: jest.fn(),
        send: jest.fn(),
        readyState: 1 // OPEN
    } as any;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        marketStreamService = new MarketStreamService();
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
            // Verify the method exists and doesn't throw
        });
    });

    describe('connection management', () => {
        it('should connect to Orderly with valid symbols', async () => {
            const mockAccountId = 'test-account-123';

            // Mock dependencies
            const mockAuthManager = require('../../src/infrastructure/messaging/market-stream/auth-manager').AuthManager;
            mockAuthManager.prototype.getAccountId.mockResolvedValue(mockAccountId);
            mockAuthManager.prototype.authenticate.mockResolvedValue();

            const mockWebSocketManager = require('../../src/infrastructure/messaging/market-stream/websocket-manager').WebSocketManager;
            mockWebSocketManager.prototype.createConnection.mockResolvedValue(mockWebSocket);
            mockWebSocketManager.prototype.getConnection.mockReturnValue(mockWebSocket);
            mockWebSocketManager.prototype.isConnected.mockReturnValue(true);

            const mockSubscriptionManager = require('../../src/infrastructure/messaging/market-stream/subscription-manager').SubscriptionManager;
            mockSubscriptionManager.prototype.getPendingSubscriptions.mockReturnValue(['BTC-PERP@kline_1m']);
            mockSubscriptionManager.prototype.clearPendingSubscription.mockImplementation();

            await marketStreamService.connectToOrderly(['BTC-PERP']);

            expect(mockAuthManager.prototype.getAccountId).toHaveBeenCalled();
            expect(mockWebSocketManager.prototype.createConnection).toHaveBeenCalledWith(mockAccountId);
            expect(mockAuthManager.prototype.authenticate).toHaveBeenCalledWith(mockWebSocket, mockAccountId);
            expect(mockSubscriptionManager.prototype.addPendingSubscription).toHaveBeenCalled();
        });

        it('should handle connection errors gracefully', async () => {
            const mockAuthManager = require('../../src/infrastructure/messaging/market-stream/auth-manager').AuthManager;
            const testError = new Error('Connection failed');
            mockAuthManager.prototype.getAccountId.mockRejectedValue(testError);

            await marketStreamService.connectToOrderly(['BTC-PERP']);

            expect(mockAuthManager.prototype.getAccountId).toHaveBeenCalled();
        });

        it('should handle no account ID returned from auth manager', async () => {
            const mockAuthManager = require('../../src/infrastructure/messaging/market-stream/auth-manager').AuthManager;
            mockAuthManager.prototype.getAccountId.mockResolvedValue(null);

            await marketStreamService.connectToOrderly(['BTC-PERP']);

            expect(mockAuthManager.prototype.getAccountId).toHaveBeenCalled();
            expect(require('../../src/infrastructure/messaging/market-stream/websocket-manager').WebSocketManager.prototype.createConnection).not.toHaveBeenCalled();
        });
    });

    describe('subscription management', () => {
        it('should subscribe and unsubscribe from topics', () => {
            marketStreamService.subscribe('test-client', 'BTC-PERP@kline_1m');
            marketStreamService.unsubscribe('test-client', 'BTC-PERP@kline_1m');

            const mockSubscriptionManager = require('../../src/infrastructure/messaging/market-stream/subscription-manager').SubscriptionManager;
            expect(mockSubscriptionManager.prototype.subscribe).toHaveBeenCalledWith('test-client', 'BTC-PERP@kline_1m');
            expect(mockSubscriptionManager.prototype.unsubscribe).toHaveBeenCalledWith('test-client', 'BTC-PERP@kline_1m');
        });

        it('should handle subscribe and unsubscribe for legacy methods', () => {
            // Test legacy connectToKline
            marketStreamService.connectToKline('BTC-PERP', '1m');
            // Test legacy connectToMarkPrice
            marketStreamService.connectToMarkPrice('BTC-PERP');

            const mockSubscriptionManager = require('../../src/infrastructure/messaging/market-stream/subscription-manager').SubscriptionManager;
            expect(mockSubscriptionManager.prototype.subscribe).toHaveBeenCalledWith('legacy-client', 'BTC-PERP@kline_1m');
            expect(mockSubscriptionManager.prototype.subscribe).toHaveBeenCalledWith('legacy-client', 'BTC-PERP@markprice');
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

            const mockCacheManager = require('../../src/infrastructure/messaging/market-stream/cache-manager').CacheManager;
            mockCacheManager.prototype.getTick.mockResolvedValue(mockTickData);

            const result = await marketStreamService.getLatestTick('BTC-PERP');
            expect(result).toEqual(mockTickData);
            expect(mockCacheManager.prototype.getTick).toHaveBeenCalledWith('BTC-PERP');
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

            const mockCacheManager = require('../../src/infrastructure/messaging/market-stream/cache-manager').CacheManager;
            mockCacheManager.prototype.getKlines.mockResolvedValue(mockKlineData);

            const result = await marketStreamService.getKlines('BTC-PERP', '1m');
            expect(result).toEqual(mockKlineData);
            expect(mockCacheManager.prototype.getKlines).toHaveBeenCalledWith('BTC-PERP', '1m', 300);
        });

        it('should retrieve latest mark price data from cache', async () => {
            const mockMarkPriceData = {
                symbol: 'BTC-PERP',
                price: 50000,
                timestamp: Date.now()
            };

            const mockCacheManager = require('../../src/infrastructure/messaging/market-stream/cache-manager').CacheManager;
            mockCacheManager.prototype.getMarkPrice.mockResolvedValue(mockMarkPriceData);

            const result = await marketStreamService.getLatestMarkPrice('BTC-PERP');
            expect(result).toEqual(mockMarkPriceData);
            expect(mockCacheManager.prototype.getMarkPrice).toHaveBeenCalledWith('BTC-PERP');
        });
    });

    describe('disconnect functionality', () => {
        it('should disconnect all connections cleanly', () => {
            marketStreamService.disconnectAll();

            const mockWebSocketManager = require('../../src/infrastructure/messaging/market-stream/websocket-manager').WebSocketManager;
            const mockSubscriptionManager = require('../../src/infrastructure/messaging/market-stream/subscription-manager').SubscriptionManager;

            expect(mockWebSocketManager.prototype.disconnectAll).toHaveBeenCalled();
            expect(mockSubscriptionManager.prototype.clearAll).toHaveBeenCalled();
        });
    });

    describe('status and statistics', () => {
        it('should return service status with disconnected state', () => {
            const mockWebSocketManager = require('../../src/infrastructure/messaging/market-stream/websocket-manager').WebSocketManager;
            mockWebSocketManager.prototype.isConnected.mockReturnValue(false);

            const mockSubscriptionManager = require('../../src/infrastructure/messaging/market-stream/subscription-manager').SubscriptionManager;
            mockSubscriptionManager.prototype.getStats.mockReturnValue({ active: 0, pending: 0 });
            mockSubscriptionManager.prototype.getPendingSubscriptions.mockReturnValue([]);

            const status = marketStreamService.getStatus();
            expect(status.connected).toBe(false);
            expect(status.websockets).toEqual([]);
            expect(status.pendingSubscriptions).toBe(0);
            expect(status.subscriptionStats).toEqual({ active: 0, pending: 0 });
        });

        it('should return service status with connected state', () => {
            const mockWebSocketManager = require('../../src/infrastructure/messaging/market-stream/websocket-manager').WebSocketManager;
            mockWebSocketManager.prototype.isConnected.mockReturnValue(true);

            const mockSubscriptionManager = require('../../src/infrastructure/messaging/market-stream/subscription-manager').SubscriptionManager;
            mockSubscriptionManager.prototype.getStats.mockReturnValue({ active: 2, pending: 1 });
            mockSubscriptionManager.prototype.getPendingSubscriptions.mockReturnValue(['ETH-PERP@kline_1m']);

            const status = marketStreamService.getStatus();
            expect(status.connected).toBe(true);
            expect(status.websockets).toEqual(['market']);
            expect(status.pendingSubscriptions).toBe(1);
            expect(status.subscriptionStats).toEqual({ active: 2, pending: 1 });
        });

        it('should return detailed service statistics', () => {
            const mockWebSocketManager = require('../../src/infrastructure/messaging/market-stream/websocket-manager').WebSocketManager;
            const mockCacheManager = require('../../src/infrastructure/messaging/market-stream/cache-manager').CacheManager;
            const mockSubscriptionManager = require('../../src/infrastructure/messaging/market-stream/subscription-manager').SubscriptionManager;
            const mockMessageHandler = require('../../src/infrastructure/messaging/market-stream/message-handler').MessageHandler;

            mockWebSocketManager.prototype.getStats.mockReturnValue({ connections: 1, active: true });
            mockCacheManager.prototype.getStats.mockReturnValue({ ticks: 10, klines: 5, markPrices: 3 });
            mockSubscriptionManager.prototype.getDetailedStats.mockReturnValue({ active: 2, topics: ['BTC-PERP@kline_1m'] });
            mockMessageHandler.prototype.getStats.mockReturnValue({ messagesProcessed: 100, errors: 2 });

            const stats = marketStreamService.getDetailedStats();
            expect(stats.websocket).toEqual({ connections: 1, active: true });
            expect(stats.cache).toEqual({ ticks: 10, klines: 5, markPrices: 3 });
            expect(stats.subscriptions).toEqual({ active: 2, topics: ['BTC-PERP@kline_1m'] });
            expect(stats.messageHandler).toEqual({ messagesProcessed: 100, errors: 2 });
        });
    });
});