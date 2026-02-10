/**
 * Bot Instance Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IBotInstanceRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for bot instance data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { IBotInstanceRepository } from '@trade-bot/shared';
import { query } from '../../../database/pool';
import { tradingLogger as logger } from '../../../core/logging/context-aware-logger.service';

/**
 * Bot Instance Repository Adapter
 *
 * Implements the IBotInstanceRepository interface using PostgreSQL database operations.
 * Provides bot instance data access with proper error handling and type safety.
 */
export class BotInstanceRepositoryAdapter implements IBotInstanceRepository {

    /**
     * Get all bot instances for a user
     */
    async getBotInstances(userId: string): Promise<any[]> {
        try {
            const result = await query(`
                SELECT bi.*, s.name as strategy_name, s.type as strategy_type, s.config as strategy_config
                FROM bot_instances bi
                JOIN strategies s ON bi.strategy_id = s.id
                WHERE bi.user_id = $1
                ORDER BY bi.created_at DESC
            `, [userId]);

            return result.rows;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to get bot instances', error as Error);
            throw new Error(`Failed to get bot instances: ${errorMessage}`);
        }
    }

    /**
     * Get bot instance by ID
     */
    async getBotInstance(id: string): Promise<any | null> {
        try {
            const result = await query(`
                SELECT bi.*, s.name as strategy_name, s.type as strategy_type, s.config as strategy_config
                FROM bot_instances bi
                JOIN strategies s ON bi.strategy_id = s.id
                WHERE bi.id = $1
            `, [id]);

            if (result.rows.length === 0) {
                return null;
            }

            return result.rows[0];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to get bot instance', error as Error);
            throw new Error(`Failed to get bot instance: ${errorMessage}`);
        }
    }

    /**
     * Create a new bot instance
     */
    async createBotInstance(bot: Omit<any, 'id' | 'createdAt' | 'updatedAt'>): Promise<any> {
        try {
            const result = await query(`
                INSERT INTO bot_instances (id, strategy_id, user_id, status, running_time, total_trades, total_pnl)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [
                bot.id,
                bot.strategy_id,
                bot.user_id,
                bot.status || 'RUNNING',
                bot.running_time || 0,
                bot.total_trades || 0,
                bot.total_pnl || 0
            ]);

            if (result.rows.length === 0) {
                throw new Error('Bot instance creation failed - no rows returned');
            }

            return result.rows[0];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to create bot instance', error as Error);
            throw new Error(`Failed to create bot instance: ${errorMessage}`);
        }
    }

    /**
     * Update bot instance status
     */
    async updateBotStatus(id: string, status: string): Promise<void> {
        try {
            await query(
                'UPDATE bot_instances SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [status, id]
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to update bot status', error as Error);
            throw new Error(`Failed to update bot status: ${errorMessage}`);
        }
    }

    /**
     * Update bot instance performance metrics
     */
    async updateBotPerformance(id: string, metrics: { runningTime?: number; totalTrades?: number; totalPnL?: number }): Promise<void> {
        try {
            // Build update query dynamically based on provided fields
            const updateFields: string[] = [];
            const updateValues: any[] = [];
            let valueIndex = 1;

            if (metrics.runningTime !== undefined) {
                updateFields.push(`running_time = $${valueIndex}`);
                updateValues.push(metrics.runningTime);
                valueIndex++;
            }

            if (metrics.totalTrades !== undefined) {
                updateFields.push(`total_trades = $${valueIndex}`);
                updateValues.push(metrics.totalTrades);
                valueIndex++;
            }

            if (metrics.totalPnL !== undefined) {
                updateFields.push(`total_pnl = $${valueIndex}`);
                updateValues.push(metrics.totalPnL);
                valueIndex++;
            }

            if (updateFields.length === 0) {
                return; // No fields to update
            }

            updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
            updateValues.push(id); // For the WHERE clause

            await query(
                `UPDATE bot_instances SET ${updateFields.join(', ')} WHERE id = $${valueIndex}`,
                updateValues
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to update bot performance', error as Error);
            throw new Error(`Failed to update bot performance: ${errorMessage}`);
        }
    }

    /**
     * Delete bot instance
     */
    async deleteBotInstance(id: string): Promise<void> {
        try {
            await query('DELETE FROM bot_instances WHERE id = $1', [id]);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to delete bot instance', error as Error);
            throw new Error(`Failed to delete bot instance: ${errorMessage}`);
        }
    }

    /**
     * Get active bot instances
     */
    async getActiveBotInstances(): Promise<any[]> {
        try {
            const result = await query(`
                SELECT * FROM bot_instances 
                WHERE status IN ('RUNNING', 'STARTING')
            `);

            return result.rows;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to get active bot instances', error as Error);
            throw new Error(`Failed to get active bot instances: ${errorMessage}`);
        }
    }
}

// Export singleton instance
export const botInstanceRepositoryAdapter = new BotInstanceRepositoryAdapter();