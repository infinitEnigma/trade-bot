/**
 * ===========================================
 * ⚛️ REDIS ATOMIC OPERATIONS
 * ===========================================
 *
 * Advanced atomic operations with conflict resolution.
 * Provides high-level atomic operations for complex use cases.
 *
 * RESPONSIBILITIES:
 * - Atomic increment with expiry
 * - Conditional updates
 * - Balance transfers
 * - Versioned updates
 * - Read-modify-write operations
 *
 * @format
 */

import { RedisConnectionManager } from "./connection-manager";
import { RedisTransactions, TransactionOptions } from "./transactions";
import { redisLogger } from "../../../core/logging/context-aware-logger.service";

export interface AtomicResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    attempts?: number;
}

export interface AtomicIncrementResult {
    success: boolean;
    data?: number;
    error?: string;
    attempts?: number;
}

export interface ConditionalUpdateResult {
    success: boolean;
    data?: boolean;
    error?: string;
    attempts?: number;
}

export interface BalanceTransferResult {
    success: boolean;
    data?: {
        transferred: boolean;
        fromBalance?: number;
        toBalance?: number;
    };
    error?: string;
    attempts?: number;
}

export interface VersionedUpdateResult {
    success: boolean;
    data?: {
        updated: boolean;
        newVersion?: number;
        currentVersion?: number;
    };
    error?: string;
    attempts?: number;
}

export interface ReadModifyWriteResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    attempts?: number;
}

export interface OptimisticUpdateResult<T> {
    success: boolean;
    data?: {
        newData?: T;
        version?: number;
    };
    error?: string;
    attempts?: number;
}

export interface CompositeUpdateResult {
    success: boolean;
    data?: Array<{
        key: string;
        operation: 'set' | 'incr' | 'decr';
        value: unknown;
    }>;
    error?: string;
    attempts?: number;
}

export class RedisAtomicOperations {
    constructor(
        private connectionManager: RedisConnectionManager,
        private transactions: RedisTransactions
    ) { }

    /**
     * Atomic increment with expiry (prevents race conditions in rate limiting)
     */
    async atomicIncrementWithExpiry(
        key: string,
        increment: number = 1,
        ttlMs?: number,
        options?: TransactionOptions
    ): Promise<AtomicResult<number>> {
        const result = await this.transactions.watchMultiExec(
            [key],
            async (multi: unknown) => {
                // Check if key exists and get TTL
                const ttlResult = await this.connectionManager.getClient().pTTL(key);

                if (ttlMs) {
                    // Use Lua script to handle both increment and expiry properly
                    (multi as { eval: (script: string, config: { keys: string[]; arguments: string[] }) => void }).eval(`
                        local count = redis.call('INCRBY', KEYS[1], ARGV[1])
                        local ttl = redis.call('PTTL', KEYS[1])
                        
                        -- Set expiry if this is the first increment or TTL is negative (key exists but no TTL)
                        if count == tonumber(ARGV[1]) or ttl < 0 then
                            redis.call('PEXPIRE', KEYS[1], ARGV[2])
                        end
                        
                        return count
                    `, {
                        keys: [key],
                        arguments: [increment.toString(), ttlMs.toString()]
                    });
                } else {
                    (multi as { incrBy: (key: string, increment: number) => void }).incrBy(key, increment);
                }

                return increment; // Return the increment amount
            },
            3, // Max 3 retries for rate limiting
            { ...options, context: 'atomic_increment' }
        );

        if (result.success) {
            // Get the final value
            const getResult = await this.connectionManager.getClient().get(key);
            const finalValue = getResult ? parseInt(getResult) : 0;

            return { success: true, data: finalValue };
        } else {
            redisLogger.error("Atomic increment failed", undefined, { key, error: result.error, attempts: result.attempts });
            return { success: false, error: result.error, attempts: result.attempts };
        }
    }

    /**
     * Conditional atomic update - only update if current value matches expected
     */
    async atomicConditionalUpdate(
        key: string,
        newValue: unknown,
        expectedValue: unknown,
        options?: TransactionOptions
    ): Promise<AtomicResult<boolean>> {
        const serializedNewValue = JSON.stringify(newValue);
        const serializedExpectedValue = JSON.stringify(expectedValue);

        const result = await this.transactions.watchMultiExec(
            [key],
            async (multi: unknown) => {
                // Get current value
                const currentResult = await this.connectionManager.getClient().get(key);
                const currentValue = currentResult ? JSON.parse(currentResult) : null;

                // Check if current value matches expected
                if (JSON.stringify(currentValue) !== serializedExpectedValue) {
                    return { updated: false, reason: 'value_mismatch' };
                }

                // Condition met, perform update
                (multi as { set: (key: string, value: string) => void }).set(key, serializedNewValue);
                return { updated: true };
            },
            3,
            { ...options, context: 'conditional_update' }
        );

        if (result.success) {
            const updateResult = result.result as { updated: boolean; reason?: string };
            return {
                success: true,
                data: updateResult.updated,
                error: updateResult.reason
            };
        } else {
            redisLogger.error("Conditional update failed", undefined, { key, error: result.error, attempts: result.attempts });
            return { success: false, error: result.error, attempts: result.attempts };
        }
    }

