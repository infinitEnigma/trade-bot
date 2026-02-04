/**
 * ===========================================
 * 📊 REDIS METRICS
 * ===========================================
 *
 * Collects and provides statistics and monitoring for Redis operations.
 * Tracks performance, conflicts, and usage patterns.
 *
 * RESPONSIBILITIES:
 * - Transaction statistics
 * - Cache performance metrics
 * - Conflict tracking and analysis
 * - Health monitoring and reporting
 *
 * @format
 */

import { RedisConnectionManager } from "./connection-manager";

export interface CacheStats {
    connected: boolean;
    dbSize?: number;
    memoryUsage?: number;
    uptime?: number;
    error?: string;
}

export interface TransactionStats {
    transactionsAttempted: number;
    transactionsSuccessful: number;
    transactionsFailed: number;
    averageRetryCount: number;
    lastTransactionTime?: number;
}

export interface ConflictStats {
    totalConflicts: number;
    recentConflicts: number;
    successRate: number;
    averageDelay: number;
    lastConflictTime: number;
}

export class RedisMetrics {
    private transactionStats = {
        transactionsAttempted: 0,
        transactionsSuccessful: 0,
        transactionsFailed: 0,
        averageRetryCount: 0,
        lastTransactionTime: undefined as number | undefined,
    };

    private conflictStats = {
        totalConflicts: 0,
        recentConflicts: 0,
        successRate: 1,
        averageDelay: 0,
        lastConflictTime: 0,
    };

    constructor(private connectionManager: RedisConnectionManager) { }

    /**
     * Record transaction attempt
     */
    recordTransactionAttempt(success: boolean, attempts: number, _totalDelay: number): void {
        this.transactionStats.transactionsAttempted++;
        this.transactionStats.lastTransactionTime = Date.now();

        if (success) {
            this.transactionStats.transactionsSuccessful++;
        } else {
            this.transactionStats.transactionsFailed++;
        }

        // Update average retry count
        this.transactionStats.averageRetryCount =
            (this.transactionStats.averageRetryCount + attempts) / 2;
    }

    /**
     * Record transaction conflict
     */
    recordConflict(_attempts: number): void {
        this.conflictStats.totalConflicts++;

        // Check if recent (last 5 minutes)
        const now = Date.now();
        if (this.conflictStats.lastConflictTime === 0 || now - this.conflictStats.lastConflictTime < 5 * 60 * 1000) {
            this.conflictStats.recentConflicts++;
        }

        this.conflictStats.lastConflictTime = now;
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<CacheStats> {
        try {
            const isConnected = await this.connectionManager.isHealthy();

            if (!isConnected) {
                return { connected: false, error: 'Redis not connected' };
            }

            const client = this.connectionManager.getClient();

            // Get database size (number of keys)
            const dbSize = await client.dbSize();

            // Get memory information
            const memoryInfo = await client.info('memory');
            const uptimeInfo = await client.info('server');

            // Parse memory usage
            const usedMemoryMatch = memoryInfo?.match(/used_memory:(\d+)/);
            const usedMemory = usedMemoryMatch ? parseInt(usedMemoryMatch[1]) : undefined;

            // Parse uptime
            const uptimeMatch = uptimeInfo?.match(/uptime_in_seconds:(\d+)/);
            const uptime = uptimeMatch ? parseInt(uptimeMatch[1]) : undefined;

            return {
                connected: true,
                dbSize,
                memoryUsage: usedMemory,
                uptime,
            };
        } catch (error) {
            const errorMessage = (error as Error).message;
            return { connected: false, error: errorMessage };
        }
    }

    /**
     * Get transaction statistics
     */
    getTransactionStats(): TransactionStats {
        return { ...this.transactionStats };
    }

    /**
     * Get conflict statistics
     */
    getConflictStats(): ConflictStats {
        // Calculate success rate
        const totalAttempts = this.transactionStats.transactionsAttempted;
        const successful = this.transactionStats.transactionsSuccessful;
        const successRate = totalAttempts > 0 ? successful / totalAttempts : 1;

        return {
            ...this.conflictStats,
            successRate,
        };
    }

    /**
     * Reset metrics (for testing)
     */
    reset(): void {
        this.transactionStats = {
            transactionsAttempted: 0,
            transactionsSuccessful: 0,
            transactionsFailed: 0,
            averageRetryCount: 0,
            lastTransactionTime: undefined,
        };

        this.conflictStats = {
            totalConflicts: 0,
            recentConflicts: 0,
            successRate: 1,
            averageDelay: 0,
            lastConflictTime: 0,
        };
    }

    /**
     * Get comprehensive health report
     */
    async getHealthReport() {
        const cacheStats = await this.getCacheStats();
        const transactionStats = this.getTransactionStats();
        const conflictStats = this.getConflictStats();
        const connectionHealth = this.connectionManager.getHealth();

        return {
            timestamp: new Date().toISOString(),
            connection: connectionHealth,
            cache: cacheStats,
            transactions: transactionStats,
            conflicts: conflictStats,
            overallHealth: this.calculateOverallHealth({
                connection: connectionHealth,
                cache: cacheStats,
                transactions: transactionStats,
                conflicts: conflictStats,
            }),
        };
    }

    /**
     * Calculate overall system health score
     */
    private calculateOverallHealth(components: {
        connection: { connected: boolean; ready: boolean };
        cache: { connected: boolean; error?: string };
        transactions: { transactionsAttempted: number; transactionsSuccessful: number };
        conflicts: { totalConflicts: number };
    }): number {
        let score = 0;
        let totalWeight = 0;

        // Connection health (40% weight)
        if (components.connection.connected && components.connection.ready) {
            score += 40;
        }
        totalWeight += 40;

        // Cache health (30% weight)
        if (components.cache.connected && !components.cache.error) {
            score += 30;
        }
        totalWeight += 30;

        // Transaction success rate (20% weight)
        const successRate = components.transactions.transactionsAttempted > 0 ?
            components.transactions.transactionsSuccessful / components.transactions.transactionsAttempted : 1;
        score += (successRate * 20);
        totalWeight += 20;

        // Conflict rate (10% weight) - lower conflicts = higher score
        const conflictRate = components.transactions.transactionsAttempted > 0 ?
            components.conflicts.totalConflicts / components.transactions.transactionsAttempted : 0;
        score += ((1 - Math.min(conflictRate, 1)) * 10);
        totalWeight += 10;

        return Math.round((score / totalWeight) * 100);
    }
}
