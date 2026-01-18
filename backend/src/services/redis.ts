/** @format */

import { createClient, RedisClientType } from "redis";
import logger from "./logger";

class RedisService {
  private client: RedisClientType;
  private static instance: RedisService;

  private constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
      database: 1, // Use database 1 (was likely used in Docker setup)
    });

    this.client.on("error", err => {
      logger.error("Redis Client Error", { error: err.message });
    });

    this.client.on("connect", () => {
      logger.info("Redis Client Connected");
    });
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      // Explicitly select database 1 after connecting
      await this.client.select(1);
      logger.info("Redis database 1 selected");
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }

  public async get(
    key: string
  ): Promise<{ success: boolean; data: string | null; error?: string }> {
    try {
      const data = await this.client.get(key);
      return { success: true, data };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis GET error", { key, error: errorMessage });
      return { success: false, data: null, error: errorMessage };
    }
  }

  public async set(
    key: string,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.set(key, value);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis SET error", { key, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  public async setex(
    key: string,
    ttl: number,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Use multi command to ensure atomicity
      const multi = this.client.multi();
      multi.set(key, value);
      multi.pExpire(key, ttl * 1000); // pExpire uses milliseconds
      await multi.exec();
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis SETEX error", { key, ttl, error: errorMessage });
      // Fallback to individual commands
      try {
        await this.client.set(key, value);
        await this.client.pExpire(key, ttl * 1000);
        logger.info("Redis SETEX fallback successful", { key, ttl });
        return { success: true };
      } catch (fallbackError) {
        const fallbackErrorMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        logger.error("Redis SETEX fallback error", {
          key,
          ttl,
          error: fallbackErrorMessage,
        });
        return { success: false, error: fallbackErrorMessage };
      }
    }
  }

  public async del(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.del(key);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis DEL error", { key, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  public async exists(
    key: string
  ): Promise<{ success: boolean; data: boolean; error?: string }> {
    try {
      const result = await this.client.exists(key);
      return { success: true, data: result === 1 };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis EXISTS error", { key, error: errorMessage });
      return { success: false, data: false, error: errorMessage };
    }
  }

  /**
   * Check if Redis is currently healthy
   */
  public async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Execute atomic operations using WATCH/MULTI/EXEC
   * This prevents race conditions in concurrent cache updates
   */
  public async watchMultiExec<T>(
    watchKeys: string[],
    operation: (multi: any) => Promise<T>,
    maxRetries: number = 3
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Watch the specified keys for changes
        await this.client.watch(watchKeys);

        // Execute the operation within a transaction
        const multi = this.client.multi();
        const result = await operation(multi);

        // Execute the transaction
        const execResult = await multi.exec();

        // If execResult is null, the transaction was aborted (watched keys changed)
        if (execResult === null) {
          if (attempt < maxRetries - 1) {
            // Exponential backoff before retry
            const delay = Math.pow(2, attempt) * 10; // 10ms, 20ms, 40ms
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          } else {
            return {
              success: false,
              error: `Transaction aborted after ${maxRetries} attempts - concurrent modification detected`
            };
          }
        }

        return { success: true, result };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      } finally {
        // Always unwatch keys
        try {
          await this.client.unwatch();
        } catch (unwatchError) {
          // Ignore unwatch errors
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  /**
   * Atomic cache update with optimistic locking
   */
  public async atomicCacheUpdate(
    key: string,
    data: any,
    versionKey?: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const serializedData = JSON.stringify(data);
    const watchKeys = versionKey ? [key, versionKey] : [key];

    const result = await this.watchMultiExec(
      watchKeys,
      async (multi) => {
        // Get current version if versioning is enabled
        let currentVersion = 0;
        if (versionKey) {
          const versionResult = await this.client.get(versionKey);
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
      maxRetries
    );

    if (result.success) {
      return { success: true, version: result.result };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Get cache with version checking
   */
  public async getWithVersion(
    key: string,
    versionKey?: string
  ): Promise<{ success: boolean; data?: any; version?: number; error?: string }> {
    try {
      let version: number | undefined;

      if (versionKey) {
        const versionResult = await this.get(versionKey);
        if (versionResult.success && versionResult.data) {
          version = parseInt(versionResult.data);
        }
      }

      const dataResult = await this.get(key);
      if (dataResult.success && dataResult.data) {
        try {
          const parsedData = JSON.parse(dataResult.data);
          return { success: true, data: parsedData, version };
        } catch (parseError) {
          return { success: false, error: 'Failed to parse cached data' };
        }
      }

      return { success: false, error: 'Cache miss or data not found' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Invalidate cache keys atomically
   */
  public async atomicInvalidate(
    keys: string[],
    reason: string = 'manual_invalidation'
  ): Promise<{ success: boolean; keysInvalidated: number; error?: string }> {
    if (keys.length === 0) {
      return { success: true, keysInvalidated: 0 };
    }

    try {
      const multi = this.client.multi();

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
      const keysInvalidated = keys.length; // Assume success if exec doesn't fail

      return { success: true, keysInvalidated };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage, keysInvalidated: 0 };
    }
  }

  /**
   * Get cache statistics and health metrics
   */
  public async getCacheStats(): Promise<{
    connected: boolean;
    dbSize?: number;
    memoryUsage?: any;
    hitRate?: number;
    uptime?: number;
    error?: string;
  }> {
    try {
      const isConnected = await this.isHealthy();

      if (!isConnected) {
        return { connected: false, error: 'Redis not connected' };
      }

      // Get database size (number of keys)
      const dbSize = await this.client.dbSize();

      // Get memory information
      const memoryInfo = await this.client.info('memory');
      const uptimeInfo = await this.client.info('server');

      // Parse memory usage (simplified)
      const usedMemory = memoryInfo?.match(/used_memory:(\d+)/)?.[1];
      const uptime = uptimeInfo?.match(/uptime_in_seconds:(\d+)/)?.[1];

      return {
        connected: true,
        dbSize,
        memoryUsage: usedMemory ? parseInt(usedMemory) : undefined,
        uptime: uptime ? parseInt(uptime) : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { connected: false, error: errorMessage };
    }
  }
}

export const redisService = RedisService.getInstance();