    /**
     * Atomic balance transfer between two accounts
     */
    async atomicBalanceTransfer(
        fromKey: string,
        toKey: string,
        amount: number,
        checkSufficientFunds: boolean = true,
        options?: TransactionOptions
    ): Promise<AtomicResult<{ transferred: boolean; fromBalance?: number; toBalance?: number }>> {
        const result = await this.transactions.watchMultiExec(
            [fromKey, toKey],
            async (multi: unknown) => {
                // Get current balances
                const fromResult = await this.connectionManager.getClient().get(fromKey);
                const toResult = await this.connectionManager.getClient().get(toKey);

                const fromBalance = fromResult ? parseFloat(fromResult) : 0;
                const toBalance = toResult ? parseFloat(toResult) : 0;

                // Check sufficient funds if required
                if (checkSufficientFunds && fromBalance < amount) {
                    return { transferred: false, reason: 'insufficient_funds' };
                }

                // Perform transfer
                const newFromBalance = fromBalance - amount;
                const newToBalance = toBalance + amount;

                (multi as { set: (key: string, value: string) => void }).set(fromKey, newFromBalance.toString());
                (multi as { set: (key: string, value: string) => void }).set(toKey, newToBalance.toString());

                return {
                    transferred: true,
                    fromBalance: newFromBalance,
                    toBalance: newToBalance
                };
            },
            5, // Higher retries for financial operations
            { ...options, context: 'balance_transfer', priority: 'high' }
        );

        if (result.success) {
            const transferResult = result.result as { transferred: boolean; reason?: string; fromBalance: number; toBalance: number };
            return {
                success: true,
                data: {
                    transferred: transferResult.transferred,
                    fromBalance: transferResult.fromBalance,
                    toBalance: transferResult.toBalance
                },
                error: transferResult.reason
            };
        } else {
            redisLogger.error("Balance transfer failed", undefined, { fromKey, toKey, error: result.error, attempts: result.attempts });
            return {
                success: false,
                error: result.error,
                attempts: result.attempts,
                data: { transferred: false }
            };
        }
    }

    /**
     * Atomic versioned update with conflict detection
     */
    async atomicVersionedUpdate(
        dataKey: string,
        newData: unknown,
        expectedVersion?: number,
        versionKey?: string,
        options?: TransactionOptions
    ): Promise<AtomicResult<{ updated: boolean; newVersion?: number; currentVersion?: number }>> {
        const actualVersionKey = versionKey || `${dataKey}:version`;
        const watchKeys = [dataKey, actualVersionKey];

        const result = await this.transactions.watchMultiExec(
            watchKeys,
            async (multi: unknown) => {
                // Get current version
                const versionResult = await this.connectionManager.getClient().get(actualVersionKey);
                const currentVersion = versionResult ? parseInt(versionResult) : 0;

                // Check version if specified
                if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
                    return { updated: false, reason: 'version_mismatch', currentVersion };
                }

                // Update data and version
                const newVersion = currentVersion + 1;
                (multi as { set: (key: string, value: string) => void }).set(dataKey, JSON.stringify(newData));
                (multi as { set: (key: string, value: string) => void }).set(actualVersionKey, newVersion.toString());

                return { updated: true, newVersion };
            },
            3,
            { ...options, context: 'versioned_update' }
        );

