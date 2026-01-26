/**
 * Position Synchronization Service
 *
 * Establishes database as canonical position source with sync from Kodiak API.
 * Ensures position data consistency across bot engine, Kodiak API, and database.
 */

import { query } from "../../database/pool";
import { redisService } from "../../infrastructure";
import { kodiakIntegrationService } from "../../infrastructure/external/kodiak-integration.service";
import { CACHE_KEYS } from "../../config/cache.config";
import { cacheInvalidationService } from "../../infrastructure";
import { positionSyncLogger } from "../logging/context-aware-logger.service";
//import { IEncryptionService } from "../../../../shared/src/types/infrastructure";

export interface PositionData {
    symbol: string;
    positionQty: number;
    costPosition: number;
    averageOpenPrice: number;
    markPrice: number;
    unsettledPnl: number;
    pnl24h: number;
    leverage: number;
    imr: number;
    mmr: number;
    estLiqPrice: number;
    lastUpdated: Date;
}

/**
 * Interface for Kodiak API max notional data structure
 */
export interface KodiakMaxNotional {
    [symbol: string]: {
        maxNotional: number;
        minNotional: number;
        maxLeverage: number;
        pricePrecision: number;
        quantityPrecision: number;
    };
}

/**
 * Interface for Kodiak API account information response
 */
export interface KodiakAccountInfo {
    total_balance: string;
    max_leverage: string;
    max_notional: KodiakMaxNotional;
    taker_fee_rate: string;
    maker_fee_rate: string;
    // Add other account info fields as needed
}

/**
 * Interface for raw position data from Kodiak API
 */
export interface KodiakPosition {
    symbol: string;
    position_qty: string | number;
    cost_position: string | number;
    average_open_price: string | number;
    mark_price: string | number;
    unsettled_pnl: string | number;
    pnl_24_h: string | number;
    leverage: string | number;
    imr: string | number;
    mmr: string | number;
    est_liq_price: string | number;
    // Add other position fields as needed from API
}

export interface PositionSyncResult {
    success: boolean;
    positionsSynced: number;
    errors: string[];
    syncTimestamp: Date;
}

/**
 * Position Synchronization Service
 */
export class PositionSyncService {
    private readonly POSITION_CACHE_TTL = 30; // 30 seconds for position data

    /**
     * Store account information in database
     */
    private async storeAccountInfoInDatabase(
        userId: string,
        accountData: any // Use any to avoid type mismatch with centralized service
    ): Promise<void> {
        await query(`
    INSERT INTO kodiak_accounts (
      user_id, balance, max_leverage, max_notional,
      taker_fee_rate, maker_fee_rate, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id)
    DO UPDATE SET
      balance = EXCLUDED.balance,
      max_leverage = EXCLUDED.max_leverage,
      max_notional = EXCLUDED.max_notional,
      taker_fee_rate = EXCLUDED.taker_fee_rate,
      maker_fee_rate = EXCLUDED.maker_fee_rate,
      updated_at = EXCLUDED.updated_at
  `, [
            userId,
            accountData?.totalBalance || accountData?.total_balance || "0",
            10, // Default max leverage (should come from account data if available)
            JSON.stringify({}), // Max notional data if available
            0.001, // Default taker fee rate
            0.001, // Default maker fee rate
            new Date(),
        ]);
    }

    /**
     * ===========================================
     * 🔄 SYNC POSITIONS FROM KODIAK API TO DATABASE
     * ===========================================
     *
     * Establishes database as canonical position source with sync from Kodiak API.
     * This is the SINGLE SOURCE OF TRUTH for position data across the entire system.
     *
     * DATA FLOW:
     * 1. Fetch from Kodiak API (authoritative source)
     * 2. Store in database (canonical source)
     * 3. Position validator reads from database
     * 4. Bot management reads from database
     *
     * ELIMINATES COMPETING SOURCES:
     * ❌ Before: API, Database, Bot State (3 sources)
     * ✅ After: Database (1 canonical source)
     */
    async syncPositionsFromKodiak(userId: string): Promise<PositionSyncResult> {
        const errors: string[] = [];
        let positionsSynced = 0;
        const syncTimestamp = new Date();

        try {
            // ✅ USE CENTRALIZED SERVICE - Get positions through single source of truth
            const positionsResponse = await kodiakIntegrationService.getPositions(userId);
            if (!positionsResponse.success || !positionsResponse.data) {
                return {
                    success: false,
                    positionsSynced: 0,
                    errors: [positionsResponse.error || 'Failed to fetch positions from centralized service'],
                    syncTimestamp,
                };
            }

            // Get account info through centralized service
            const accountResponse = await kodiakIntegrationService.getAccountInfo(userId);
            if (accountResponse.success && accountResponse.data) {
                await this.storeAccountInfoInDatabase(userId, accountResponse.data);
                positionSyncLogger.debug("Account info synced", { userId });
            } else {
                const errorMsg = `Failed to sync account info: ${accountResponse.error}`;
                errors.push(errorMsg);
                positionSyncLogger.warn("Account info sync error", {
                    userId,
                    error: accountResponse.error,
                });
            }

            // Store positions in database as canonical source
            for (const position of positionsResponse.data) {
                try {
                    await this.storePositionInDatabase(userId, position);
                    positionsSynced++;
                } catch (error) {
                    const errorMsg = `Failed to store position for ${position.symbol}: ${error}`;
                    errors.push(errorMsg);
                    positionSyncLogger.error("Position storage error", error as Error, {
                        userId,
                        symbol: position.symbol,
                    });
                }
            }

            // Invalidate position caches
            await this.invalidatePositionCaches(userId);

            positionSyncLogger.info("Position sync completed", {
                userId,
                positionsSynced,
                errors: errors.length,
                syncTimestamp: syncTimestamp.toISOString(),
            });

            return {
                success: errors.length === 0,
                positionsSynced,
                errors,
                syncTimestamp,
            };
        } catch (error) {
            const errorMsg = `Position sync failed: ${error}`;
            errors.push(errorMsg);

            positionSyncLogger.error("Position sync error", error as Error, {
                userId,
            });

            return {
                success: false,
                positionsSynced,
                errors,
                syncTimestamp,
            };
        }
    }

