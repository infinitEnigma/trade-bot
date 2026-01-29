/**
 * Bot Reconciliation Worker
 *
 * Handles background reconciliation of bot trading activities,
 * position synchronization, and trade settlement processing.
 * Ensures consistency between internal state and external exchange data.
 */

import { logger } from "../core/logging";
import { query } from "../database/pool";

/**
 * Bot data interfaces
 */
interface BotData {
    id: string;
    user_id: string;
    strategy_id: string;
    status: string;
    running_time: string;
    total_trades: number;
    strategy_name: string;
    strategy_type: string;
    user_email: string;
}

/**
 * Bot Reconciliation Worker
 *
 * This worker performs periodic reconciliation tasks:
 * - Sync bot positions with exchange data
 * - Validate trade settlements
 * - Reconcile account balances
 * - Handle failed trade recoveries
 */
export class BotReconciliationWorker {
    private isRunning = false;
    private reconciliationInterval: NodeJS.Timeout | null = null;

    /**
     * Start the reconciliation worker
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn("Bot reconciliation worker is already running");
            return;
        }

        this.isRunning = true;
        logger.info("Starting bot reconciliation worker");

        // Run initial reconciliation
        await this.performReconciliation();

        // Schedule periodic reconciliation (every 5 minutes)
        this.reconciliationInterval = setInterval(async () => {
            try {
                await this.performReconciliation();
            } catch (error) {
                logger.error("Error in scheduled reconciliation", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }, 5 * 60 * 1000); // 5 minutes

        logger.info("Bot reconciliation worker started successfully");
    }

    /**
     * Stop the reconciliation worker
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            logger.warn("Bot reconciliation worker is not running");
            return;
        }

        this.isRunning = false;

        if (this.reconciliationInterval) {
            clearInterval(this.reconciliationInterval);
            this.reconciliationInterval = null;
        }

        logger.info("Bot reconciliation worker stopped");
    }

    /**
     * Perform reconciliation tasks
     */
    private async performReconciliation(): Promise<void> {
        const startTime = Date.now();

        try {
            logger.info("Starting bot reconciliation cycle");

            // Get all active bots
            const activeBots = await this.getActiveBots();

            if (activeBots.length === 0) {
                logger.info("No active bots to reconcile");
                return;
            }

            logger.info("Reconciling active bots", { count: activeBots.length });

            // Process each active bot
            for (const bot of activeBots) {
                try {
                    await this.reconcileBot(bot);
                } catch (error) {
                    logger.error("Failed to reconcile bot", {
                        botId: bot.id,
                        userId: bot.user_id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            const duration = Date.now() - startTime;
            logger.info("Bot reconciliation cycle completed", {
                duration: `${duration}ms`,
                botsProcessed: activeBots.length,
            });

        } catch (error) {
            logger.error("Bot reconciliation cycle failed", {
                error: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime,
            });
        }
    }

    /**
     * Get all active bots that need reconciliation
     */
    private async getActiveBots(): Promise<BotData[]> {
        try {
            const result = await query<BotData>(`
        SELECT
          bi.id,
          bi.user_id,
          bi.strategy_id,
          bi.status,
          bi.running_time,
          bi.total_trades,
          s.name as strategy_name,
          s.type as strategy_type,
          u.email as user_email
        FROM bot_instances bi
        JOIN strategies s ON bi.strategy_id = s.id
        JOIN users u ON bi.user_id = u.id
        WHERE bi.status IN ('RUNNING', 'STARTING')
        AND s.active = true
      `);

            return result.rows;
        } catch (error) {
            logger.error("Failed to get active bots", {
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * Reconcile a single bot
     */
    private async reconcileBot(bot: BotData): Promise<void> {
        logger.debug("Reconciling bot", {
            botId: bot.id,
            userId: bot.user_id,
            strategyName: bot.strategy_name,
        });

        try {
            // Check if bot user has Kodiak credentials
            const hasCredentials = await this.checkUserHasCredentials(bot.user_id);

            if (!hasCredentials) {
                logger.warn("Bot reconciliation skipped - user has no Kodiak credentials", {
                    botId: bot.id,
                    userId: bot.user_id,
                });
                return;
            }

            // Sync positions for this user
            await this.syncUserPositions(bot.user_id);

            // Validate recent trades
            await this.validateRecentTrades(bot.user_id, bot.id);

            // Update bot statistics
            await this.updateBotStatistics(bot.id);

            logger.debug("Bot reconciliation completed", {
                botId: bot.id,
                userId: bot.user_id,
            });

        } catch (error) {
            logger.error("Bot reconciliation failed", {
                botId: bot.id,
                userId: bot.user_id,
                error: error instanceof Error ? error.message : String(error),
            });

            // Mark bot as having errors if reconciliation consistently fails
            await this.markBotAsError(bot.id, error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Check if user has valid Kodiak credentials
     */
    private async checkUserHasCredentials(userId: string): Promise<boolean> {
        try {
            const result = await query(
                "SELECT verified FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
                [userId]
            );

            return result.rows.length > 0;
        } catch (error) {
            logger.error("Failed to check user credentials", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    /**
     * Sync user positions with exchange data
     */
    private async syncUserPositions(userId: string): Promise<void> {
        // This would typically call Kodiak API to get current positions
        // and update the local database
        logger.debug("Position sync placeholder", { userId });

        // TODO: Implement actual position synchronization
        // - Fetch positions from Kodiak API
        // - Compare with local positions
        // - Update local database
        // - Log discrepancies
    }

    /**
     * Validate recent trades for a bot
     */
    private async validateRecentTrades(userId: string, botId: string): Promise<void> {
        // This would validate that trades recorded locally match exchange data
        logger.debug("Trade validation placeholder", { userId, botId });

        // TODO: Implement trade validation
        // - Get recent trades from local DB
        // - Cross-reference with exchange data
        // - Mark any discrepancies
        // - Handle failed trades
    }

    /**
     * Update bot statistics
     */
    private async updateBotStatistics(botId: string): Promise<void> {
        try {
            // Calculate and update bot statistics
            const statsResult = await query<{
                trade_count: string;
                total_pnl: string;
                avg_pnl: string;
                last_trade_time: string;
            }>(`
        SELECT
          COUNT(*) as trade_count,
          SUM(pnl) as total_pnl,
          AVG(pnl) as avg_pnl,
          MAX(executed_at) as last_trade_time
        FROM trades
        WHERE bot_id = $1
        AND executed_at >= NOW() - INTERVAL '24 hours'
      `, [botId]);

            if (statsResult.rows.length > 0) {
                const stats = statsResult.rows[0];

                await query(`
          UPDATE bot_instances
          SET
            total_trades = $1,
            total_pnl = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [
                    stats.trade_count || 0,
                    stats.total_pnl || 0,
                    botId
                ]);
            }

        } catch (error) {
            logger.error("Failed to update bot statistics", {
                botId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Mark bot as having errors
     */
    private async markBotAsError(botId: string, errorMessage: string): Promise<void> {
        try {
            await query(`
        UPDATE bot_instances
        SET
          status = 'ERROR',
          last_error = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [errorMessage, botId]);

            logger.warn("Marked bot as error", { botId, errorMessage });
        } catch (error) {
            logger.error("Failed to mark bot as error", {
                botId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get worker status for monitoring
     */
    getStatus(): {
        isRunning: boolean;
        lastReconciliationTime?: Date;
    } {
        return {
            isRunning: this.isRunning,
        };
    }

    /**
     * Cleanup method for test environments
     * Stops all intervals and timers
     */
    cleanupForTests(): void {
        try {
            if (this.isRunning) {
                this.stop();
            }

            // Ensure interval is cleared
            if (this.reconciliationInterval) {
                clearInterval(this.reconciliationInterval);
                this.reconciliationInterval = null;
            }

            logger.info("Bot reconciliation worker cleaned up for tests");
        } catch (error) {
            logger.error("Error during bot reconciliation cleanup", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

// Export singleton instance
export const botReconciliationWorker = new BotReconciliationWorker();
