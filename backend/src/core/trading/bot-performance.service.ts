/**
 * Bot Performance Service
 *
 * Handles performance calculations, statistics aggregation, and performance data caching.
 * Provides comprehensive trading performance metrics for bots.
 */

import { query } from "../../database/pool";
import { redisService } from "../../infrastructure/cache/redis.service";
import { CACHE_EVENTS, CacheEvent, CacheInvalidationEvent, CacheRefreshEvent, CacheClearEvent, CACHE_KEYS } from "../../config/cache.config";
import { cacheInvalidationService } from "../../infrastructure/cache/cache-invalidation.service";
import { logger } from "../../core/logging";

export interface BotPerformance {
    bot: {
        id: string;
        status: string;
        runningTime: number;
        totalTrades: number;
        totalPnl: number;
    };
    performance: {
        totalTrades: number;
        winningTrades: number;
        losingTrades: number;
        totalPnl: number;
        avgPnl: number;
        totalVolume: number;
        winRate?: number;
        profitFactor?: number;
    };
    dailyPnl: Array<{
        date: string;
        dailyPnl: number;
    }>;
}

export interface PerformanceStats {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    avgPnl: number;
    totalVolume: number;
}

export interface DailyPnlData {
    date: string;
    dailyPnl: number;
}

/**
 * Bot Performance Service
 */
export class BotPerformanceService {
    private readonly PERFORMANCE_CACHE_TTL = 300; // 5 minutes for performance data

