/**
 * Position Synchronization Service
 *
 * Establishes database as canonical position source with sync from Kodiak API.
 * Ensures position data consistency across bot engine, Kodiak API, and database.
 */

import axios from "axios";
import { query } from "../database/pool";
import { redisService } from "./redis";
import { getCacheConfig, CACHE_KEYS } from "../config/cache.config";
import { cacheInvalidationService } from "./cache-invalidation";
import { generateOrderlySignature } from "../shared/utils/orderly-signature";
import { positionSyncLogger } from "./context-aware-logger";

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
     * Sync account information from Kodiak API to database
     * Includes balance, leverage, and account settings
     */
    private async syncAccountInfoFromAPI(
        accountId: string,
        apiKey: string,
        secretKey: string
    ): Promise<any> {
        try {
            const timestamp = Date.now();
            const path = "/v1/client/info";
            const signature = await generateOrderlySignature(
                timestamp,
                "GET",
                path,
                "",
                secretKey
            );

            const response = await axios.get(
                `${process.env.KODIAK_API_URL || "https://api.orderly.org"}${path}`,
                {
                    headers: {
                        "orderly-account-id": accountId,
                        "orderly-key": apiKey,
                        "orderly-signature": signature,
                        "orderly-timestamp": timestamp.toString(),
                    },
                }
            );

            return response.data.data;
        } catch (error) {
            positionSyncLogger.error("Failed to sync account info from API", error as Error, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Store account information in database
     */
    private async storeAccountInfoInDatabase(
        userId: string,
        accountId: string,
        accountData: any
    ): Promise<void> {
        await query(`
    INSERT INTO kodiak_accounts (
      user_id, account_id, balance, max_leverage, max_notional,
      taker_fee_rate, maker_fee_rate, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id)
    DO UPDATE SET
      account_id = EXCLUDED.account_id,
      balance = EXCLUDED.balance,
      max_leverage = EXCLUDED.max_leverage,
      max_notional = EXCLUDED.max_notional,
      taker_fee_rate = EXCLUDED.taker_fee_rate,
      maker_fee_rate = EXCLUDED.maker_fee_rate,
      updated_at = EXCLUDED.updated_at
  `, [
            userId,
            accountId,
            accountData.total_balance || "0",
            accountData.max_leverage || "1",
            JSON.stringify(accountData.max_notional || {}),
            accountData.taker_fee_rate || "0.001",
            accountData.maker_fee_rate || "0.001",
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
            // Get user's Kodiak credentials
            const credsResult = await query(
                "SELECT account_id, api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE user_id = $1",
                [userId]
            );

            if (credsResult.rows.length === 0 || !credsResult.rows[0].verified) {
                return {
                    success: false,
                    positionsSynced: 0,
                    errors: ['Kodiak credentials not found or not verified'],
                    syncTimestamp,
                };
            }

            const { encryptionService } = await import("./encryption.js");
            const row = credsResult.rows[0];
            const accountId = row.account_id;
            const apiKey = encryptionService.decryptApiKey(row.api_key_encrypted);
            const secretKey = encryptionService.decryptSecretKey(row.secret_key_encrypted);

            // ✅ SYNC ACCOUNT INFO FIRST (for position validator)
            try {
                const accountData = await this.syncAccountInfoFromAPI(accountId, apiKey, secretKey);
                await this.storeAccountInfoInDatabase(userId, accountId, accountData);
                positionSyncLogger.debug("Account info synced", { userId, accountId });
            } catch (error) {
                const errorMsg = `Failed to sync account info: ${error}`;
                errors.push(errorMsg);
                positionSyncLogger.error("Account info sync error", error as Error, {
                    userId,
                    accountId,
                });
            }

            // Fetch positions from Kodiak API
            const positions = await this.fetchPositionsFromAPI(accountId, apiKey, secretKey);

            // Store positions in database as canonical source
            for (const position of positions) {
                try {
                    await this.storePositionInDatabase(userId, accountId, position);
                    positionsSynced++;
                } catch (error) {
                    const errorMsg = `Failed to store position for ${position.symbol}: ${error}`;
                    errors.push(errorMsg);
                    positionSyncLogger.error("Position storage error", error as Error, {
                        userId,
                        accountId,
                        symbol: position.symbol,
                    });
                }
            }

            // Invalidate position caches
            await this.invalidatePositionCaches(userId);

            positionSyncLogger.info("Position sync completed", {
                userId,
                accountId,
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
     * Fetch positions from Kodiak API
     */
    private async fetchPositionsFromAPI(
        accountId: string,
        apiKey: string,
        secretKey: string
    ): Promise<any[]> {
        const timestamp = Date.now();
        const path = "/v1/positions";
        const signature = await generateOrderlySignature(
            timestamp,
            "GET",
            path,
            "",
            secretKey
        );

        const response = await axios.get(
            `${process.env.KODIAK_API_URL || "https://api.orderly.org"}${path}`,
            {
                headers: {
                    "orderly-account-id": accountId,
                    "orderly-key": apiKey,
                    "orderly-signature": signature,
                    "orderly-timestamp": timestamp.toString(),
                },
            }
        );

        return response.data.data?.rows || [];
    }

    /**
     * Store position in database as canonical source
     */
    private async storePositionInDatabase(
        userId: string,
        accountId: string,
        positionData: any
    ): Promise<void> {
        const position: PositionData = {
            symbol: positionData.symbol,
            positionQty: parseFloat(positionData.position_qty || 0),
            costPosition: parseFloat(positionData.cost_position || 0),
            averageOpenPrice: parseFloat(positionData.average_open_price || 0),
            markPrice: parseFloat(positionData.mark_price || 0),
            unsettledPnl: parseFloat(positionData.unsettled_pnl || 0),
            pnl24h: parseFloat(positionData.pnl_24_h || 0),
            leverage: parseInt(positionData.leverage || 1),
            imr: parseFloat(positionData.imr || 0.1),
            mmr: parseFloat(positionData.mmr || 0.05),
            estLiqPrice: parseFloat(positionData.est_liq_price || 0),
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

            const positions: PositionData[] = result.rows.map(row => ({
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
            const usersResult = await query(`
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
            const credsResult = await query(
                "SELECT account_id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );

            let apiPositions = 0;
            if (credsResult.rows.length > 0) {
                const { encryptionService } = await import("./encryption.js");
                const row = credsResult.rows[0];
                const accountId = row.account_id;
                const apiKey = encryptionService.decryptApiKey(row.api_key_encrypted);
                const secretKey = encryptionService.decryptSecretKey(row.secret_key_encrypted);

                const apiPositionsData = await this.fetchPositionsFromAPI(accountId, apiKey, secretKey);
                apiPositions = apiPositionsData.length;

                // Check for significant discrepancies
                if (Math.abs(databasePositions - apiPositions) > 2) {
                    issues.push(`Position count mismatch: DB=${databasePositions}, API=${apiPositions}`);
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
