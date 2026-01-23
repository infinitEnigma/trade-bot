/**
 * Strategy Repository Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IStrategyRepository interface using PostgreSQL database.
 * This adapter provides a clean abstraction layer for strategy data access,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import {
    IStrategyRepository,
    Strategy
} from '@trade-bot/shared';
import { query } from '../../../database/pool';

/**
 * Strategy Repository Adapter
 *
 * Implements the IStrategyRepository interface using PostgreSQL database operations.
 * Provides strategy data access with proper error handling and type safety.
 */
export class StrategyRepositoryAdapter implements IStrategyRepository {

    /**
     * Get all strategies for a user
     */
    async getStrategies(userId: string): Promise<Strategy[]> {
        try {
            const result = await query(
                'SELECT id, user_id, name, type, config, active, created_at, updated_at FROM strategies WHERE user_id = $1 ORDER BY created_at DESC',
                [userId]
            );

            return result.rows.map(row => this.mapRowToStrategy(row)).filter(Boolean) as Strategy[];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get strategies: ${errorMessage}`);
        }
    }

    /**
     * Get strategy by ID
     */
    async getStrategy(id: string): Promise<Strategy | null> {
        try {
            const result = await query(
                'SELECT id, user_id, name, type, config, active, created_at, updated_at FROM strategies WHERE id = $1',
                [id]
            );

            if (result.rows.length === 0) {
                return null;
            }

            return this.mapRowToStrategy(result.rows[0]);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get strategy: ${errorMessage}`);
        }
    }

    /**
     * Create a new strategy
     */
    async createStrategy(strategy: Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>): Promise<Strategy> {
        try {
            const result = await query(
                'INSERT INTO strategies (user_id, name, type, config, active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id, created_at, updated_at',
                [strategy.userId, strategy.name, strategy.type, JSON.stringify(strategy.config), strategy.active]
            );

            if (result.rows.length === 0) {
                throw new Error('Strategy creation failed - no rows returned');
            }

            const row = result.rows[0];
            return this.mapRowToStrategy({
                id: row.id,
                user_id: strategy.userId,
                name: strategy.name,
                type: strategy.type,
                config: strategy.config,
                active: strategy.active,
                created_at: row.created_at,
                updated_at: row.updated_at
            }) as Strategy;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create strategy: ${errorMessage}`);
        }
    }

    /**
     * Update strategy configuration
     */
    async updateStrategy(id: string, updates: any): Promise<void> {
        try {
            // This would update strategy configuration in the database
            console.log(`Strategy config update for strategy ${id}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update strategy: ${errorMessage}`);
        }
    }

    /**
     * Delete strategy
     */
    async deleteStrategy(id: string): Promise<void> {
        try {
            const result = await query('DELETE FROM strategies WHERE id = $1', [id]);
            if (result.rowCount === 0) {
                throw new Error('Strategy not found');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to delete strategy: ${errorMessage}`);
        }
    }

    /**
     * Toggle strategy active status
     */
    async toggleStrategy(id: string, active: boolean): Promise<void> {
        try {
            const result = await query(
                'UPDATE strategies SET active = $1, updated_at = NOW() WHERE id = $2',
                [active, id]
            );

            if (result.rowCount === 0) {
                throw new Error('Strategy not found');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to toggle strategy: ${errorMessage}`);
        }
    }

    /**
     * Map database row to Strategy interface object
     */
    private mapRowToStrategy(row: any): Strategy | null {
        try {
            // Return plain object matching Strategy interface
            return {
                id: row.id,
                userId: row.user_id,
                name: row.name,
                type: row.type,
                config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
                active: row.active,
                createdAt: new Date(row.created_at),
                updatedAt: new Date(row.updated_at)
            };
        } catch (error) {
            console.warn(`Failed to map strategy row to domain object: ${error}`);
            return null;
        }
    }
}

// Export singleton instance
export const strategyRepositoryAdapter = new StrategyRepositoryAdapter();