    /**
     * Store position in database as canonical source
     */
    private async storePositionInDatabase(
        userId: string,
        positionData: any // Use any to avoid type mismatch with centralized service
    ): Promise<void> {
        const position: PositionData = {
            symbol: positionData.symbol,
            // Handle both camelCase (from centralized service) and snake_case formats
            positionQty: parseFloat(String(positionData.positionAmt || positionData.position_qty || "0")),
            costPosition: parseFloat(String(positionData.entryPrice || positionData.cost_position || "0")),
            averageOpenPrice: parseFloat(String(positionData.entryPrice || positionData.average_open_price || "0")),
            markPrice: parseFloat(String(positionData.markPrice || positionData.mark_price || "0")),
            unsettledPnl: parseFloat(String(positionData.pnl || positionData.unsettled_pnl || "0")),
            pnl24h: parseFloat(String(positionData.pnl24h || positionData.pnl_24_h || "0")),
            leverage: parseFloat(String(positionData.leverage || "1")),
            imr: parseFloat(String(positionData.imr || "0.1")),
            mmr: parseFloat(String(positionData.mmr || "0.05")),
            estLiqPrice: parseFloat(String(positionData.estLiqPrice || positionData.est_liq_price || "0")),
            lastUpdated: new Date(),
        };

        // Upsert position in database
        await query(`
      INSERT INTO kodiak_positions (
        user_id, symbol, position_qty, cost_position, average_open_price,
        mark_price, unsettled_pnl, pnl_24_h, leverage, imr, mmr, est_liq_price, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (user_id, symbol)
      DO UPDATE SET
        position_qty = EXCLUDED.position_qty,
        cost_position = EXCLUDED.cost_position,
        average_open_price = EXCLUDED.average_open_price,
        mark_price = EXCLUDED.mark_price,
        unsettled_pnl = EXCLUDED.unsettled_pnl,
        pnl_24_h = EXCLUDED.pnl_24_h,
        leverage = EXCLUDED.leverage,
        imr = EXCLUDED.imr,
        mmr = EXCLUDED.mmr,
        est_liq_price = EXCLUDED.est_liq_price,
        updated_at = EXCLUDED.updated_at
    `, [
            userId,
            position.symbol,
            position.positionQty,
            position.costPosition,
            position.averageOpenPrice,
            position.markPrice,
            position.unsettledPnl,
            position.pnl24h,
            position.leverage,
            position.imr,
            position.mmr,
            position.estLiqPrice,
            position.lastUpdated,
        ]);
    }

    /**
     * Get positions from database (canonical source)
     */
    async getPositionsFromDatabase(userId: string): Promise<PositionData[]> {
        try {
            // Check cache first
            const cacheKey = CACHE_KEYS.position(userId);
            const cacheResult = await redisService.get(cacheKey);

            if (cacheResult.success && cacheResult.data) {
                const cachedPositions = JSON.parse(cacheResult.data);
                positionSyncLogger.debug("Position cache hit", { userId, count: cachedPositions.length });
                return cachedPositions;
            }

            // Fetch from database
            const result = await query(`
        SELECT
          symbol, position_qty, cost_position, average_open_price,
          mark_price, unsettled_pnl, pnl_24_h, leverage, imr, mmr, est_liq_price, updated_at
        FROM kodiak_positions
        WHERE user_id = $1
        ORDER BY updated_at DESC
      `, [userId]);

            const positions: PositionData[] = (result.rows as Array<{
                symbol: string;
                position_qty: string;
                cost_position: string;
                average_open_price: string;
                mark_price: string;
                unsettled_pnl: string;
                pnl_24_h: string;
                leverage: string;
                imr: string;
                mmr: string;
                est_liq_price: string;
                updated_at: string;
            }>).map((row) => ({
                symbol: row.symbol,
                positionQty: parseFloat(row.position_qty),
                costPosition: parseFloat(row.cost_position),
                averageOpenPrice: parseFloat(row.average_open_price),
                markPrice: parseFloat(row.mark_price),
                unsettledPnl: parseFloat(row.unsettled_pnl),
                pnl24h: parseFloat(row.pnl_24_h),
                leverage: parseInt(row.leverage),
                imr: parseFloat(row.imr),
                mmr: parseFloat(row.mmr),
                estLiqPrice: parseFloat(row.est_liq_price),
                lastUpdated: new Date(row.updated_at),
            }));

            // Cache positions
            await redisService.setex(cacheKey, this.POSITION_CACHE_TTL, JSON.stringify(positions));

            positionSyncLogger.debug("Positions fetched from database", {
                userId,
                count: positions.length,
                cached: true,
            });

            return positions;

        } catch (error) {
            positionSyncLogger.error("Failed to get positions from database", error as Error, {
                userId,
            });
            throw error;
        }
    }

