/** @format */

import { CacheInvalidationService, cacheInvalidationService } from '../../src/infrastructure/cache/cache-invalidation.service';
import { redisService } from '../../src/infrastructure/cache/redis.service';
import logger from '../../src/core/logging/logger.service';
import { CACHE_EVENTS, CACHE_KEYS } from '../../src/config/cache.config';

// Mock dependencies
jest.mock('../../src/infrastructure/cache/redis.service');
jest.mock('../../src/core/logging/logger.service');

describe('CacheInvalidationService', () => {
    let service: CacheInvalidationService;
    let mockIo: any;

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();

        // Create fresh instance for each test
        service = new CacheInvalidationService();

        // Create mock Socket.IO server
        mockIo = {
            emit: jest.fn().mockResolvedValue(true),
            to: jest.fn().mockReturnThis(),
            engine: {
                clientsCount: 5
            }
        };
    });

    describe('instance creation', () => {
        it('should create an instance of CacheInvalidationService', () => {
            expect(service).toBeInstanceOf(CacheInvalidationService);
        });

        it('should export a singleton instance', () => {
            expect(cacheInvalidationService).toBeInstanceOf(CacheInvalidationService);
            expect(cacheInvalidationService).toBeDefined();
        });
    });

    describe('setSocketServer', () => {
        it('should set the Socket.IO server instance', () => {
            service.setSocketServer(mockIo);
            const stats = service.getStats();
            expect(stats.socketIoAvailable).toBe(true);
            expect(logger.info).toHaveBeenCalledWith('Cache invalidation service initialized with Socket.IO');
        });
    });

    describe('broadcastInvalidation', () => {
        it('should broadcast cache invalidation event to all clients', async () => {
            service.setSocketServer(mockIo);
            const keys = ['test-key-1', 'test-key-2'];
            const reason = 'data_updated';

            await service.broadcastInvalidation(keys, reason);

            expect(mockIo.emit).toHaveBeenCalledWith('cache:invalidation', expect.objectContaining({
                type: CACHE_EVENTS.INVALIDATED,
                keys,
                reason
            }));
            expect(logger.debug).toHaveBeenCalled();
        });

        it('should broadcast cache invalidation event to specific user room when userId provided', async () => {
            service.setSocketServer(mockIo);
            const keys = ['test-key-1'];
            const reason = 'data_updated';
            const userId = 'user-123';

            await service.broadcastInvalidation(keys, reason, userId);

            expect(mockIo.to).toHaveBeenCalledWith(`user:${userId}`);
            expect(mockIo.to().emit).toHaveBeenCalled();
        });

        it('should log warning and return when Socket.IO not available', async () => {
            // Do not set socket server
            const keys = ['test-key-1'];

            await service.broadcastInvalidation(keys);

            expect(logger.warn).toHaveBeenCalledWith('Socket.IO not available for cache invalidation broadcast');
            expect(mockIo.emit).not.toHaveBeenCalled();
        });
    });

    describe('broadcastRefresh', () => {
        it('should broadcast cache refresh event to all clients', async () => {
            service.setSocketServer(mockIo);
            const keys = ['test-key-1', 'test-key-2'];

            await service.broadcastRefresh(keys);

            expect(mockIo.emit).toHaveBeenCalledWith('cache:refresh', expect.objectContaining({
                type: CACHE_EVENTS.REFRESHED,
                keys
            }));
            expect(logger.debug).toHaveBeenCalled();
        });

        it('should broadcast cache refresh event to specific user room when userId provided', async () => {
            service.setSocketServer(mockIo);
            const keys = ['test-key-1'];
            const userId = 'user-123';

            await service.broadcastRefresh(keys, userId);

            expect(mockIo.to).toHaveBeenCalledWith(`user:${userId}`);
            expect(mockIo.to().emit).toHaveBeenCalled();
        });

        it('should log warning and return when Socket.IO not available', async () => {
            const keys = ['test-key-1'];

            await service.broadcastRefresh(keys);

            expect(logger.warn).toHaveBeenCalledWith('Socket.IO not available for cache refresh broadcast');
            expect(mockIo.emit).not.toHaveBeenCalled();
        });
    });

    describe('broadcastClear', () => {
        it('should broadcast cache clear event to all clients', async () => {
            service.setSocketServer(mockIo);
            const pattern = 'test:*';
            const keysCleared = 10;

            await service.broadcastClear(pattern, keysCleared);

            expect(mockIo.emit).toHaveBeenCalledWith('cache:clear', expect.objectContaining({
                type: CACHE_EVENTS.CLEARED,
                pattern,
                keysCleared
            }));
            expect(logger.info).toHaveBeenCalled();
        });

        it('should broadcast cache clear event to specific user room when userId provided', async () => {
            service.setSocketServer(mockIo);
            const pattern = 'test:*';
            const keysCleared = 5;
            const userId = 'user-123';

            await service.broadcastClear(pattern, keysCleared, userId);

            expect(mockIo.to).toHaveBeenCalledWith(`user:${userId}`);
            expect(mockIo.to().emit).toHaveBeenCalled();
        });

        it('should log warning and return when Socket.IO not available', async () => {
            const pattern = 'test:*';
            const keysCleared = 0;

            await service.broadcastClear(pattern, keysCleared);

            expect(logger.warn).toHaveBeenCalledWith('Socket.IO not available for cache clear broadcast');
            expect(mockIo.emit).not.toHaveBeenCalled();
        });
    });

    describe('invalidateWithBroadcast', () => {
        it('should invalidate keys in Redis and broadcast when successful', async () => {
            service.setSocketServer(mockIo);
            const keys = ['test-key-1', 'test-key-2'];
            const reason = 'data_updated';
            const mockResult = { success: true, keysInvalidated: 2 };

            const mockAtomicInvalidate = jest.fn().mockResolvedValue(mockResult);
            (redisService.atomicInvalidate as jest.Mock) = mockAtomicInvalidate;

            const result = await service.invalidateWithBroadcast(keys, reason);

            expect(mockAtomicInvalidate).toHaveBeenCalledWith(keys, reason);
            expect(mockIo.emit).toHaveBeenCalled();
            expect(result).toEqual(mockResult);
        });

        it('should return result without broadcasting when invalidation fails', async () => {
            service.setSocketServer(mockIo);
            const keys = ['test-key-1'];
            const reason = 'data_updated';
            const mockResult = { success: false, keysInvalidated: 0, error: 'Redis error' };

            const mockAtomicInvalidate = jest.fn().mockResolvedValue(mockResult);
            (redisService.atomicInvalidate as jest.Mock) = mockAtomicInvalidate;

            const result = await service.invalidateWithBroadcast(keys, reason);

            expect(mockAtomicInvalidate).toHaveBeenCalledWith(keys, reason);
            expect(mockIo.emit).not.toHaveBeenCalled();
            expect(result).toEqual(mockResult);
        });

        it('should return result without broadcasting when no keys invalidated', async () => {
            service.setSocketServer(mockIo);
            const keys = ['test-key-1'];
            const reason = 'data_updated';
            const mockResult = { success: true, keysInvalidated: 0 };

            const mockAtomicInvalidate = jest.fn().mockResolvedValue(mockResult);
            (redisService.atomicInvalidate as jest.Mock) = mockAtomicInvalidate;

            const result = await service.invalidateWithBroadcast(keys, reason);

            expect(mockAtomicInvalidate).toHaveBeenCalledWith(keys, reason);
            expect(mockIo.emit).not.toHaveBeenCalled();
            expect(result).toEqual(mockResult);
        });
    });

    describe('invalidateByType', () => {
        it('should invalidate market data keys when dataType is market_data', async () => {
            service.setSocketServer(mockIo);
            const symbol = 'BTCUSDT';
            const mockInvalidateWithBroadcast = jest.fn().mockResolvedValue({
                success: true,
                keysInvalidated: 7
            });
            service.invalidateWithBroadcast = mockInvalidateWithBroadcast;

            await service.invalidateByType('market_data', symbol);

            expect(mockInvalidateWithBroadcast).toHaveBeenCalled();
            const calledKeys = (mockInvalidateWithBroadcast.mock.calls[0][0] as string[]);
            expect(calledKeys).toEqual([
                CACHE_KEYS.tick(symbol),
                CACHE_KEYS.markPrice(symbol),
                CACHE_KEYS.kline(symbol, '1m'),
                CACHE_KEYS.kline(symbol, '5m'),
                CACHE_KEYS.kline(symbol, '15m'),
                CACHE_KEYS.kline(symbol, '30m'),
                CACHE_KEYS.kline(symbol, '1h'),
            ]);
        });

        it('should invalidate user data keys when dataType is user_data', async () => {
            service.setSocketServer(mockIo);
            const userId = 'user-123';
            const mockInvalidateWithBroadcast = jest.fn().mockResolvedValue({
                success: true,
                keysInvalidated: 4
            });
            service.invalidateWithBroadcast = mockInvalidateWithBroadcast;

            await service.invalidateByType('user_data', userId);

            expect(mockInvalidateWithBroadcast).toHaveBeenCalled();
            const calledKeys = (mockInvalidateWithBroadcast.mock.calls[0][0] as string[]);
            expect(calledKeys).toEqual([
                CACHE_KEYS.session(userId),
                CACHE_KEYS.credential(userId),
                CACHE_KEYS.position(userId),
                CACHE_KEYS.balance(userId),
            ]);
        });

        it('should invalidate bot data keys when dataType is bot_data', async () => {
            service.setSocketServer(mockIo);
            const botId = 'bot-456';
            const mockInvalidateWithBroadcast = jest.fn().mockResolvedValue({
                success: true,
                keysInvalidated: 2
            });
            service.invalidateWithBroadcast = mockInvalidateWithBroadcast;

            await service.invalidateByType('bot_data', botId);

            expect(mockInvalidateWithBroadcast).toHaveBeenCalled();
            const calledKeys = (mockInvalidateWithBroadcast.mock.calls[0][0] as string[]);
            expect(calledKeys).toEqual([
                `bot:status:${botId}`,
                `bot:performance:${botId}`,
            ]);
        });

        it('should invalidate balance data keys when dataType is balance_data', async () => {
            service.setSocketServer(mockIo);
            const userId = 'user-123';
            const mockInvalidateWithBroadcast = jest.fn().mockResolvedValue({
                success: true,
                keysInvalidated: 1
            });
            service.invalidateWithBroadcast = mockInvalidateWithBroadcast;

            await service.invalidateByType('balance_data', userId);

            expect(mockInvalidateWithBroadcast).toHaveBeenCalled();
            const calledKeys = (mockInvalidateWithBroadcast.mock.calls[0][0] as string[]);
            expect(calledKeys).toEqual([
                CACHE_KEYS.balance(userId),
            ]);
        });
    });

    describe('invalidateAllMarketData', () => {
        it('should broadcast general market data invalidation event', async () => {
            service.setSocketServer(mockIo);
            const reason = 'system_update';

            await service.invalidateAllMarketData(reason);

            expect(logger.info).toHaveBeenCalledWith('Invalidating all market data', { reason });
            expect(mockIo.emit).toHaveBeenCalledWith('cache:invalidation', expect.objectContaining({
                type: CACHE_EVENTS.INVALIDATED,
                keys: ['market:*'],
                reason
            }));
        });

        it('should log info without emitting when Socket.IO not available', async () => {
            const reason = 'system_update';

            await service.invalidateAllMarketData(reason);

            expect(logger.info).toHaveBeenCalled();
            expect(mockIo.emit).not.toHaveBeenCalled();
        });
    });

    describe('handleCacheEvent', () => {
        it('should handle INVALIDATED cache event', async () => {
            service.setSocketServer(mockIo);
            const mockBroadcastInvalidation = jest.fn().mockResolvedValue(undefined);
            service.broadcastInvalidation = mockBroadcastInvalidation;
            const event = {
                type: CACHE_EVENTS.INVALIDATED,
                keys: ['test-key'],
                reason: 'test_reason',
                timestamp: Date.now(),
                userId: 'user-123'
            };

            await service.handleCacheEvent(event);

            expect(mockBroadcastInvalidation).toHaveBeenCalledWith(event.keys, event.reason, event.userId);
        });

        it('should handle REFRESHED cache event', async () => {
            service.setSocketServer(mockIo);
            const mockBroadcastRefresh = jest.fn().mockResolvedValue(undefined);
            service.broadcastRefresh = mockBroadcastRefresh;
            const event = {
                type: CACHE_EVENTS.REFRESHED,
                keys: ['test-key'],
                timestamp: Date.now(),
                userId: 'user-123'
            };

            await service.handleCacheEvent(event);

            expect(mockBroadcastRefresh).toHaveBeenCalledWith(event.keys, event.userId);
        });

        it('should handle CLEARED cache event', async () => {
            service.setSocketServer(mockIo);
            const mockBroadcastClear = jest.fn().mockResolvedValue(undefined);
            service.broadcastClear = mockBroadcastClear;
            const event = {
                type: CACHE_EVENTS.CLEARED,
                pattern: 'test:*',
                keysCleared: 5,
                timestamp: Date.now(),
                userId: 'user-123'
            };

            await service.handleCacheEvent(event);

            expect(mockBroadcastClear).toHaveBeenCalledWith(event.pattern, event.keysCleared, event.userId);
        });

        it('should log warning for unknown cache event type', async () => {
            const unknownEvent = {
                type: 'unknown:cache:event',
                timestamp: Date.now()
            };

            await service.handleCacheEvent(unknownEvent as any);

            expect(logger.warn).toHaveBeenCalledWith('Unknown cache event type', { event: unknownEvent });
        });
    });

    describe('getStats', () => {
        it('should return socket availability and connected clients when Socket.IO available', () => {
            service.setSocketServer(mockIo);

            const stats = service.getStats();

            expect(stats.socketIoAvailable).toBe(true);
            expect(stats.connectedClients).toBe(mockIo.engine.clientsCount);
        });

        it('should return socket unavailable when Socket.IO not set', () => {
            const stats = service.getStats();

            expect(stats.socketIoAvailable).toBe(false);
            expect(stats.connectedClients).toBeUndefined();
        });
    });
});