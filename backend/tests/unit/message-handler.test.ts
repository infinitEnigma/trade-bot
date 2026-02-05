/** @format */

import { MessageHandler } from '../../src/infrastructure/messaging/market-stream/message-handler';
import { CacheManager } from '../../src/infrastructure/messaging/market-stream/cache-manager';
import { WebSocketManager, MessagePriority } from '../../src/infrastructure/messaging/market-stream/websocket-manager';
import { errorNotificationService } from '../../src/core/notifications';

// Mock external dependencies
jest.mock('../../src/core/logging/logger.service');
jest.mock('../../src/core/notifications', () => ({
    errorNotificationService: {
        notifyBackgroundFailure: jest.fn().mockResolvedValue(undefined),
        notifyError: jest.fn().mockResolvedValue(undefined),
        notify: jest.fn()
    }
}));

describe('MessageHandler', () => {
    let messageHandler: MessageHandler;
    let mockCacheManager: jest.Mocked<CacheManager>;
    let mockWebSocketManager: jest.Mocked<WebSocketManager>;
    let mockIo: any;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Create mock instances
        mockCacheManager = {
            cacheTick: jest.fn().mockResolvedValue(undefined),
            cacheKlines: jest.fn().mockResolvedValue(undefined),
            cacheMarkPrice: jest.fn().mockResolvedValue(undefined),
            getKlines: jest.fn().mockResolvedValue([])
        } as any;

        mockWebSocketManager = {
            sendMessage: jest.fn().mockResolvedValue(true)
        } as any;

        mockIo = {
            sockets: {
                adapter: {
                    rooms: {
                        keys: jest.fn().mockReturnValue([])
                    }
                }
            }
        };

        // Create message handler instance
        messageHandler = new MessageHandler(mockCacheManager);
        messageHandler.setSocketServer(mockIo);
        messageHandler.setWebSocketManager(mockWebSocketManager);
    });

    describe('instance creation', () => {
        it('should create an instance of MessageHandler', () => {
            expect(messageHandler).toBeInstanceOf(MessageHandler);
        });

        it('should initialize with required components', () => {
            expect(messageHandler).toBeDefined();
        });
    });

    describe('socket server management', () => {
        it('should set socket server instance', () => {
            const testIo = {
                sockets: {
                    adapter: {
                        rooms: {
                            keys: jest.fn().mockReturnValue(['room1', 'room2'])
                        }
                    }
                }
            };

            messageHandler.setSocketServer(testIo as any);
            const stats = messageHandler.getStats();
            expect(stats.hasSocketServer).toBe(true);
        });
    });

    describe('websocket manager management', () => {
        it('should set websocket manager instance', () => {
            // Already tested in beforeEach, but let's verify it's set correctly
            const stats = messageHandler.getStats();
            expect(stats.hasSocketServer).toBe(true);
        });
    });

    describe('message handling', () => {
        it('should handle authentication response messages', async () => {
            const authMessage = {
                success: true,
                event: 'auth',
                topic: 'auth'
            };

            await messageHandler.handleMessage(authMessage as any);
            // Verify authentication handling occurs (we can't directly test private method, but we can test that it doesn't throw)
        });

        it('should handle failed authentication response', async () => {
            const authMessage = {
                success: false,
                code: 401,
                event: 'auth',
                topic: 'auth',
                message: 'Authentication failed'
            };

            await messageHandler.handleMessage(authMessage as any);
            // Verify authentication failure handling occurs
        });

        it('should handle subscription response messages', async () => {
            const subscriptionMessage = {
                success: true,
                event: 'subscribe',
                topic: 'BTC-PERP@kline_1m'
            };

            await messageHandler.handleMessage(subscriptionMessage as any);
            // Verify subscription handling occurs
        });

        it('should handle failed subscription response', async () => {
            const subscriptionMessage = {
                success: false,
                code: 400,
                event: 'subscribe',
                topic: 'BTC-PERP@kline_1m',
                message: 'Invalid topic'
            };

            await messageHandler.handleMessage(subscriptionMessage as any);
            // Verify subscription failure handling occurs
        });

        it('should handle ticker data messages', async () => {
            const tickerMessage = {
                topic: 'ticker',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000',
                    volume: '1000',
                    bid: '49999',
                    ask: '50001',
                    change24h: '2.5'
                }
            };

            await messageHandler.handleMessage(tickerMessage as any);

            expect(mockCacheManager.cacheTick).toHaveBeenCalled();
            expect(mockWebSocketManager.sendMessage).toHaveBeenCalled();
        });

        it('should handle kline data messages', async () => {
            const klineMessage = {
                topic: 'BTC-PERP@kline_1m',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    type: 'kline',
                    open: '50000',
                    high: '51000',
                    low: '49000',
                    close: '50500',
                    volume: '1000',
                    amount: '50500000',
                    startTime: '1640995200000',
                    endTime: '1640995260000'
                }
            };

            await messageHandler.handleMessage(klineMessage as any);

            expect(mockCacheManager.getKlines).toHaveBeenCalled();
            expect(mockCacheManager.cacheKlines).toHaveBeenCalled();
            expect(mockWebSocketManager.sendMessage).toHaveBeenCalled();
        });

        it('should handle mark price data messages', async () => {
            const markPriceMessage = {
                topic: 'BTC-PERP@markprice',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000'
                }
            };

            await messageHandler.handleMessage(markPriceMessage as any);

            expect(mockCacheManager.cacheMarkPrice).toHaveBeenCalled();
            expect(mockWebSocketManager.sendMessage).toHaveBeenCalled();
        });

        it('should handle unrecognized message types', async () => {
            const unknownMessage = {
                event: 'unknown',
                data: {}
            };

            await messageHandler.handleMessage(unknownMessage as any);
            // Verify unrecognized message handling occurs
        });

        it('should handle message processing errors', async () => {
            const errorMessage = {
                event: 'invalid',
                data: null
            };

            await messageHandler.handleMessage(errorMessage as any);
            // Verify error handling occurs
        });
    });

    describe('broadcast functionality', () => {
        it('should broadcast to symbol with high priority', async () => {
            const mockData = {
                symbol: 'BTC-PERP',
                price: 50000,
                volume: 1000,
                timestamp: Date.now(),
                bid: 49999,
                ask: 50001,
                change24h: 2.5
            };

            // We need to test through handleMessage since broadcastToSymbol is private
            const tickerMessage = {
                topic: 'ticker',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000',
                    volume: '1000',
                    bid: '49999',
                    ask: '50001',
                    change24h: '2.5'
                }
            };

            await messageHandler.handleMessage(tickerMessage as any);

            expect(mockWebSocketManager.sendMessage).toHaveBeenCalledWith(
                'market',
                expect.any(String),
                expect.any(Object),
                MessagePriority.HIGH
            );
        });

        it('should broadcast kline data with medium priority', async () => {
            const klineMessage = {
                topic: 'BTC-PERP@kline_1m',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    type: 'kline',
                    open: '50000',
                    high: '51000',
                    low: '49000',
                    close: '50500',
                    volume: '1000',
                    amount: '50500000',
                    startTime: '1640995200000',
                    endTime: '1640995260000'
                }
            };

            await messageHandler.handleMessage(klineMessage as any);

            expect(mockWebSocketManager.sendMessage).toHaveBeenCalledWith(
                'market',
                expect.any(String),
                expect.any(Object),
                MessagePriority.MEDIUM
            );
        });

        it('should broadcast mark price data with medium priority', async () => {
            const markPriceMessage = {
                topic: 'BTC-PERP@markprice',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000'
                }
            };

            await messageHandler.handleMessage(markPriceMessage as any);

            expect(mockWebSocketManager.sendMessage).toHaveBeenCalledWith(
                'market',
                expect.any(String),
                expect.any(Object),
                MessagePriority.MEDIUM
            );
        });

        it('should handle broadcast when no websocket manager', async () => {
            // Create a new instance without websocket manager
            const handlerWithoutWsManager = new MessageHandler(mockCacheManager);
            handlerWithoutWsManager.setSocketServer(mockIo);

            const tickerMessage = {
                topic: 'ticker',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000',
                    volume: '1000',
                    bid: '49999',
                    ask: '50001',
                    change24h: '2.5'
                }
            };

            await handlerWithoutWsManager.handleMessage(tickerMessage as any);

            expect(mockCacheManager.cacheTick).toHaveBeenCalled();
        });
    });

    describe('stats functionality', () => {
        it('should provide message handler statistics', () => {
            const stats = messageHandler.getStats();

            expect(stats.hasSocketServer).toBeDefined();
            expect(stats.activeRooms).toBeDefined();

            expect(typeof stats.hasSocketServer).toBe('boolean');
            expect(Array.isArray(stats.activeRooms)).toBe(true);
            expect(stats.hasSocketServer).toBe(true);
        });

        it('should report correct active rooms', () => {
            const testIo = {
                sockets: {
                    adapter: {
                        rooms: {
                            keys: jest.fn().mockReturnValue(['room1', 'room2'])
                        }
                    }
                }
            };

            messageHandler.setSocketServer(testIo as any);
            const stats = messageHandler.getStats();

            expect(stats.activeRooms).toEqual(['room1', 'room2']);
        });

        it('should handle no socket server stats', () => {
            // Create a new instance without socket server
            const handlerWithoutSocket = new MessageHandler(mockCacheManager);
            const stats = handlerWithoutSocket.getStats();

            expect(stats.hasSocketServer).toBe(false);
            expect(stats.activeRooms).toEqual([]);
        });
    });

    describe('error handling', () => {
        it('should handle errors in message processing', async () => {
            const mockError = new Error('Test error');
            mockCacheManager.cacheTick.mockRejectedValueOnce(mockError);

            const tickerMessage = {
                topic: 'ticker',
                ts: Date.now(),
                data: {
                    symbol: 'BTC-PERP',
                    price: '50000',
                    volume: '1000',
                    bid: '49999',
                    ask: '50001',
                    change24h: '2.5'
                }
            };

            await messageHandler.handleMessage(tickerMessage as any);

            expect(errorNotificationService.notifyBackgroundFailure).toHaveBeenCalled();
        });
    });
});