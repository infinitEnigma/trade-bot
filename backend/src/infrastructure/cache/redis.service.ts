/**
 * ===========================================
 * REDIS SERVICE - THIN FACADE
 * ===========================================
 *
 * Backward-compatible facade over the modular Redis components in
 * ./redis/*. All behavior lives in the components; this class only adapts
 * legacy return shapes and exposes the singleton used across the backend.
 *
 * COMPONENTS:
 * - RedisConnectionManager: Connection lifecycle and health (sole client owner)
 * - RedisOperations: Basic key-value operations
 * - RedisTransactions: Intelligent transaction recovery
 * - RedisAtomicOperations: Advanced atomic operations
 * - RedisCacheManager: Cache operations with versioning
 * - RedisMetrics: Statistics and health monitoring
 * - RedisStreamOperations: Streams for engine-backend messaging
 *
 * BACKWARD COMPATIBILITY:
 * - All existing methods preserved (same names, params, result shapes)
 * - getClient() returns the manager-owned shared client (raw SET NX / Lua
 *   escape hatch for auth middleware + tests)
 * - Zero breaking changes for existing consumers
 *
 * @format
 */

import type { RedisClientType } from "redis";
import { redisLogger as logger } from "../../core/logging/context-aware-logger.service";

// Export cache types
export interface CacheConfig {
  ttl: number;
  maxSize?: number;
  strategy?: 'lru' | 'lfu' | 'ttl';
  compression?: boolean;
}

/**
 * Cache metadata interface to replace loose any typing
 */
export interface CacheMetadata {
  [key: string]: unknown;
  createdAt?: number;
  updatedAt?: number;
  source?: string;
  tags?: string[];
  version?: string;
  custom?: Record<string, unknown>;
}

/**
 * Cache entry with proper typing
 */
export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  expiresAt?: number;
  metadata?: CacheMetadata;
}

/**
 * Redis Multi command interface for type safety
 */
export interface RedisMultiCommand {
  set: (key: string, value: string) => RedisMultiCommand;
  get: (key: string) => RedisMultiCommand;
  del: (key: string | string[]) => RedisMultiCommand;
  incrBy: (key: string, increment: number) => RedisMultiCommand;
  decrBy: (key: string, decrement: number) => RedisMultiCommand;
  pExpire: (key: string, ttlMs: number) => RedisMultiCommand;
  expire: (key: string, ttlSeconds: number) => RedisMultiCommand;
  eval: (script: string, options: { keys: string[]; arguments: string[] }) => RedisMultiCommand;
  exec: () => Promise<unknown[] | null>;
}

/**
 * Redis transaction operation callback with proper typing
 */
export type RedisOperationCallback<T> = (multi: RedisMultiCommand) => Promise<T>;

/**
 * Redis transaction result type
 */
export type RedisTransactionResult<T> = {
  success: boolean;
  result?: T;
  error?: string;
  attempts?: number;
  totalDelay?: number;
  strategy?: string;
};

// Import components directly to avoid circular dependencies
import { RedisConnectionManager } from "./redis/connection-manager";
import { RedisOperations } from "./redis/operations";
import { RedisTransactions, TransactionOptions } from "./redis/transactions";
import { RedisAtomicOperations } from "./redis/atomic-operations";
import { RedisCacheManager } from "./redis/cache-manager";
import { RedisMetrics } from "./redis/metrics";
import { RedisStreamOperations } from "./redis/streams";

class RedisService {
  // Core components (single Redis connection owned by the connection manager)
  private connectionManager: RedisConnectionManager;
  private operations: RedisOperations;
  private transactions: RedisTransactions;
  private atomicOps: RedisAtomicOperations;
  private cacheManager: RedisCacheManager;
  private metrics: RedisMetrics;
  private streamOperations: RedisStreamOperations;

  private static instance: RedisService;

