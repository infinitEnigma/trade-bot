/**
 * ===========================================
 * 💾 REDIS CACHE MANAGER
 * ===========================================
 *
 * Manages cache operations with atomic updates and conflict resolution.
 * Provides high-level caching operations with transaction safety.
 *
 * RESPONSIBILITIES:
 * - Cache data storage and retrieval
 * - Atomic cache updates
 * - Cache versioning and consistency
 * - Cache invalidation operations
 *
 * @format
 */

import { RedisConnectionManager } from "./connection-manager";
import { RedisTransactions, TransactionOptions } from "./transactions";
import { RedisResult } from "./operations";
import logger from "../logger";

export interface CacheResult<T = any> {
    success: boolean;
    data?: T | null;
    version?: number;
    error?: string;
    fromCache?: boolean;
}

export class RedisCacheManager {
    constructor(
        private connectionManager: RedisConnectionManager,
        private transactions: RedisTransactions
    ) { }

    /**
     * Store data in cache with optional TTL
     */
    async set(
        key: string,
        data: any,
        ttlSeconds?: number,
        options?: TransactionOptions
    ): Promise<CacheResult> {
        try {
            const serializedData = JSON.stringify(data);
            const result = ttlSeconds ?
                await this.connectionManager.getClient().setEx(key, ttlSeconds, serializedData) :
                await this.connectionManager.getClient().set(key, serializedData);

            if (result === 'OK') {
                return { success: true };
            } else {
                return { success: false, error: 'Cache set failed' };
            }
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Cache set error", { key, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Get data from cache
     */
    async get<T = any>(key: string): Promise<CacheResult<T>> {
        try {
            const result = await this.connectionManager.getClient().get(key);

            if (result === null) {
                return { success: true, data: null, fromCache: false };
            }

            try {
                const parsedData = JSON.parse(result);
                return { success: true, data: parsedData, fromCache: true };
            } catch (parseError) {
                logger.warn("Cache parse error", { key, error: (parseError as Error).message });
                return { success: false, error: 'Failed to parse cached data' };
            }
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Cache get error", { key, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Atomic cache update with conflict resolution
     */
    async atomicCacheUpdate(
        key: string,
        data: any,
        versionKey?: string,
        maxRetries: number = 3,
        options?: TransactionOptions
    ): Promise<CacheResult<number>> {
        const serializedData = JSON.stringify(data);
        const watchKeys = versionKey ? [key, versionKey] : [key];

        const result = await this.transactions.watchMultiExec(
            watchKeys,
            async (multi) => {
                // Get current version if versioning is enabled
                let currentVersion = 0;
                if (versionKey) {
                    const versionResult = await this.connectionManager.getClient().get(versionKey);
                    currentVersion = versionResult ? parseInt(versionResult) : 0;
                }

                // Set the cache data
                multi.set(key, serializedData);

                // Update version if versioning is enabled
                if (versionKey) {
                    multi.set(versionKey, (currentVersion + 1).toString());
                }

                return currentVersion + 1;
            },
            maxRetries,
            { ...options, context: 'cache_update' }
        );

        if (result.success) {
            return { success: true, version: result.result as number };
        } else {
            return { success: false, error: result.error };
        }
    }

    /**
     * Get cache entry with version checking
     */
    async getWithVersion<T = any>(
        key: string,
        versionKey?: string
    ): Promise<CacheResult<T>> {
        try {
            let version: number | undefined;

            if (versionKey) {
                const versionResult = await this.connectionManager.getClient().get(versionKey);
                if (versionResult) {
                    version = parseInt(versionResult);
                }
            }

            const dataResult = await this.get<T>(key);
            if (dataResult.success && dataResult.data !== null) {
                // Add version to the data object
                const dataWithVersion = { ...dataResult.data as any, version };
                return {
                    success: true,
                    data: dataWithVersion,
                    version,
                    fromCache: dataResult.fromCache
                };
            }

            return { success: false, error: 'Cache miss or data not found' };
        } catch (error) {
            const errorMessage = (error as Error).message;
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Atomic cache invalidation
     */
    async atomicInvalidate(
        keys: string[],
        reason: string = 'manual_invalidation'
    ): Promise<CacheResult<number>> {
        if (keys.length === 0) {
            return { success: true, data: 0 };
        }

        try {
            const multi = this.connectionManager.getClient().multi();

            // Delete all specified keys
            keys.forEach(key => multi.del(key));

            // Add invalidation metadata (optional)
            const invalidationKey = `invalidation:${Date.now()}`;
            multi.setEx(invalidationKey, 300, JSON.stringify({
                keys,
                reason,
                timestamp: new Date().toISOString()
            }));

            const results = await multi.exec();
            const keysInvalidated = keys.length;

            return { success: true, data: keysInvalidated };
        } catch (error) {
            const errorMessage = (error as Error).message;
            return { success: false, error: errorMessage, data: 0 };
        }
    }

    /**
     * Cache multiple key-value pairs
     */
    async mset(
        keyValues: Record<string, any>,
        ttlSeconds?: number,
        options?: TransactionOptions
    ): Promise<CacheResult> {
        try {
            const serializedValues: Record<string, string> = {};

            // Serialize all values
            for (const [key, value] of Object.entries(keyValues)) {
                serializedValues[key] = JSON.stringify(value);
            }

            const client = this.connectionManager.getClient();

            if (ttlSeconds) {
                // For TTL, use individual setEx operations
                const promises = Object.entries(serializedValues).map(([key, value]) =>
                    client.setEx(key, ttlSeconds, value)
                );
                await Promise.all(promises);
            } else {
                await client.mSet(serializedValues);
            }

            return { success: true };
        } catch (error) {
            const errorMessage = (error as Error).message;
            const keys = Object.keys(keyValues).join(',');
            logger.error("Cache mset error", { keys, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Get multiple cache entries
     */
    async mget<T = any>(keys: string[]): Promise<CacheResult<Record<string, T>>> {
        try {
            const client = this.connectionManager.getClient();
            const values = await client.mGet(keys);
            const result: Record<string, T> = {};

            keys.forEach((key, index) => {
                const value = values[index];
                if (value !== null) {
                    try {
                        result[key] = JSON.parse(value);
                    } catch (parseError) {
                        logger.warn("Cache parse error for key", {
                            key,
                            error: (parseError as Error).message
                        });
                    }
                }
            });

            return { success: true, data: result, fromCache: true };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Cache mget error", { keys: keys.join(','), error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Check if key exists in cache
     */
    async exists(key: string): Promise<CacheResult<boolean>> {
        try {
            const client = this.connectionManager.getClient();
            const result = await client.exists(key);
            const exists = result === 1;

            return { success: true, data: exists };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Cache exists error", { key, error: errorMessage });
            return { success: false, error: errorMessage, data: false };
        }
    }

    /**
     * Get cache key TTL
     */
    async ttl(key: string): Promise<CacheResult<number>> {
        try {
            const client = this.connectionManager.getClient();
            const ttl = await client.ttl(key);

            return { success: true, data: ttl };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Cache TTL error", { key, error: errorMessage });
            return { success: false, error: errorMessage, data: -1 };
        }
    }
}