    /**
     * Invalidate position caches
     */
    private async invalidatePositionCaches(userId: string): Promise<void> {
        const cacheKey = CACHE_KEYS.position(userId);
        await cacheInvalidationService.invalidateWithBroadcast(
            [cacheKey],
            'position_data_updated',
            userId
        );
    }

    /**
     * Sync positions for all users (batch operation)
     */
    async syncAllUserPositions(): Promise<{ totalUsers: number; successfulSyncs: number; errors: string[] }> {
        const errors: string[] = [];
        let successfulSyncs = 0;

        try {
            // Get all users with verified Kodiak credentials
            const usersResult = await query<{ user_id: string }>(`
        SELECT DISTINCT kc.user_id
        FROM kodiak_credentials kc
        WHERE kc.verified = true
      `);

            const totalUsers = usersResult.rows.length;

            positionSyncLogger.info("Starting batch position sync", { totalUsers });

            // Sync positions for each user
            for (const userRow of usersResult.rows) {
                try {
                    const result = await this.syncPositionsFromKodiak(userRow.user_id);
                    if (result.success) {
                        successfulSyncs++;
                    } else {
                        errors.push(`User ${userRow.user_id}: ${result.errors.join(', ')}`);
                    }
                } catch (error) {
                    const errorMsg = `User ${userRow.user_id}: ${error}`;
                    errors.push(errorMsg);
                    positionSyncLogger.error("Batch position sync error for user", error as Error, {
                        userId: userRow.user_id,
                    });
                }
            }

            positionSyncLogger.info("Batch position sync completed", {
                totalUsers,
                successfulSyncs,
                errors: errors.length,
            });

            return { totalUsers, successfulSyncs, errors };

        } catch (error) {
            const errorMsg = `Batch position sync failed: ${error}`;
            errors.push(errorMsg);

            positionSyncLogger.error("Batch position sync error", error as Error, {});

            return { totalUsers: 0, successfulSyncs, errors };
        }
    }

    /**
     * Validate position data consistency
     */
    async validatePositionConsistency(userId: string): Promise<{
        isConsistent: boolean;
        issues: string[];
        databasePositions: number;
        apiPositions: number;
    }> {
        const issues: string[] = [];

        try {
            // Get positions from database
            const dbPositions = await this.getPositionsFromDatabase(userId);
            const databasePositions = dbPositions.length;

            // Get positions from API
            const credsResult = await query<{
                account_id: string;
                api_key_encrypted: string;
                secret_key_encrypted: string;
            }>(
                "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );

            let apiPositions = 0;
            if (credsResult.rows.length > 0) {
                // Use centralized service to get positions from API
                const positionsResponse = await kodiakIntegrationService.getPositions(userId);
                if (positionsResponse.success && positionsResponse.data) {
                    apiPositions = positionsResponse.data.length;

                    // Check for significant discrepancies
                    if (Math.abs(databasePositions - apiPositions) > 2) {
                        issues.push(`Position count mismatch: DB=${databasePositions}, API=${apiPositions}`);
                    }
                } else {
                    issues.push(`Failed to fetch positions from API: ${positionsResponse.error}`);
                }

                // Check for stale data (older than 5 minutes)
                const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
                const stalePositions = dbPositions.filter(p => p.lastUpdated < fiveMinutesAgo);
                if (stalePositions.length > 0) {
                    issues.push(`${stalePositions.length} positions are stale (>5 minutes old)`);
                }
            }

            const isConsistent = issues.length === 0;

            return {
                isConsistent,
                issues,
                databasePositions,
                apiPositions,
            };

        } catch (error) {
            issues.push(`Consistency check failed: ${error}`);
            positionSyncLogger.error("Position consistency check error", error as Error, {
                userId,
            });

            return {
                isConsistent: false,
                issues,
                databasePositions: 0,
                apiPositions: 0,
            };
        }
    }
}

// Export singleton instance
export const positionSyncService = new PositionSyncService();