  private constructor() {
    // Single shared connection: the manager owns the only Redis client.
    this.connectionManager = new RedisConnectionManager();
    this.operations = new RedisOperations(this.connectionManager);
    this.transactions = new RedisTransactions(this.connectionManager);
    this.atomicOps = new RedisAtomicOperations(this.connectionManager, this.transactions);
    this.cacheManager = new RedisCacheManager(this.connectionManager, this.transactions);
    this.metrics = new RedisMetrics(this.connectionManager);
    this.streamOperations = new RedisStreamOperations(this.connectionManager);

    logger.info("Redis service initialized with enterprise architecture");
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  public async connect(): Promise<void> {
    await this.connectionManager.connect();
  }

  public async disconnect(): Promise<void> {
    await this.connectionManager.disconnect();
  }

  /**
   * Cleanup method for test environments
   * Disconnects client and clears any retry intervals
   */
  cleanupForTests(): void {
    try {
      void this.connectionManager.disconnect();
      logger.info("Redis service cleaned up for tests");
    } catch (error) {
      logger.error("Error during Redis cleanup", error as Error);
    }
  }

  public async get(
    key: string
  ): Promise<{ success: boolean; data: string | null; error?: string }> {
    const result = await this.operations.get(key);
    return { success: result.success, data: result.data ?? null, error: result.error };
  }

  public async set(
    key: string,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    const result = await this.operations.set(key, value);
    return { success: result.success, error: result.error };
  }

  public async setex(
    key: string,
    ttl: number,
    value: string
  ): Promise<{ success: boolean; error?: string }> {
    const result = await this.operations.setex(key, ttl, value);
    return { success: result.success, error: result.error };
  }

  public async del(key: string): Promise<{ success: boolean; error?: string }> {
    const result = await this.operations.del(key);
    return { success: result.success, error: result.error };
  }

  public async exists(
    key: string
  ): Promise<{ success: boolean; data: boolean; error?: string }> {
    const result = await this.operations.exists(key);
    return { success: result.success, data: result.data ?? false, error: result.error };
  }

  public async ttl(
    key: string
  ): Promise<{ success: boolean; ttl: number; error?: string }> {
    const result = await this.operations.ttl(key);
    return { success: result.success, ttl: result.data ?? -1, error: result.error };
  }

  /**
   * Scan Redis for keys matching a pattern (safer than KEYS for large datasets)
   */
  public async scan(
    cursor: string = '0',
    options: { MATCH?: string; COUNT?: number } = {}
  ): Promise<{ success: boolean; cursor: string; keys: string[]; error?: string }> {
    try {
      const result = await this.getClient().scan(cursor, options);
      return { success: true, cursor: result.cursor, keys: result.keys };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Redis SCAN error", error as Error, { cursor, options });
      return { success: false, cursor: '0', keys: [], error: errorMessage };
    }
  }

  /**
   * Check if Redis is currently healthy
   */
  public async isHealthy(): Promise<boolean> {
    // Legacy semantics preserved: probe the live connection directly rather
    // than trusting cached health flags (tests spy on client.ping()).
    try {
      const client = this.connectionManager.getClient();
      await client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Legacy raw-client escape hatch (auth mutex, tests).
   * Returns the single shared client owned by the connection manager.
   */
  public getClient(): RedisClientType {
    return this.connectionManager.getClient();
  }

  /**
   * Get stream operations instance
   */
  public get streamOps(): RedisStreamOperations {
    return this.streamOperations;
  }

  // Thin facade over the shared recovery manager in redis/transactions
  // (inline duplicate removed; see git history for the old implementation).

  /**
   * Execute atomic operations with intelligent conflict resolution
   */
  public async watchMultiExec<T>(
    watchKeys: string[],
    operation: RedisOperationCallback<T>,
    maxRetries: number = 5,
    options?: TransactionOptions
  ): Promise<RedisTransactionResult<T>> {
    const result = await this.transactions.watchMultiExec(
      watchKeys,
      operation as (multi: unknown) => Promise<T>,
      maxRetries,
      options
    );
    return {
      success: result.success,
      result: result.result,
      error: result.error,
      attempts: result.attempts,
      totalDelay: result.totalDelay,
      strategy: result.strategy,
    };
  }

  /**
   * Atomic cache update with optimistic locking
   */
  public async atomicCacheUpdate(
    key: string,
    data: unknown,
    versionKey?: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    const result = await this.cacheManager.atomicCacheUpdate(key, data, versionKey, maxRetries);
    return { success: result.success, version: result.version, error: result.error };
  }

  /**
   * Get cache with version checking
   */
  public async getWithVersion(
    key: string,
    versionKey?: string
  ): Promise<{ success: boolean; data?: unknown; version?: number; error?: string }> {
    const result = await this.cacheManager.getWithVersion<unknown>(key, versionKey);
    return {
      success: result.success,
      data: result.data ?? undefined,
      version: result.version,
      error: result.error,
    };
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

    const result = await this.cacheManager.atomicInvalidate(keys, reason);
    return {
      success: result.success,
      keysInvalidated: result.success ? (result.data ?? 0) : 0,
      error: result.error,
    };
  }

  /**
   * Get cache statistics and health metrics
   */
  public async getCacheStats(): Promise<{
    connected: boolean;
    dbSize?: number;
    memoryUsage?: unknown;
    hitRate?: number;
    uptime?: number;
    error?: string;
  }> {
    try {
      const stats = await this.metrics.getCacheStats();

      return {
        connected: stats.connected,
        dbSize: stats.dbSize,
        memoryUsage: stats.memoryUsage,
        uptime: stats.uptime,
        error: stats.error,
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
    const result = await this.atomicOps.atomicIncrementWithExpiry(key, increment, ttlMs, {
      context: 'atomic_increment',
    });
    void maxRetries;
    if (result.success) {
      return { success: true, newValue: result.data ?? 0 };
    }
    return { success: false, newValue: 0, error: result.error };
  }

  /**
   * Conditional atomic update - only update if current value matches expected
   */
  public async atomicConditionalUpdate(
    key: string,
    newValue: unknown,
    expectedValue: unknown,
    maxRetries: number = 3
  ): Promise<{ success: boolean; updated: boolean; error?: string }> {
    const result = await this.atomicOps.atomicConditionalUpdate(key, newValue, expectedValue, {
      context: 'conditional_update',
    });
    void maxRetries;
    if (result.success) {
      return { success: true, updated: result.data ?? false };
    }
    return { success: false, updated: false, error: result.error };
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
    const result = await this.atomicOps.atomicReadModifyWrite<T>(key, modifier, defaultValue, {
      context: 'read_modify_write',
    });
    void maxRetries;
    if (result.success) {
      return { success: true, newValue: result.data };
    }
    return { success: false, error: result.error };
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
    const result = await this.atomicOps.atomicBalanceTransfer(fromKey, toKey, amount, checkSufficientFunds, {
      context: 'balance_transfer',
    });
    void maxRetries;
    if (result.success) {
      return {
        success: true,
        transferred: result.data?.transferred ?? false,
        error: result.error,
      };
    }
    return { success: false, transferred: false, error: result.error };
  }

  /**
   * Atomic version-based update with conflict detection
   */
  public async atomicVersionedUpdate(
    dataKey: string,
    newData: unknown,
    expectedVersion?: number,
    versionKey?: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; updated: boolean; newVersion?: number; error?: string }> {
    const result = await this.atomicOps.atomicVersionedUpdate(dataKey, newData, expectedVersion, versionKey, {
      context: 'versioned_update',
    });
    void maxRetries;
    if (result.success) {
      return {
        success: true,
        updated: result.data?.updated ?? false,
        newVersion: result.data?.newVersion,
        error: result.error,
      };
    }
    return { success: false, updated: false, error: result.error };
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
    const result = await this.atomicOps.atomicOptimisticUpdate<T>(
      key,
      updateFunction,
      maxRetries,
      versionKey,
      { context: 'optimistic_update' }
    );
    if (result.success) {
      return {
        success: true,
        newData: result.data?.newData,
        version: result.data?.version,
      };
    }
    return { success: false, error: result.error };
  }

  /**
   * Atomic composite operation on multiple keys
   */
  public async atomicCompositeUpdate(
    updates: Array<{ key: string; value: unknown; operation?: 'set' | 'incr' | 'decr' }>,
    maxRetries: number = 3
  ): Promise<{ success: boolean; results?: Array<{ key: string; operation: string; value: unknown }>; error?: string }> {
    const result = await this.atomicOps.atomicCompositeUpdate(updates, {
      context: 'composite_update',
    });
    void maxRetries;
    if (result.success) {
      return {
        success: true,
        results: (result.data ?? []).map(entry => ({
          key: entry.key,
          operation: entry.operation as string,
          value: entry.value,
        })),
      };
    }
    return { success: false, error: result.error };
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
    return this.metrics.getTransactionStats();
  }

  /**
   * Get recovery manager statistics (delegates to the shared component).
   */
  getRecoveryStats() {
    return this.transactions.getRecoveryStats();
  }
}

export const redisService = RedisService.getInstance();
