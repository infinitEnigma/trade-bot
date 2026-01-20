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
import { logger } from "../../../core/logging";

export interface AtomicResult<T = any> {
    success: boolean;
    data?: T;
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
            async (multi) => {
                // Increment the counter
                multi.incrBy(key, increment);

                // Set expiry if this is the first increment (TTL doesn't exist before)
                if (ttlMs) {
                    // Use Lua script to set expiry only if key didn't exist
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
            return { success: false, error: result.error, attempts: result.attempts };
        }
    }

    /**
     * Conditional atomic update - only update if current value matches expected
     */
    async atomicConditionalUpdate(
        key: string,
        newValue: any,
        expectedValue: any,
        options?: TransactionOptions
    ): Promise<AtomicResult<boolean>> {
        const serializedNewValue = JSON.stringify(newValue);
        const serializedExpectedValue = JSON.stringify(expectedValue);

        const result = await this.transactions.watchMultiExec(
            [key],
            async (multi) => {
                // Get current value
                const currentResult = await this.connectionManager.getClient().get(key);
                const currentValue = currentResult ? JSON.parse(currentResult) : null;

                // Check if current value matches expected
                if (JSON.stringify(currentValue) !== serializedExpectedValue) {
                    return { updated: false, reason: 'value_mismatch' };
                }

                // Condition met, perform update
                multi.set(key, serializedNewValue);
                return { updated: true };
            },
            3,
            { ...options, context: 'conditional_update' }
        );

        if (result.success) {
            const updateResult = result.result as any;
            return {
                success: true,
                data: updateResult.updated,
                error: updateResult.reason
            };
        } else {
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
            async (multi) => {
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

                multi.set(fromKey, newFromBalance.toString());
                multi.set(toKey, newToBalance.toString());

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
            const transferResult = result.result as any;
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
        newData: any,
        expectedVersion?: number,
        versionKey?: string,
        options?: TransactionOptions
    ): Promise<AtomicResult<{ updated: boolean; newVersion?: number; currentVersion?: number }>> {
        const actualVersionKey = versionKey || `${dataKey}:version`;
        const watchKeys = [dataKey, actualVersionKey];

        const result = await this.transactions.watchMultiExec(
            watchKeys,
            async (multi) => {
                // Get current version
                const versionResult = await this.connectionManager.getClient().get(actualVersionKey);
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
            3,
            { ...options, context: 'versioned_update' }
        );

        if (result.success) {
            const updateResult = result.result as any;
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
            async (multi) => {
                // Read current value
                const currentResult = await this.connectionManager.getClient().get(key);
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
            3,
            { ...options, context: 'read_modify_write' }
        );

        if (result.success) {
            return { success: true, data: result.result as T };
        } else {
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
                    async (multi) => {
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
                        multi.set(key, JSON.stringify(newData));
                        if (versionKey) {
                            multi.set(versionKey, (currentVersion + 1).toString());
                        }

                        return { newData, version: currentVersion + 1 };
                    },
                    1, // Single retry per attempt
                    { ...options, context: 'optimistic_update' }
                );

                if (result.success) {
                    const updateResult = result.result as any;
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
                return { success: false, error: errorMessage };
            }
        }

        return { success: false, error: 'Max retries exceeded' };
    }

    /**
     * Atomic composite operation on multiple keys
     */
    async atomicCompositeUpdate(
        updates: Array<{ key: string; value: any; operation?: 'set' | 'incr' | 'decr' }>,
        options?: TransactionOptions
    ): Promise<AtomicResult<any[]>> {
        const watchKeys = updates.map(update => update.key);

        const result = await this.transactions.watchMultiExec(
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
            3,
            { ...options, context: 'composite_update' }
        );

        if (result.success) {
            return { success: true, data: result.result as any[] };
        } else {
            return { success: false, error: result.error, attempts: result.attempts };
        }
    }
}
