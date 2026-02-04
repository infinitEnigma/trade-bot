/**
 * Balance Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IBalanceRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for balance data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    IBalanceRepository,
    Balance,
    BalanceHistory
} from '@trade-bot/shared';
import { logger } from '../../../core/logging';
import { query } from '../../../database/pool';

/**
 * Balance Repository Adapter
 *
 * Implements the IBalanceRepository interface using PostgreSQL database operations.
 * Provides balance data access with proper error handling and type safety.
 */
export class BalanceRepositoryAdapter implements IBalanceRepository {

    // Allow injection of query function for testing
    constructor(private readonly queryFn = query) { }

    /**
     * Get user's current balance
     */
    async getBalance(userId: string): Promise<Balance> {
        try {
            const result = await this.queryFn('SELECT * FROM balances WHERE user_id = $1', [userId]);
            const typedResult = result as {
                rows: Array<{
                    total: string;
                    available: string;
                    locked: string;
                    currency: string;
                    last_updated: string;
                }>
            };

            if (typedResult.rows.length === 0) {
                return Balance.zero('USD');
            }

            const row = typedResult.rows[0];
            return new Balance(
                parseFloat(row.total),
                parseFloat(row.available),
                parseFloat(row.locked),
                row.currency,
                new Date(row.last_updated)
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get balance: ${errorMessage}`);
        }
    }

    /**
     * Update user's balance
     */
    async updateBalance(userId: string, balance: Balance): Promise<void> {
        try {
            await this.queryFn(
                'UPDATE balances SET total = $1, available = $2, locked = $3, currency = $4, last_updated = NOW() WHERE user_id = $5',
                [balance.total, balance.available, balance.locked, balance.currency, userId]
            );
            logger.info(`Balance update for user ${userId}: ${balance.total} ${balance.currency}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update balance: ${errorMessage}`);
        }
    }

    /**
     * Get balance history for a user
     */
    async getBalanceHistory(userId: string, limit: number = 50): Promise<BalanceHistory[]> {
        try {
            const result = await this.queryFn(
                'SELECT * FROM balance_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
                [userId, limit]
            );

            const typedResult = result as {
                rows: Array<{
                    id: string;
                    user_id: string;
                    total: string;
                    available: string;
                    locked: string;
                    currency: string;
                    last_updated: string;
                    change_reason: string;
                    change_amount: string;
                    created_at: string;
                }>
            };

            return typedResult.rows.map(row => ({
                id: row.id,
                userId: row.user_id,
                balance: new Balance(
                    parseFloat(row.total),
                    parseFloat(row.available),
                    parseFloat(row.locked),
                    row.currency,
                    new Date(row.last_updated)
                ),
                changeReason: row.change_reason,
                changeAmount: parseFloat(row.change_amount),
                timestamp: new Date(row.created_at)
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get balance history: ${errorMessage}`);
        }
    }
}

// Export singleton instance
export const balanceRepositoryAdapter = new BalanceRepositoryAdapter();