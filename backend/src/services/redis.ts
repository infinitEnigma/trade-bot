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

  // ===============================
  // ADVANCED ATOMIC OPERATIONS - RACE CONDITION PROTECTION
  // ===============================

  /**
   * Atomically increment a counter with expiry (prevents race conditions in rate limiting)
   */
  public async atomicIncrementWithExpiry(
    key: string,
    increment: number = 1,
    ttlMs?: number,
    maxRetries: number = 3
  ): Promise<{ success: boolean; newValue: number; error?: string }> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const multi = this.client.multi();

        // Increment the counter
        multi.incrBy(key, increment);

        // Set expiry if this is the first increment (TTL doesn't exist)
        if (ttlMs) {
          // Use Lua script to set expiry only if key didn't exist before
          multi.eval(`
            local count = redis.call('INCRBY', KEYS[1], ARGV[1])
            if count == tonumber(ARGV[1]) then
              redis.call('PEXPIRE', KEYS[1], ARGV[2])
            end
            return count
          `, {
            keys: [key],
            arguments: [increment.toString(), ttlMs.toString()]
          });
        } else {
          multi.incrBy(key, increment);
        }

        const results = await multi.exec();
        const newValue = Array.isArray(results) ? results[results.length - 1] as any : results as any;

        return { success: true, newValue };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // If it's a WATCH conflict, retry
        if (errorMessage.includes('WATCH') && attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 10));
          continue;
        }

        return { success: false, newValue: 0, error: errorMessage };
      }
    }

    return { success: false, newValue: 0, error: 'Max retries exceeded' };
  }

  /**
   * Conditional atomic update - only update if current value matches expected
   */
  public async atomicConditionalUpdate(
    key: string,
    newValue: any,
    expectedValue: any,
    maxRetries: number = 3
  ): Promise<{ success: boolean; updated: boolean; error?: string }> {
    const serializedNewValue = JSON.stringify(newValue);
    const serializedExpectedValue = JSON.stringify(expectedValue);

    const result = await this.watchMultiExec(
      [key],
      async (multi) => {
        // Get current value
        const currentResult = await this.client.get(key);
        const currentValue = currentResult ? JSON.parse(currentResult) : null;

        // Check if current value matches expected
        if (JSON.stringify(currentValue) !== serializedExpectedValue) {
          return { updated: false }; // Condition not met
        }

        // Condition met, perform update
        multi.set(key, serializedNewValue);
        return { updated: true };
      },
      maxRetries
    );

    if (result.success) {
      return { success: true, updated: (result.result as any)?.updated || false };
    } else {
      return { success: false, updated: false, error: result.error };
    }
  }

  /**
   * Atomic read-modify-write operation with custom modifier function
   */
  public async atomicReadModifyWrite<T>(
    key: string,
    modifier: (currentValue: T | null) => T,
    defaultValue?: T,
    maxRetries: number = 3
  ): Promise<{ success: boolean; newValue?: T; error?: string }> {
    const result = await this.watchMultiExec(
      [key],
      async (multi) => {
        // Read current value
        const currentResult = await this.client.get(key);
        let currentValue: T | null = null;

        if (currentResult) {
          try {
            currentValue = JSON.parse(currentResult);
          } catch (parseError) {
            // If parsing fails, treat as null
            currentValue = null;
          }
        }

        // Apply modifier function
        const newValue = modifier(currentValue);

        // Write back new value
        multi.set(key, JSON.stringify(newValue));

        return newValue;
      },
      maxRetries
    );

    if (result.success) {
      return { success: true, newValue: result.result as T };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Atomic balance transfer between two accounts (prevents race conditions in financial operations)
   */
  public async atomicBalanceTransfer(
    fromKey: string,
    toKey: string,
    amount: number,
    checkSufficientFunds: boolean = true,
    maxRetries: number = 3
  ): Promise<{ success: boolean; transferred: boolean; error?: string }> {
    const result = await this.watchMultiExec(
      [fromKey, toKey],
      async (multi) => {
        // Get current balances
        const fromResult = await this.client.get(fromKey);
        const toResult = await this.client.get(toKey);

        const fromBalance = fromResult ? parseFloat(fromResult) : 0;
        const toBalance = toResult ? parseFloat(toResult) : 0;

        // Check sufficient funds if required
        if (checkSufficientFunds && fromBalance < amount) {
          return { transferred: false, reason: 'insufficient_funds' };
        }

        // Perform transfer
        const newFromBalance = fromBalance - amount;
        const newToBalance = toBalance + amount;

        multi.set(fromKey, newFromBalance.toString());
        multi.set(toKey, newToBalance.toString());

        return { transferred: true, fromBalance: newFromBalance, toBalance: newToBalance };
      },
      maxRetries
    );

    if (result.success) {
      const transferResult = result.result as any;
      return {
        success: true,
        transferred: transferResult.transferred,
        error: transferResult.reason
      };
    } else {
      return { success: false, transferred: false, error: result.error };
    }
  }

  /**
   * Atomic version-based update with conflict detection
   */
  public async atomicVersionedUpdate(
    dataKey: string,
    newData: any,
    expectedVersion?: number,
    versionKey?: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; updated: boolean; newVersion?: number; error?: string }> {
    const actualVersionKey = versionKey || `${dataKey}:version`;
    const watchKeys = [dataKey, actualVersionKey];

    const result = await this.watchMultiExec(
      watchKeys,
      async (multi) => {
        // Get current version
        const versionResult = await this.client.get(actualVersionKey);
        const currentVersion = versionResult ? parseInt(versionResult) : 0;

        // Check version if specified
        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
          return { updated: false, reason: 'version_mismatch', currentVersion };
        }

        // Update data and version
        const newVersion = currentVersion + 1;
        multi.set(dataKey, JSON.stringify(newData));
        multi.set(actualVersionKey, newVersion.toString());

        return { updated: true, newVersion };
      },
      maxRetries
    );

    if (result.success) {
      const updateResult = result.result as any;
      return {
        success: true,
        updated: updateResult.updated,
        newVersion: updateResult.newVersion,
        error: updateResult.reason
      };
    } else {
      return { success: false, updated: false, error: result.error };
    }
  }

  /**
   * Atomic optimistic locking update with retry
   */
  public async atomicOptimisticUpdate<T>(
    key: string,
    updateFunction: (currentData: T | null) => T,
    maxRetries: number = 3,
    versionKey?: string
  ): Promise<{ success: boolean; newData?: T; version?: number; error?: string }> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const watchKeys = versionKey ? [key, versionKey] : [key];

        const result = await this.watchMultiExec(
          watchKeys,
          async (multi) => {
            // Read current data and version
            const dataResult = await this.client.get(key);
            let currentData: T | null = null;
            let currentVersion = 0;

            if (dataResult) {
              currentData = JSON.parse(dataResult);
            }

            if (versionKey) {
              const versionResult = await this.client.get(versionKey);
              currentVersion = versionResult ? parseInt(versionResult) : 0;
            }

            // Apply update function
            const newData = updateFunction(currentData);

            // Write back
            multi.set(key, JSON.stringify(newData));
            if (versionKey) {
              multi.set(versionKey, (currentVersion + 1).toString());
            }

            return { newData, version: currentVersion + 1 };
          },
          1 // Single retry per attempt
        );

        if (result.success) {
          const updateResult = result.result as any;
          return {
            success: true,
            newData: updateResult.newData,
            version: updateResult.version
          };
        }

        // If transaction failed due to conflict, retry with backoff
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 10; // 10ms, 20ms, 40ms
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  /**
   * Atomic composite operation on multiple keys
   */
  public async atomicCompositeUpdate(
    updates: Array<{ key: string; value: any; operation?: 'set' | 'incr' | 'decr' }>,
    maxRetries: number = 3
  ): Promise<{ success: boolean; results?: any[]; error?: string }> {
    const watchKeys = updates.map(update => update.key);

    const result = await this.watchMultiExec(
      watchKeys,
      async (multi) => {
        const results: any[] = [];

        for (const update of updates) {
          const { key, value, operation = 'set' } = update;

          switch (operation) {
            case 'set':
              multi.set(key, JSON.stringify(value));
              results.push({ key, operation: 'set', value });
              break;
            case 'incr':
              multi.incrBy(key, value);
              results.push({ key, operation: 'incr', value });
              break;
            case 'decr':
              multi.decrBy(key, value);
              results.push({ key, operation: 'decr', value });
              break;
          }
        }

        return results;
      },
      maxRetries
    );

    if (result.success) {
      return { success: true, results: result.result as any[] };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Get transaction statistics and conflict metrics
   */
  public getTransactionStats(): {
    transactionsAttempted: number;
    transactionsSuccessful: number;
    transactionsFailed: number;
    averageRetryCount: number;
    lastTransactionTime?: number;
  } {
    // This would need to be implemented with actual metrics collection
    // For now, return placeholder stats
    return {
      transactionsAttempted: 0,
      transactionsSuccessful: 0,
      transactionsFailed: 0,
      averageRetryCount: 0,
    };
  }
}

export const redisService = RedisService.getInstance();
