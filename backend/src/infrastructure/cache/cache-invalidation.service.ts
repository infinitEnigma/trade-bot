/**
 * Cache Invalidation Service
 *
 * Broadcasts cache invalidation events via WebSocket to notify clients
 * when cached data becomes stale and should be refreshed.
 */

import { Server } from "socket.io";
import { redisService } from "./redis.service";
import { CACHE_EVENTS, CacheEvent, CacheInvalidationEvent, CacheRefreshEvent, CacheClearEvent, CACHE_KEYS } from "../../config/cache.config";
import logger from "../../core/logging/logger.service";

// Export types for infrastructure index
export interface InvalidationRule {
    pattern: string;
    ttl: number;
    priority: 'low' | 'normal' | 'high';
    cascade: boolean;
}

export type CacheStrategy = 'write-through' | 'write-behind' | 'write-around' | 'read-through';

export class CacheInvalidationService {
    private io: Server | null = null;

    /**
     * Initialize with Socket.IO server instance
     */
    setSocketServer(io: Server): void {
        this.io = io;
        logger.info("Cache invalidation service initialized with Socket.IO");
    }

    /**
     * Broadcast cache invalidation event
     */
    async broadcastInvalidation(
        keys: string[],
        reason: string = 'data_updated',
        userId?: string
    ): Promise<void> {
        if (!this.io) {
            logger.warn("Socket.IO not available for cache invalidation broadcast");
            return;
        }

        const event: CacheInvalidationEvent = {
            type: CACHE_EVENTS.INVALIDATED,
            keys,
            reason,
            timestamp: Date.now(),
            userId,
        };

        // Broadcast to all connected clients
        this.io.emit('cache:invalidation', event);

        // Also broadcast to specific user room if userId provided
        if (userId) {
            this.io.to(`user:${userId}`).emit('cache:invalidation', event);
        }

        logger.debug("Cache invalidation broadcasted", {
            keysCount: keys.length,
            keys: keys.slice(0, 5), // Log first 5 keys
            reason,
            userId,
        });
    }

    /**
     * Broadcast cache refresh event
     */
    async broadcastRefresh(
        keys: string[],
        userId?: string
    ): Promise<void> {
        if (!this.io) {
            logger.warn("Socket.IO not available for cache refresh broadcast");
            return;
        }

        const event: CacheRefreshEvent = {
            type: CACHE_EVENTS.REFRESHED,
            keys,
            timestamp: Date.now(),
            userId,
        };

        // Broadcast to all connected clients
        this.io.emit('cache:refresh', event);

        // Also broadcast to specific user room if userId provided
        if (userId) {
            this.io.to(`user:${userId}`).emit('cache:refresh', event);
        }

        logger.debug("Cache refresh broadcasted", {
            keysCount: keys.length,
            keys: keys.slice(0, 5),
            userId,
        });
    }

    /**
     * Broadcast cache clear event
     */
    async broadcastClear(
        pattern: string,
        keysCleared: number,
        userId?: string
    ): Promise<void> {
        if (!this.io) {
            logger.warn("Socket.IO not available for cache clear broadcast");
            return;
        }

        const event: CacheClearEvent = {
            type: CACHE_EVENTS.CLEARED,
            pattern,
            keysCleared,
            timestamp: Date.now(),
            userId,
        };

        // Broadcast to all connected clients
        this.io.emit('cache:clear', event);

        // Also broadcast to specific user room if userId provided
        if (userId) {
            this.io.to(`user:${userId}`).emit('cache:clear', event);
        }

        logger.info("Cache clear broadcasted", {
            pattern,
            keysCleared,
            userId,
        });
    }

    /**
     * Invalidate cache with broadcasting
     */
    async invalidateWithBroadcast(
        keys: string[],
        reason: string = 'data_updated',
        userId?: string
    ): Promise<{ success: boolean; keysInvalidated: number; error?: string }> {
        // First invalidate in Redis
        const result = await redisService.atomicInvalidate(keys, reason);

        if (result.success && result.keysInvalidated > 0) {
            // Then broadcast the invalidation
            await this.broadcastInvalidation(keys, reason, userId);
        }

        return result;
    }

    /**
     * Smart invalidation based on data type
     */
    async invalidateByType(
        dataType: 'market_data' | 'user_data' | 'bot_data' | 'balance_data',
        identifier: string,
        userId?: string
    ): Promise<void> {
        let keys: string[] = [];
        const reason = `${dataType}_updated`;

        switch (dataType) {
            case 'market_data':
                // Invalidate all market data for a symbol
                keys = [
                    CACHE_KEYS.tick(identifier),
                    CACHE_KEYS.markPrice(identifier),
                    CACHE_KEYS.kline(identifier, '1m'),
                    CACHE_KEYS.kline(identifier, '5m'),
                    CACHE_KEYS.kline(identifier, '15m'),
                    CACHE_KEYS.kline(identifier, '30m'),
                    CACHE_KEYS.kline(identifier, '1h'),
                ];
                break;

            case 'user_data':
                // Invalidate user-specific data
                keys = [
                    CACHE_KEYS.session(identifier),
                    CACHE_KEYS.credential(identifier),
                    CACHE_KEYS.position(identifier),
                    CACHE_KEYS.balance(identifier),
                ];
                break;

            case 'bot_data':
                // Invalidate bot-specific data (would need bot ID)
                keys = [
                    `bot:status:${identifier}`,
                    `bot:performance:${identifier}`,
                ];
                break;

            case 'balance_data':
                // Invalidate balance data
                keys = [
                    CACHE_KEYS.balance(identifier),
                ];
                break;
        }

        if (keys.length > 0) {
            await this.invalidateWithBroadcast(keys, reason, userId);
        }
    }

    /**
     * Invalidate all market data (for system-wide updates)
     */
    async invalidateAllMarketData(reason: string = 'system_update'): Promise<void> {
        // This is a simplified implementation
        // In a real system, you might use Redis SCAN to find all market keys
        logger.info("Invalidating all market data", { reason });

        // For now, broadcast a general invalidation event
        // Clients should treat this as "invalidate all cached market data"
        if (this.io) {
            const event: CacheInvalidationEvent = {
                type: CACHE_EVENTS.INVALIDATED,
                keys: ['market:*'], // Pattern matching
                reason,
                timestamp: Date.now(),
            };

            this.io.emit('cache:invalidation', event);
        }
    }

    /**
     * Handle cache events from other services
     */
    async handleCacheEvent(event: CacheEvent): Promise<void> {
        switch (event.type) {
            case CACHE_EVENTS.INVALIDATED:
                await this.broadcastInvalidation(event.keys, event.reason, event.userId);
                break;

            case CACHE_EVENTS.REFRESHED:
                await this.broadcastRefresh(event.keys, event.userId);
                break;

            case CACHE_EVENTS.CLEARED:
                await this.broadcastClear(event.pattern, event.keysCleared, event.userId);
                break;

            default:
                logger.warn("Unknown cache event type", { event });
        }
    }

    /**
     * Get invalidation statistics
     */
    getStats(): {
        socketIoAvailable: boolean;
        connectedClients?: number;
    } {
        return {
            socketIoAvailable: this.io !== null,
            connectedClients: this.io?.engine?.clientsCount,
        };
    }
}

// Export singleton instance
export const cacheInvalidationService = new CacheInvalidationService();
