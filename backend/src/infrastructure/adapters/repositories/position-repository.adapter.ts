/**
 * Position Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IPositionRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for position data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    IPositionRepository,
    Position
} from '@trade-bot/shared';
import { query } from '../../../database/pool';
import { logger } from '../../../core/logging';

/**
 * Position Repository Adapter
 *
 * Implements the IPositionRepository interface using PostgreSQL database operations.
 * Provides position data access with proper error handling and type safety.
 */
export class PositionRepositoryAdapter implements IPositionRepository {

    /**
     * Get all positions for a user
     */
    async getPositions(userId: string): Promise<Position[]> {
        try {
            const result = await query<PositionRow>(
                `SELECT
                    symbol,
                    position_qty as quantity,
                    average_open_price as entryPrice,
                    mark_price as markPrice,
                    leverage,
                    imr,
                    mmr,
                    est_liq_price as liquidationPrice
                FROM kodiak_positions
                WHERE user_id = $1
                ORDER BY updated_at DESC`,
                [userId]
            );

            return result.rows.map(row => this.mapRowToPosition(row)).filter(Boolean) as Position[];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get positions: ${errorMessage}`);
        }
    }

    /**
     * Get position by symbol for a user
     */
    async getPosition(userId: string, symbol: string): Promise<Position | null> {
        try {
            const result = await query<PositionRow>(
                `SELECT
                    symbol,
                    position_qty as quantity,
                    average_open_price as entryPrice,
                    mark_price as markPrice,
                    leverage,
                    imr,
                    mmr,
                    est_liq_price as liquidationPrice
                FROM kodiak_positions
                WHERE user_id = $1 AND symbol = $2`,
                [userId, symbol]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return this.mapRowToPosition(result.rows[0]);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get position: ${errorMessage}`);
        }
    }

    /**
     * Update position data
     */
    async updatePosition(userId: string, position: Position): Promise<void> {
        try {
            // This would typically update the position in the database
            // For now, positions are synced from external APIs
            logger.info(`Position update for user ${userId}, symbol ${position.symbol}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update position: ${errorMessage}`);
        }
    }

    /**
     * Close position for a user
     */
    async closePosition(userId: string, symbol: string): Promise<void> {
        try {
            // This would typically mark the position as closed or remove it
            // For now, positions are managed by external APIs
            logger.info(`Position close for user ${userId}, symbol ${symbol}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to close position: ${errorMessage}`);
        }
    }

    /**
     * Map database row to Position domain object
     */
    private mapRowToPosition(row: PositionRow): Position | null {
        try {
            const symbol = row.symbol;
            const quantity = parseFloat(row.quantity || '0');
            const entryPrice = parseFloat(row.entryPrice || '0');
            const markPrice = parseFloat(row.markPrice || '0');
            const leverage = parseInt(row.leverage || '1');

            if (!symbol || quantity === 0 || entryPrice === 0) {
                return null;
            }

            // Determine side based on quantity (positive = LONG, negative = SHORT)
            const side = quantity > 0 ? 'LONG' : 'SHORT';

            return new Position(
                symbol,
                side,
                Math.abs(quantity),
                entryPrice,
                markPrice,
                leverage,
                parseFloat(row.imr || '0'), // margin ratio
                row.liquidationPrice ? parseFloat(row.liquidationPrice) : undefined
            );
        } catch (error) {
            logger.warn(`Failed to map position row to domain object: ${error}`);
            return null;
        }
    }
}

/**
 * Database row interface for position data
 */
interface PositionRow {
    symbol: string;
    quantity: string;
    entryPrice: string;
    markPrice: string;
    leverage: string;
    imr: string;
    liquidationPrice?: string;
}
// Export singleton instance
export const positionRepositoryAdapter = new PositionRepositoryAdapter();