/**
 * ===========================================
 * 🔧 REDIS OPERATIONS
 * ===========================================
 *
 * Handles basic Redis operations (GET, SET, DEL, EXISTS).
 * Provides consistent error handling and result formatting.
 *
 * RESPONSIBILITIES:
 * - Basic key-value operations
 * - Consistent result formatting
 * - Error handling and logging
 * - Type safety for operations
 *
 * @format
 */

import { RedisConnectionManager } from "./connection-manager";
import logger from "../logger";

export interface RedisResult<T = string | null> {
    success: boolean;
    data?: T;
    error?: string;
}

export class RedisOperations {
    constructor(private connectionManager: RedisConnectionManager) { }

    /**
     * Get value by key
     */
    async get(key: string): Promise<RedisResult> {
        try {
            const client = this.connectionManager.getClient();
            const data = await client.get(key);

            return { success: true, data };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis GET error", { key, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Set value for key
     */
    async set(key: string, value: string): Promise<RedisResult> {
        try {
            const client = this.connectionManager.getClient();
            await client.set(key, value);

            return { success: true };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis SET error", { key, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Set value with expiry (TTL)
     */
    async setex(key: string, ttl: number, value: string): Promise<RedisResult> {
        try {
            const client = this.connectionManager.getClient();

            // Use atomic set + expire
            const multi = client.multi();
            multi.set(key, value);
            multi.pExpire(key, ttl * 1000); // pExpire uses milliseconds
            await multi.exec();

            return { success: true };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis SETEX error", { key, ttl, error: errorMessage });

            // Fallback to individual commands
            try {
                const client = this.connectionManager.getClient();
                await client.set(key, value);
                await client.pExpire(key, ttl * 1000);
                logger.info("Redis SETEX fallback successful", { key, ttl });
                return { success: true };
            } catch (fallbackError) {
                const fallbackErrorMessage = (fallbackError as Error).message;
                logger.error("Redis SETEX fallback error", {
                    key,
                    ttl,
                    error: fallbackErrorMessage,
                });
                return { success: false, error: fallbackErrorMessage };
            }
        }
    }

    /**
     * Delete key(s)
     */
    async del(key: string | string[]): Promise<RedisResult<number>> {
        try {
            const client = this.connectionManager.getClient();
            const keys = Array.isArray(key) ? key : [key];
            const deletedCount = await client.del(keys);

            return { success: true, data: deletedCount };
        } catch (error) {
            const errorMessage = (error as Error).message;
            const keyStr = Array.isArray(key) ? key.join(',') : key;
            logger.error("Redis DEL error", { keys: keyStr, error: errorMessage });
            return { success: false, error: errorMessage, data: 0 };
        }
    }

    /**
     * Check if key exists
     */
    async exists(key: string): Promise<RedisResult<boolean>> {
        try {
            const client = this.connectionManager.getClient();
            const result = await client.exists(key);
            const exists = result === 1;

            return { success: true, data: exists };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis EXISTS error", { key, error: errorMessage });
            return { success: false, error: errorMessage, data: false };
        }
    }

    /**
     * Get multiple keys
     */
    async mget(keys: string[]): Promise<RedisResult<string[]>> {
        try {
            const client = this.connectionManager.getClient();
            const values = await client.mGet(keys);
            const results = values.map(v => v || "");

            return { success: true, data: results };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis MGET error", { keys: keys.join(','), error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Set multiple key-value pairs
     */
    async mset(keyValues: Record<string, string>): Promise<RedisResult> {
        try {
            const client = this.connectionManager.getClient();
            await client.mSet(keyValues);

            return { success: true };
        } catch (error) {
            const errorMessage = (error as Error).message;
            const keys = Object.keys(keyValues).join(',');
            logger.error("Redis MSET error", { keys, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Increment a number
     */
    async incr(key: string): Promise<RedisResult<number>> {
        try {
            const client = this.connectionManager.getClient();
            const newValue = await client.incr(key);

            return { success: true, data: newValue };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis INCR error", { key, error: errorMessage });
            return { success: false, error: errorMessage, data: 0 };
        }
    }

    /**
     * Increment by specific amount
     */
    async incrBy(key: string, increment: number): Promise<RedisResult<number>> {
        try {
            const client = this.connectionManager.getClient();
            const newValue = await client.incrBy(key, increment);

            return { success: true, data: newValue };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis INCRBY error", { key, increment, error: errorMessage });
            return { success: false, error: errorMessage, data: 0 };
        }
    }

    /**
     * Decrement by specific amount
     */
    async decrBy(key: string, decrement: number): Promise<RedisResult<number>> {
        try {
            const client = this.connectionManager.getClient();
            const newValue = await client.decrBy(key, decrement);

            return { success: true, data: newValue };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis DECRBY error", { key, decrement, error: errorMessage });
            return { success: false, error: errorMessage, data: 0 };
        }
    }

    /**
     * Set expiry on key
     */
    async expire(key: string, ttlSeconds: number): Promise<RedisResult<boolean>> {
        try {
            const client = this.connectionManager.getClient();
            const result = await client.expire(key, ttlSeconds);
            const success = result === 1;

            return { success: true, data: success };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis EXPIRE error", { key, ttlSeconds, error: errorMessage });
            return { success: false, error: errorMessage, data: false };
        }
    }

    /**
     * Set expiry on key (milliseconds)
     */
    async pExpire(key: string, ttlMs: number): Promise<RedisResult<boolean>> {
        try {
            const client = this.connectionManager.getClient();
            const result = await client.pExpire(key, ttlMs);
            const success = result === 1;

            return { success: true, data: success };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis PEXPIRE error", { key, ttlMs, error: errorMessage });
            return { success: false, error: errorMessage, data: false };
        }
    }

    /**
     * Get time to live for key
     */
    async ttl(key: string): Promise<RedisResult<number>> {
        try {
            const client = this.connectionManager.getClient();
            const ttl = await client.ttl(key);

            return { success: true, data: ttl };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis TTL error", { key, error: errorMessage });
            return { success: false, error: errorMessage, data: -1 };
        }
    }

    /**
     * Get keys matching pattern
     */
    async keys(pattern: string): Promise<RedisResult<string[]>> {
        try {
            const client = this.connectionManager.getClient();
            const keys = await client.keys(pattern);

            return { success: true, data: keys };
        } catch (error) {
            const errorMessage = (error as Error).message;
            logger.error("Redis KEYS error", { pattern, error: errorMessage });
            return { success: false, error: errorMessage };
        }
    }
}
