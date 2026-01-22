/**
 * Trade Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements ITradeRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for trade data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    ITradeRepository,
    Trade,
    OrderStatus
} from '../../../../../shared';
import { query } from '../../../database/pool';

/**
 * Trade Repository Adapter
 *
 * Implements the ITradeRepository interface using PostgreSQL database operations.
 * Provides trade data access with proper error handling and type safety.
 */
export class TradeRepositoryAdapter implements ITradeRepository {

    /**
     * Get trades for a user
     */
    async getTrades(userId: string, limit: number = 50): Promise<Trade[]> {
        try {
            const result = await query(
                `SELECT
                    id,
                    strategy_id,
                    order_id,
                    symbol,
                    side,
                    quantity,
                    price,
                    fee,
                    pnl,
                    executed_at
                FROM trades
                WHERE user_id = $1
                ORDER BY executed_at DESC
                LIMIT $2`,
                [userId, limit]
            );

            return result.rows.map(row => this.mapRowToTrade(row)).filter(Boolean) as Trade[];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get trades: ${errorMessage}`);
        }
    }

    /**
     * Get trades for a specific strategy
     */
    async getTradesByStrategy(userId: string, strategyId: string, limit: number = 50): Promise<Trade[]> {
        try {
            const result = await query(
                `SELECT
                    id,
                    strategy_id,
                    order_id,
                    symbol,
                    side,
                    quantity,
                    price,
                    fee,
                    pnl,
                    executed_at
                FROM trades
                WHERE user_id = $1 AND strategy_id = $2
                ORDER BY executed_at DESC
                LIMIT $3`,
                [userId, strategyId, limit]
            );

            return result.rows.map(row => this.mapRowToTrade(row)).filter(Boolean) as Trade[];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get trades by strategy: ${errorMessage}`);
        }
    }

    /**
     * Create a new trade record
     */
    async createTrade(trade: Omit<Trade, 'id' | 'executedAt'>): Promise<Trade> {
        try {
            const result = await query(
                `INSERT INTO trades (
                    user_id,
                    strategy_id,
                    order_id,
                    symbol,
                    side,
                    quantity,
                    price,
                    fee,
                    pnl,
                    executed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                RETURNING id, executed_at`,
                [
                    'unknown', // userId not in Trade type
                    trade.strategyId,
                    trade.orderId,
                    trade.symbol,
                    trade.side,
                    trade.quantity,
                    trade.price,
                    trade.fee,
                    trade.pnl
                ]
            );

            if (result.rows.length === 0) {
                throw new Error('Trade creation failed - no rows returned');
            }

            const row = result.rows[0];
            // Return plain object matching Trade interface
            return {
                id: row.id,
                userId: 'unknown',
                strategyId: trade.strategyId,
                orderId: trade.orderId,
                symbol: trade.symbol,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                fee: trade.fee,
                pnl: trade.pnl,
                status: OrderStatus.FILLED,
                executedAt: new Date(row.executed_at)
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create trade: ${errorMessage}`);
        }
    }

    /**
     * Update trade status
     */
    async updateTradeStatus(tradeId: string, status: any): Promise<void> {
        try {
            // This would update trade status in the database
            console.log(`Trade status update for trade ${tradeId}: ${status}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update trade status: ${errorMessage}`);
        }
    }

    /**
     * Map database row to Trade interface object
     */
    private mapRowToTrade(row: any): Trade | null {
        try {
            // Return plain object matching Trade interface
            return {
                id: row.id,
                userId: 'unknown', // userId not stored in trades table
                strategyId: row.strategy_id,
                orderId: row.order_id,
                symbol: row.symbol,
                side: row.side,
                quantity: parseFloat(row.quantity || '0'),
                price: parseFloat(row.price || '0'),
                fee: parseFloat(row.fee || '0'),
                pnl: row.pnl ? parseFloat(row.pnl) : undefined,
                status: OrderStatus.FILLED,
                executedAt: new Date(row.executed_at)
            };
        } catch (error) {
            console.warn(`Failed to map trade row to domain object: ${error}`);
            return null;
        }
    }
}

// Export singleton instance
export const tradeRepositoryAdapter = new TradeRepositoryAdapter();