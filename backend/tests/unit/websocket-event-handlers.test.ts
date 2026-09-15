/** @format */

import { WebSocketEventHandlers } from '../../src/infrastructure/messaging/websocket/handlers';
import { WebSocketError, WebSocketErrorCode, WebSocketUtils } from '../../src/infrastructure/messaging/websocket/types';
import { IRateLimiter, ILogger } from '../../src/interfaces/websocket';

// Mock external dependencies
jest.mock('../../src/core/logging/logger.service');

describe('WebSocketEventHandlers', () => {
    let handlers: WebSocketEventHandlers;
    let mockRateLimiter: jest.Mocked<IRateLimiter>;
    let mockLogger: jest.Mocked<ILogger>;
    let mockSocket: any;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Create mock instances
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

    describe('handleMarketSubscribe (market streaming not available)', () => {
        it('should emit a MARKET_DATA_UNAVAILABLE error for any symbol', async () => {
            await handlers.handleMarketSubscribe(mockSocket, 'PERP_BTC_USDC');

            expect(mockSocket.join).not.toHaveBeenCalled();
            expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.objectContaining({
                event: 'subscribe_market',
                code: WebSocketErrorCode.MARKET_DATA_UNAVAILABLE,
            }));
            expect(mockLogger.warn).toHaveBeenCalled();
        });
    });

    describe('handleMarketUnsubscribe (market streaming not available)', () => {
        it('should be a no-op without error', async () => {
            await handlers.handleMarketUnsubscribe(mockSocket, 'PERP_BTC_USDC');

            expect(mockSocket.leave).not.toHaveBeenCalled();
            expect(mockSocket.emit).not.toHaveBeenCalled();
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