    /**
     * Get comprehensive bot performance data
     */
    async getBotPerformance(botId: string, userId: string): Promise<BotPerformance> {
        try {
            // Get bot basic information
            const botResult = await query(
                "SELECT * FROM bot_instances WHERE id = $1 AND user_id = $2",
                [botId, userId]
            );

            if (botResult.rows.length === 0) {
                throw new Error('Bot not found');
            }

            const bot = botResult.rows[0];

            // Get performance statistics
            const performanceStats = await this.getPerformanceStats(bot.strategy_id, userId);

            // Get daily P&L data
            const dailyPnl = await this.getDailyPnl(bot.strategy_id, userId);

            // Calculate additional metrics
            const winRate = performanceStats.totalTrades > 0
                ? (performanceStats.winningTrades / performanceStats.totalTrades) * 100
                : 0;

            const profitFactor = performanceStats.losingTrades > 0 && performanceStats.totalPnl > 0
                ? Math.abs(performanceStats.totalPnl / (performanceStats.losingTrades * performanceStats.avgPnl))
                : performanceStats.totalPnl > 0 ? 999 : 0;

            return {
                bot: {
                    id: bot.id,
                    status: bot.status,
                    runningTime: bot.running_time || 0,
                    totalTrades: bot.total_trades || 0,
                    totalPnl: parseFloat(bot.total_pnl || 0),
                },
                performance: {
                    ...performanceStats,
                    winRate,
                    profitFactor,
                },
                dailyPnl,
            };

        } catch (error) {
            logger.error("Failed to get bot performance", {
                botId,
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get performance statistics for a strategy
     */
    async getPerformanceStats(strategyId: string, userId: string): Promise<PerformanceStats> {
        try {
            // Check cache first
            const cacheKey = `bot:performance:stats:${strategyId}`;
            const cacheResult = await redisService.get(cacheKey);

            if (cacheResult.success && cacheResult.data) {
                const cachedStats = JSON.parse(cacheResult.data);
                logger.debug("Performance stats cache hit", { strategyId });
                return cachedStats;
            }

            // Calculate statistics from trades
            const statsResult = await query(
                `SELECT
          COUNT(*) as total_trades,
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
          SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_trades,
          COALESCE(SUM(pnl), 0) as total_pnl,
          COALESCE(AVG(pnl), 0) as avg_pnl,
          COALESCE(SUM(ABS(pnl)), 0) as total_volume
        FROM trades
        WHERE strategy_id = $1 AND user_id = $2`,
                [strategyId, userId]
            );

            const stats = statsResult.rows[0];

            const performanceStats: PerformanceStats = {
                totalTrades: parseInt(stats.total_trades || 0),
                winningTrades: parseInt(stats.winning_trades || 0),
                losingTrades: parseInt(stats.losing_trades || 0),
                totalPnl: parseFloat(stats.total_pnl || 0),
                avgPnl: parseFloat(stats.avg_pnl || 0),
                totalVolume: parseFloat(stats.total_volume || 0),
            };

            // Cache the results
            await redisService.setex(cacheKey, this.PERFORMANCE_CACHE_TTL, JSON.stringify(performanceStats));

            logger.debug("Performance stats calculated and cached", {
                strategyId,
                totalTrades: performanceStats.totalTrades,
            });

            return performanceStats;

        } catch (error) {
            logger.error("Failed to get performance stats", {
                strategyId,
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get daily P&L data for a strategy
     */
    async getDailyPnl(strategyId: string, userId: string, days: number = 30): Promise<DailyPnlData[]> {
        try {
            // Check cache first
            const cacheKey = `bot:performance:daily:${strategyId}:${days}`;
            const cacheResult = await redisService.get(cacheKey);

            if (cacheResult.success && cacheResult.data) {
                const cachedData = JSON.parse(cacheResult.data);
                logger.debug("Daily P&L cache hit", { strategyId, days });
                return cachedData;
            }

            // Get daily P&L from database
            const dailyResult = await query(
                `SELECT
          DATE(executed_at) as date,
          COALESCE(SUM(pnl), 0) as daily_pnl
        FROM trades
        WHERE strategy_id = $1 AND user_id = $2
        GROUP BY DATE(executed_at)
        ORDER BY date DESC
        LIMIT $3`,
                [strategyId, userId, days]
            );

            const dailyPnl: DailyPnlData[] = dailyResult.rows.map(row => ({
                date: row.date,
                dailyPnl: parseFloat(row.daily_pnl || 0),
            }));

            // Cache the results
            await redisService.setex(cacheKey, this.PERFORMANCE_CACHE_TTL, JSON.stringify(dailyPnl));

            logger.debug("Daily P&L calculated and cached", {
                strategyId,
                days,
                dataPoints: dailyPnl.length,
            });

            return dailyPnl;

        } catch (error) {
            logger.error("Failed to get daily P&L", {
                strategyId,
                userId,
                days,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get performance summary for multiple bots
     */
    async getBotsPerformanceSummary(userId: string): Promise<BotPerformance[]> {
        try {
            // Get all user's bots
            const botsResult = await query(
                `SELECT bi.*, s.name as strategy_name, s.type as strategy_type
         FROM bot_instances bi
         JOIN strategies s ON bi.strategy_id = s.id
         WHERE bi.user_id = $1
         ORDER BY bi.created_at DESC`,
                [userId]
            );

            const performances: BotPerformance[] = [];

            for (const bot of botsResult.rows) {
                try {
                    const performance = await this.getBotPerformance(bot.id, userId);
                    performances.push(performance);
                } catch (botError) {
                    logger.warn("Failed to get performance for bot", {
                        botId: bot.id,
                        error: botError instanceof Error ? botError.message : String(botError),
                    });

                    // Add basic info for bots with errors
                    performances.push({
                        bot: {
                            id: bot.id,
                            status: bot.status,
                            runningTime: bot.running_time || 0,
                            totalTrades: bot.total_trades || 0,
                            totalPnl: parseFloat(bot.total_pnl || 0),
                        },
                        performance: {
                            totalTrades: 0,
                            winningTrades: 0,
                            losingTrades: 0,
                            totalPnl: 0,
                            avgPnl: 0,
                            totalVolume: 0,
                        },
                        dailyPnl: [],
                    });
                }
            }

            return performances;

        } catch (error) {
            logger.error("Failed to get bots performance summary", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Calculate advanced performance metrics
     */
    calculateAdvancedMetrics(stats: PerformanceStats): {
        winRate: number;
        profitFactor: number;
        avgWin: number;
        avgLoss: number;
        largestWin: number;
        largestLoss: number;
        sharpeRatio?: number; // Would need more data for this
    } {
        const winRate = stats.totalTrades > 0 ? (stats.winningTrades / stats.totalTrades) * 100 : 0;

        // Estimate profit factor (simplified)
        const profitFactor = stats.losingTrades > 0 && stats.totalPnl > 0
            ? Math.abs(stats.totalPnl / (stats.losingTrades * stats.avgPnl))
            : stats.totalPnl > 0 ? 999 : 0;

        // Estimate average win/loss (simplified approximation)
        const avgWin = stats.winningTrades > 0 ? (stats.totalPnl * 0.7) / stats.winningTrades : 0;
        const avgLoss = stats.losingTrades > 0 ? (stats.totalPnl * 0.3) / stats.losingTrades : 0;

        // Estimate largest win/loss (rough approximation)
        const largestWin = avgWin * 2.5; // Assuming some trades are larger
        const largestLoss = Math.abs(avgLoss) * 2.5;

        return {
            winRate,
            profitFactor,
            avgWin,
            avgLoss,
            largestWin,
            largestLoss,
        };
    }

    /**
     * Invalidate performance cache for a bot
     */
    async invalidateBotPerformance(botId: string, strategyId: string): Promise<void> {
        try {
            // Invalidate performance-related caches
            const cacheKeys = [
                `bot:performance:stats:${strategyId}`,
                `bot:performance:daily:${strategyId}:30`,
                `bot:performance:daily:${strategyId}:7`,
                `bot:performance:daily:${strategyId}:90`,
            ];

            await cacheInvalidationService.invalidateWithBroadcast(
                cacheKeys,
                'bot_performance_updated',
                undefined // No specific user
            );

            logger.debug("Bot performance caches invalidated", {
                botId,
                strategyId,
                cacheKeysInvalidated: cacheKeys.length,
            });

        } catch (error) {
            logger.error("Failed to invalidate bot performance cache", {
                botId,
                strategyId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get performance trends over time
     */
    async getPerformanceTrends(
        strategyId: string,
        userId: string,
        period: 'daily' | 'weekly' | 'monthly' = 'daily',
        limit: number = 30
    ): Promise<Array<{
        period: string;
        totalTrades: number;
        totalPnl: number;
        winRate: number;
    }>> {
        try {
            let dateFormat: string;
            let groupBy: string;

            switch (period) {
                case 'weekly':
                    dateFormat = 'YYYY-WW';
                    groupBy = "DATE_TRUNC('week', executed_at)";
                    break;
                case 'monthly':
                    dateFormat = 'YYYY-MM';
                    groupBy = "DATE_TRUNC('month', executed_at)";
                    break;
                case 'daily':
                default:
                    dateFormat = 'YYYY-MM-DD';
                    groupBy = "DATE_TRUNC('day', executed_at)";
                    break;
            }

            const trendsResult = await query(
                `SELECT
          ${groupBy} as period,
          COUNT(*) as total_trades,
          COALESCE(SUM(pnl), 0) as total_pnl,
          ROUND(
            (SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)::decimal / COUNT(*)) * 100,
            2
          ) as win_rate
        FROM trades
        WHERE strategy_id = $1 AND user_id = $2
        GROUP BY ${groupBy}
        ORDER BY period DESC
        LIMIT $3`,
                [strategyId, userId, limit]
            );

            return trendsResult.rows.map(row => ({
                period: row.period,
                totalTrades: parseInt(row.total_trades),
                totalPnl: parseFloat(row.total_pnl),
                winRate: parseFloat(row.win_rate || 0),
            }));

        } catch (error) {
            logger.error("Failed to get performance trends", {
                strategyId,
                userId,
                period,
                limit,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Clean up old performance cache entries
     */
    async cleanupOldCache(): Promise<{ cleanedKeys: number }> {
        try {
            // This would be more complex in a real implementation
            // For now, we'll just log that cleanup would happen
            logger.info("Performance cache cleanup requested");

            // In a real implementation, you might:
            // 1. Scan for old cache keys using Redis SCAN
            // 2. Delete keys older than a certain age
            // 3. Return count of cleaned keys

            return { cleanedKeys: 0 };

        } catch (error) {
            logger.error("Failed to cleanup performance cache", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}

// Export singleton instance
export const botPerformanceService = new BotPerformanceService();
