/**
 * Redis Cache Adapter - Clean Architecture Implementation
 *
 * Adapter that implements ICacheService interface using the existing Redis service.
 * This adapter translates between the domain interface and the infrastructure implementation,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    ICacheService,
    CacheResult
} from '../../../shared/src';
import { redisService } from '../../cache/redis.service';

/**
 * Redis Cache Adapter
 *
 * Implements the ICacheService interface using the existing Redis service.
 * Provides a clean abstraction layer for caching operations.
 */
export class RedisCacheAdapter implements ICacheService {

    /**
     * Get a value from cache
     */
    async get<T>(key: string): Promise<CacheResult<T>> {
        try {
            const result = await redisService.get(key);

            if (result.success && result.data) {
                try {
                    // Parse JSON data
                    const parsedData = JSON.parse(result.data) as T;
                    return {
                        success: true,
                        data: parsedData
                    };
                } catch (_parseError) {
                    // If parsing fails, return as string
                    return {
                        success: true,
                        data: result.data as unknown as T
                    };
                }
            } else {
                return {
                    success: false,
                    error: result.error || 'Cache miss'
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Cache get failed: ${errorMessage}`
            };
        }
    }

    /**
     * Set a value in cache with optional TTL
     */
    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<CacheResult<boolean>> {
        try {
            const serializedValue = JSON.stringify(value);

            let result;
            if (ttlSeconds) {
                result = await redisService.setex(key, ttlSeconds, serializedValue);
            } else {
                result = await redisService.set(key, serializedValue);
            }

            if (result.success) {
                return {
                    success: true,
                    data: true
                };
            } else {
                return {
                    success: false,
                    error: result.error || 'Cache set failed'
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Cache set failed: ${errorMessage}`
            };
        }
    }

    /**
     * Delete a value from cache
     */
    async delete(key: string): Promise<CacheResult<boolean>> {
        try {
            const result = await redisService.del(key);

            if (result.success) {
                return {
                    success: true,
                    data: true
                };
            } else {
                return {
                    success: false,
                    error: result.error || 'Cache delete failed'
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Cache delete failed: ${errorMessage}`
            };
        }
    }

    /**
     * Check if a key exists in cache
     */
    async exists(key: string): Promise<CacheResult<boolean>> {
        try {
            const result = await redisService.exists(key);

            if (result.success) {
                return {
                    success: true,
                    data: result.data
                };
            } else {
                return {
                    success: false,
                    error: result.error || 'Cache exists check failed'
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Cache exists check failed: ${errorMessage}`
            };
        }
    }

    /**
     * Set a value with TTL (convenience method)
     */
    async setex<T>(key: string, ttlSeconds: number, value: T): Promise<CacheResult<boolean>> {
        return this.set(key, value, ttlSeconds);
    }

    /**
     * Get multiple values by keys
     */
    async mget<T>(keys: string[]): Promise<CacheResult<Record<string, T>>> {
        try {
            // Redis doesn't have a built-in mget with JSON parsing
            // Implement by making individual get calls
            const results: Record<string, T> = {};

            for (const key of keys) {
                const result = await this.get<T>(key);
                if (result.success && result.data !== undefined) {
                    results[key] = result.data;
                }
            }

            return {
                success: true,
                data: results
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Cache mget failed: ${errorMessage}`
            };
        }
    }

    /**
     * Set multiple values
     */
    async mset<T>(keyValues: Record<string, T>, ttlSeconds?: number): Promise<CacheResult<boolean>> {
        try {
            // Use Redis multi-set operation if available, otherwise individual sets
            const operations = Object.entries(keyValues).map(([key, value]) =>
                this.set(key, value, ttlSeconds)
            );

            const results = await Promise.all(operations);
            const allSuccessful = results.every(result => result.success);

            if (allSuccessful) {
                return {
                    success: true,
                    data: true
                };
            } else {
                const errors = results
                    .filter(result => !result.success)
                    .map(result => result.error)
                    .join('; ');

                return {
                    success: false,
                    error: `Some cache sets failed: ${errors}`
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Cache mset failed: ${errorMessage}`
            };
        }
    }

    /**
     * Atomic conditional update - only set if key doesn't exist or matches expected value
     */
    async atomicConditionalUpdate<T>(
        key: string,
        newValue: T,
        expectedValue?: T | null
    ): Promise<CacheResult<boolean>> {
        try {
            const result = await redisService.atomicConditionalUpdate(
                key,
                newValue,
                expectedValue
            );

            if (result.success) {
                return {
                    success: true,
                    data: result.updated
                };
            } else {
                return {
                    success: false,
                    error: result.error || 'Atomic conditional update failed'
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Atomic conditional update failed: ${errorMessage}`
            };
        }
    }
}

// Export singleton instance
export const redisCacheAdapter = new RedisCacheAdapter();