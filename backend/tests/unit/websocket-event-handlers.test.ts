/** @format */

import { WebSocketEventHandlers } from '../../src/infrastructure/messaging/websocket/handlers';
import { WebSocketError, WebSocketErrorCode, WebSocketUtils } from '../../src/infrastructure/messaging/websocket/types';
import { IMarketStreamService, IRateLimiter, ILogger } from '../../src/interfaces/websocket';

// Mock external dependencies
jest.mock('../../src/core/logging/logger.service');

describe('WebSocketEventHandlers', () => {
    let handlers: WebSocketEventHandlers;
    let mockMarketStreamService: jest.Mocked<IMarketStreamService>;
    let mockRateLimiter: jest.Mocked<IRateLimiter>;
    let mockLogger: jest.Mocked<ILogger>;
    let mockSocket: any;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Create mock instances
        mockMarketStreamService = {
            getLatestTick: jest.fn().mockResolvedValue(null),
            connectToOrderly: jest.fn().mockResolvedValue(undefined)
        } as any;

        mockRateLimiter = {
            canSubscribe: jest.fn().mockResolvedValue(true)
        } as any;

        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        } as any;

        // Create mock socket with client info
        const mockClient = {
            userId: 'test-user-123',
            userLevel: 'VERIFIED',
            subscriptions: new Set<string>(),
            connectedAt: new Date(),
            lastActivity: new Date()
        };

        mockSocket = {
            id: 'socket-123',
            client: mockClient,
            join: jest.fn(),
            leave: jest.fn(),
            emit: jest.fn()
        };

        // Create handlers instance
        handlers = new WebSocketEventHandlers(
            mockMarketStreamService,
            mockRateLimiter,
            mockLogger
        );
    });

    describe('instance creation', () => {
        it('should create an instance of WebSocketEventHandlers', () => {
            expect(handlers).toBeInstanceOf(WebSocketEventHandlers);
        });

        it('should initialize with required dependencies', () => {
            expect(handlers).toBeDefined();
        });
    });

    describe('handleSubscribe', () => {
        it('should subscribe to valid room when rate limit is not exceeded', async () => {
            const validRoom = 'valid-room';

            await handlers.handleSubscribe(mockSocket, validRoom);

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockSocket.join).toHaveBeenCalledWith(validRoom);
            expect(mockSocket.client.subscriptions.has(validRoom)).toBe(true);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should reject subscription when rate limit is exceeded', async () => {
            mockRateLimiter.canSubscribe.mockResolvedValue(false);
            const validRoom = 'valid-room';

            await handlers.handleSubscribe(mockSocket, validRoom);

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.client.subscriptions.has(validRoom)).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should reject subscription with invalid topic format', async () => {
            const invalidRoom = '';

            await handlers.handleSubscribe(mockSocket, invalidRoom);

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.client.subscriptions.has(invalidRoom)).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should reject subscription when subscription limit is exceeded', async () => {
            // Fill subscriptions to max limit
            for (let i = 0; i < 50; i++) {
                mockSocket.client.subscriptions.add(`room-${i}`);
            }

            await handlers.handleSubscribe(mockSocket, 'new-room');

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle unexpected errors during rate limit check', async () => {
            const error = new Error('Unexpected error');
            mockRateLimiter.canSubscribe.mockRejectedValue(error);

            await handlers.handleSubscribe(mockSocket, 'valid-room');

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalled(); // Should log warning, not error
            expect(mockSocket.join).toHaveBeenCalled(); // Should still subscribe (fail open)
            expect(mockSocket.client.subscriptions.has('valid-room')).toBe(true);
            expect(mockSocket.emit).not.toHaveBeenCalledWith('error', expect.anything()); // Should not emit error to client
        });

        it('should handle non-WebSocketError during subscribe', async () => {
            const nonWebSocketError = new Error('Unexpected system error');
            // To trigger the catch block in handleSubscribe, we need to throw the error after checkRateLimit
            mockRateLimiter.canSubscribe.mockResolvedValue(true);
            mockSocket.join.mockImplementation(() => { throw nonWebSocketError; });

            await handlers.handleSubscribe(mockSocket, 'valid-room');

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockSocket.client.subscriptions.has('valid-room')).toBe(false);
        });

        it('should handle non-Error object errors during subscribe', async () => {
            const nonError = 'String error message';
            // To trigger the catch block in handleSubscribe, we need to throw the error after checkRateLimit
            mockRateLimiter.canSubscribe.mockResolvedValue(true);
            mockSocket.join.mockImplementation(() => { throw nonError; });

            await handlers.handleSubscribe(mockSocket, 'valid-room');

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockSocket.client.subscriptions.has('valid-room')).toBe(false);
        });
    });

    describe('handleUnsubscribe', () => {
        it('should unsubscribe from existing room', async () => {
            const room = 'existing-room';
            mockSocket.client.subscriptions.add(room);

            await handlers.handleUnsubscribe(mockSocket, room);

            expect(mockSocket.leave).toHaveBeenCalledWith(room);
            expect(mockSocket.client.subscriptions.has(room)).toBe(false);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should reject unsubscribe from invalid topic format', async () => {
            const invalidRoom = '';

            await handlers.handleUnsubscribe(mockSocket, invalidRoom);

            expect(mockSocket.leave).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should reject unsubscribe from non-subscribed room', async () => {
            const nonSubscribedRoom = 'non-subscribed-room';

            await handlers.handleUnsubscribe(mockSocket, nonSubscribedRoom);

            expect(mockSocket.leave).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle unexpected errors during unsubscribe', async () => {
            const error = new Error('Unexpected error');
            const room = 'existing-room';
            mockSocket.client.subscriptions.add(room);
            mockSocket.leave.mockImplementation(() => { throw error; });

            await handlers.handleUnsubscribe(mockSocket, room);

            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle non-Error object errors during unsubscribe', async () => {
            const nonError = 'String error message';
            const room = 'existing-room';
            mockSocket.client.subscriptions.add(room);
            mockSocket.leave.mockImplementation(() => { throw nonError; });

            await handlers.handleUnsubscribe(mockSocket, room);

            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('handleMarketSubscribe', () => {
        it('should subscribe to valid market symbol', async () => {
            const validSymbol = 'PERP_BTC_USDC';

            await handlers.handleMarketSubscribe(mockSocket, validSymbol);

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockSocket.join).toHaveBeenCalledWith(`market:${validSymbol}`);
            expect(mockSocket.client.subscriptions.has(`market:${validSymbol}`)).toBe(true);
            expect(mockMarketStreamService.getLatestTick).toHaveBeenCalledWith(validSymbol);
            expect(mockMarketStreamService.connectToOrderly).toHaveBeenCalledWith([validSymbol]);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should send initial tick when available', async () => {
            const validSymbol = 'PERP_BTC_USDC';
            const mockTick = {
                symbol: validSymbol,
                price: 50000,
                timestamp: Date.now(),
                volume: 1000,
                bid: 49999,
                ask: 50001,
                change24h: 2.5
            };
            mockMarketStreamService.getLatestTick.mockResolvedValue(mockTick);

            await handlers.handleMarketSubscribe(mockSocket, validSymbol);

            expect(mockSocket.emit).toHaveBeenCalledWith(`market:${validSymbol}`, mockTick);
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should handle failure to get initial tick', async () => {
            const validSymbol = 'PERP_BTC_USDC';
            const error = new Error('Market data unavailable');
            mockMarketStreamService.getLatestTick.mockRejectedValue(error);

            await handlers.handleMarketSubscribe(mockSocket, validSymbol);

            expect(mockLogger.warn).toHaveBeenCalled();
            expect(mockSocket.emit).not.toHaveBeenCalledWith(`market:${validSymbol}`, expect.anything());
        });

        it('should handle failure to connect to Orderly', async () => {
            const validSymbol = 'PERP_BTC_USDC';
            const error = new Error('Connection failed');
            mockMarketStreamService.connectToOrderly.mockRejectedValue(error);

            await handlers.handleMarketSubscribe(mockSocket, validSymbol);

            expect(mockLogger.warn).toHaveBeenCalled();
            expect(mockSocket.client.subscriptions.has(`market:${validSymbol}`)).toBe(true);
        });

        it('should reject subscription to invalid market symbol format', async () => {
            const invalidSymbol = 'BTC-USD';

            await handlers.handleMarketSubscribe(mockSocket, invalidSymbol);

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.client.subscriptions.has(`market:${invalidSymbol}`)).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should reject market subscription when rate limit is exceeded', async () => {
            mockRateLimiter.canSubscribe.mockResolvedValue(false);
            const validSymbol = 'PERP_BTC_USDC';

            await handlers.handleMarketSubscribe(mockSocket, validSymbol);

            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.client.subscriptions.has(`market:${validSymbol}`)).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should reject market subscription when limit is exceeded', async () => {
            for (let i = 0; i < 50; i++) {
                mockSocket.client.subscriptions.add(`market:PERP_${i}_USDC`);
            }

            await handlers.handleMarketSubscribe(mockSocket, 'PERP_NEW_USDC');

            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.client.subscriptions.has('market:PERP_NEW_USDC')).toBe(false);
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle non-WebSocketError during market subscribe', async () => {
            const nonWebSocketError = new Error('Unexpected system error');
            // To trigger the catch block in handleMarketSubscribe, we need to throw the error after checkRateLimit
            mockRateLimiter.canSubscribe.mockResolvedValue(true);
            mockSocket.join.mockImplementation(() => { throw nonWebSocketError; });

            await handlers.handleMarketSubscribe(mockSocket, 'PERP_BTC_USDC');

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockSocket.client.subscriptions.has('market:PERP_BTC_USDC')).toBe(false);
        });

        it('should handle non-Error object errors during market subscribe', async () => {
            const nonError = { custom: 'error' };
            // To trigger the catch block in handleMarketSubscribe, we need to throw the error after checkRateLimit
            mockRateLimiter.canSubscribe.mockResolvedValue(true);
            mockSocket.join.mockImplementation(() => { throw nonError; });

            await handlers.handleMarketSubscribe(mockSocket, 'PERP_BTC_USDC');

            expect(mockRateLimiter.canSubscribe).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockSocket.client.subscriptions.has('market:PERP_BTC_USDC')).toBe(false);
        });
    });

    describe('handleMarketUnsubscribe', () => {
        it('should unsubscribe from existing market symbol', async () => {
            const symbol = 'PERP_BTC_USDC';
            const room = `market:${symbol}`;
            mockSocket.client.subscriptions.add(room);

            await handlers.handleMarketUnsubscribe(mockSocket, symbol);

            expect(mockSocket.leave).toHaveBeenCalledWith(room);
            expect(mockSocket.client.subscriptions.has(room)).toBe(false);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should reject unsubscribe from invalid market symbol format', async () => {
            const invalidSymbol = 'BTC-USD';

            await handlers.handleMarketUnsubscribe(mockSocket, invalidSymbol);

            expect(mockSocket.leave).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should reject unsubscribe from non-subscribed market', async () => {
            const symbol = 'PERP_BTC_USDC';

            await handlers.handleMarketUnsubscribe(mockSocket, symbol);

            expect(mockSocket.leave).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle unexpected errors during market unsubscribe', async () => {
            const error = new Error('Unexpected error');
            const symbol = 'PERP_BTC_USDC';
            const room = `market:${symbol}`;
            mockSocket.client.subscriptions.add(room);
            mockSocket.leave.mockImplementation(() => { throw error; });

            await handlers.handleMarketUnsubscribe(mockSocket, symbol);

            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle non-Error object errors during market unsubscribe', async () => {
            const nonError = { message: 'Custom error object' };
            const symbol = 'PERP_BTC_USDC';
            const room = `market:${symbol}`;
            mockSocket.client.subscriptions.add(room);
            mockSocket.leave.mockImplementation(() => { throw nonError; });

            await handlers.handleMarketUnsubscribe(mockSocket, symbol);

            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.anything());
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('handleDisconnect', () => {
        it('should log client disconnect with appropriate information', async () => {
            await handlers.handleDisconnect(mockSocket);

            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should calculate connected duration correctly on disconnect', async () => {
            const connectedAt = new Date(Date.now() - 10000); // 10 seconds ago
            mockSocket.client.connectedAt = connectedAt;

            await handlers.handleDisconnect(mockSocket);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Client disconnected',
                expect.objectContaining({
                    connectedDuration: expect.any(Number)
                })
            );

            const logCall = (mockLogger.info as jest.Mock).mock.calls[0];
            expect(logCall[1].connectedDuration).toBeGreaterThanOrEqual(10000);
            expect(logCall[1].connectedDuration).toBeLessThan(11000);
        });

        it('should handle disconnect when client has no connectedAt property', async () => {
            // Modify the existing mockSocket to remove connectedAt
            delete mockSocket.client.connectedAt;

            await handlers.handleDisconnect(mockSocket);

            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should handle errors during disconnect', async () => {
            const error = new Error('Failed to clean up');
            mockLogger.info.mockImplementation(() => { throw error; });

            await handlers.handleDisconnect(mockSocket);

            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle errors during disconnect when accessing subscriptions.size throws', async () => {
            // Create a socket with client where subscriptions is undefined
            const socketWithUndefinedSubscriptions = {
                id: 'socket-123',
                client: {
                    userId: 'test-user-123',
                    userLevel: 'VERIFIED',
                    subscriptions: undefined,
                    connectedAt: new Date(),
                    lastActivity: new Date()
                },
                join: jest.fn(),
                leave: jest.fn(),
                emit: jest.fn()
            };

            await handlers.handleDisconnect(socketWithUndefinedSubscriptions as any);

            // Verify that error was logged
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Disconnect handling error',
                expect.objectContaining({
                    socketId: 'socket-123',
                    error: expect.any(Error),
                    correlationId: expect.any(String)
                })
            );
        });
    });
});