        if (result.success) {
            const updateResult = result.result as { updated: boolean; reason?: string; newVersion: number; currentVersion?: number };
            return {
                success: true,
                data: {
                    updated: updateResult.updated,
                    newVersion: updateResult.newVersion,
                    currentVersion: updateResult.currentVersion
                },
                error: updateResult.reason
            };
        } else {
            redisLogger.error("Versioned update failed", undefined, { dataKey, versionKey, error: result.error, attempts: result.attempts });
            return {
                success: false,
                error: result.error,
                attempts: result.attempts,
                data: { updated: false }
            };
        }
    }

    /**
     * Atomic read-modify-write operation with custom modifier function
     */
    async atomicReadModifyWrite<T>(
        key: string,
        modifier: (currentValue: T | null) => T,
        defaultValue?: T,
        options?: TransactionOptions
    ): Promise<AtomicResult<T>> {
        const result = await this.transactions.watchMultiExec(
            [key],
            async (multi: unknown) => {
                // Read current value
                const currentResult = await this.connectionManager.getClient().get(key);
                let currentValue: T | null = null;

                if (currentResult) {
                    try {
                        currentValue = JSON.parse(currentResult);
                    } catch (_parseError) {
                        // If parsing fails, treat as null
                        redisLogger.warn("Failed to parse cached data", { key, error: "JSON parse error" });
                        currentValue = null;
                    }
                }

                // Apply modifier function
                const newValue = modifier(currentValue);

                // Write back new value
                (multi as { set: (key: string, value: string) => void }).set(key, JSON.stringify(newValue));

                return newValue;
            },
            3,
            { ...options, context: 'read_modify_write' }
        );

        if (result.success) {
            return { success: true, data: result.result as T };
        } else {
            redisLogger.error("Read-modify-write failed", undefined, { key, error: result.error, attempts: result.attempts });
            return { success: false, error: result.error, attempts: result.attempts };
        }
    }

    /**
     * Atomic optimistic locking update with retry
     */
    async atomicOptimisticUpdate<T>(
        key: string,
        updateFunction: (currentData: T | null) => T,
        maxRetries: number = 3,
        versionKey?: string,
        options?: TransactionOptions
    ): Promise<AtomicResult<{ newData?: T; version?: number }>> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const watchKeys = versionKey ? [key, versionKey] : [key];

                const result = await this.transactions.watchMultiExec(
                    watchKeys,
                    async (multi: unknown) => {
                        // Read current data and version
                        const dataResult = await this.connectionManager.getClient().get(key);
                        let currentData: T | null = null;
                        let currentVersion = 0;

                        if (dataResult) {
                            currentData = JSON.parse(dataResult);
                        }

                        if (versionKey) {
                            const versionResult = await this.connectionManager.getClient().get(versionKey);
                            currentVersion = versionResult ? parseInt(versionResult) : 0;
                        }

                        // Apply update function
                        const newData = updateFunction(currentData);

                        // Write back
                        (multi as { set: (key: string, value: string) => void }).set(key, JSON.stringify(newData));
                        if (versionKey) {
                            (multi as { set: (key: string, value: string) => void }).set(versionKey, (currentVersion + 1).toString());
                        }

                        return { newData, version: currentVersion + 1 };
                    },
                    1, // Single retry per attempt
                    { ...options, context: 'optimistic_update' }
                );

                if (result.success) {
                    const updateResult = result.result as { newData: T; version: number };
                    return {
                        success: true,
                        data: {
                            newData: updateResult.newData,
                            version: updateResult.version
                        }
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
                redisLogger.error("Optimistic update failed", undefined, { key, error: errorMessage, attempt });
                return { success: false, error: errorMessage };
            }
        }

        redisLogger.error("Optimistic update max retries exceeded", undefined, { key, maxRetries });
        return { success: false, error: 'Max retries exceeded' };
    }

    /**
     * Atomic composite operation on multiple keys
     */
    async atomicCompositeUpdate(
        updates: Array<{ key: string; value: unknown; operation?: 'set' | 'incr' | 'decr' }>,
        options?: TransactionOptions
    ): Promise<AtomicResult<Array<{ key: string; operation: 'set' | 'incr' | 'decr'; value: unknown }>>> {
        const watchKeys = updates.map(update => update.key);

        const result = await this.transactions.watchMultiExec(
            watchKeys,
            async (multi: unknown) => {
                const results: Array<{ key: string; operation: 'set' | 'incr' | 'decr'; value: unknown }> = [];

                for (const update of updates) {
                    const { key, value, operation = 'set' } = update;

                    switch (operation) {
                        case 'set':
                            (multi as { set: (key: string, value: string) => void }).set(key, JSON.stringify(value));
                            results.push({ key, operation: 'set', value });
                            break;
                        case 'incr':
                            (multi as { incrBy: (key: string, increment: number) => void }).incrBy(key, value as number);
                            results.push({ key, operation: 'incr', value });
                            break;
                        case 'decr':
                            (multi as { decrBy: (key: string, decrement: number) => void }).decrBy(key, value as number);
                            results.push({ key, operation: 'decr', value });
                            break;
                    }
                }

                return results;
            },
            3,
            { ...options, context: 'composite_update' }
        );

        if (result.success) {
            return { success: true, data: result.result as Array<{ key: string; operation: 'set' | 'incr' | 'decr'; value: unknown }> };
        } else {
            redisLogger.error(`Composite update failed: ${result.error}`, undefined, { keys: watchKeys.join(','), attempts: result.attempts });
            return { success: false, error: result.error, attempts: result.attempts };
        }
    }
}
