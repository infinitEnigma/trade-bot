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
    OrderStatus,
    OrderSide
} from '@trade-bot/shared';
import { query } from '../../../database/pool';
import { databaseLogger as logger } from '../../../core/logging/context-aware-logger.service';

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
            const result = await query<TradeRow>(
                `SELECT
                    id,
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
                FROM trades
                WHERE user_id = $1
                ORDER BY executed_at DESC
                LIMIT $2`,
                [userId, limit]
            );

            return result.rows.map(row => this.mapRowToTrade(row)).filter(Boolean) as Trade[];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to get trades', error as Error);
            throw new Error(`Failed to get trades: ${errorMessage}`);
        }
    }

    /**
     * Get trades for a specific strategy
     */
    async getTradesByStrategy(userId: string, strategyId: string, limit: number = 50): Promise<Trade[]> {
        try {
            const result = await query<TradeRow>(
                `SELECT
                    id,
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
            const result = await query<{ id: string, executed_at: string }>(`
                INSERT INTO trades (
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
                    trade.userId,
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
                userId: trade.userId,
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
    async updateTradeStatus(tradeId: string, status: OrderStatus): Promise<void> {
        try {
            // This would update trade status in the database
            logger.info(`Trade status update for trade ${tradeId}: ${status}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update trade status: ${errorMessage}`);
        }
    }

    /**
     * Map database row to Trade interface object
     */
    private mapRowToTrade(row: TradeRow & { user_id?: string }): Trade | null {
        try {
            // Validate required fields
            if (!row.id || !row.order_id || !row.symbol || !row.side || !row.quantity || !row.price || !row.fee || !row.executed_at) {
                logger.warn('Invalid trade row - missing required fields');
                return null;
            }

            // Validate numeric fields
            const quantity = parseFloat(row.quantity);
            const price = parseFloat(row.price);
            const fee = parseFloat(row.fee);
            const pnl = row.pnl ? parseFloat(row.pnl) : undefined;

            if (isNaN(quantity) || isNaN(price) || isNaN(fee) || (row.pnl && isNaN(pnl!))) {
                logger.warn('Invalid trade row - numeric fields contain non-numeric values');
                return null;
            }

            // Validate side is valid
            if (!['BUY', 'SELL'].includes(row.side)) {
                logger.warn(`Invalid trade side: ${row.side}`);
                return null;
            }

            // Validate positive values
            if (quantity <= 0 || price <= 0 || fee < 0) {
                logger.warn('Invalid trade row - negative or zero values');
                return null;
            }

            // Return plain object matching Trade interface
            return {
                id: row.id,
                userId: row.user_id || 'unknown',
                strategyId: row.strategy_id,
                orderId: row.order_id,
                symbol: row.symbol,
                side: row.side,
                quantity: quantity,
                price: price,
                fee: fee,
                pnl: pnl,
                status: OrderStatus.FILLED,
                executedAt: new Date(row.executed_at)
            };
        } catch (error) {
            logger.error(`Failed to map trade row to domain object: ${error}`, error as Error);
            return null;
        }
    }
}

/**
 * Database row interface for trade data
 */
interface TradeRow {
    id: string;
    strategy_id?: string;
    order_id: string;
    symbol: string;
    side: OrderSide;
    quantity: string;
    price: string;
    fee: string;
    pnl?: string;
    executed_at: string;
}
// Export singleton instance
export const tradeRepositoryAdapter = new TradeRepositoryAdapter();