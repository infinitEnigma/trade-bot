/**
 * Bot Status Service
 *
 * Centralizes bot status validation, reconciliation, and health checking logic.
 * Provides consistent status management across the application.
 */

import { query } from "../database/pool";
import { engineManager } from "./engine-manager";
import { cacheInvalidationService } from "./cache-invalidation";
import logger from "./logger";

export interface BotStatusValidation {
    updatedStatus: string;
    errorMessage: string | null;
    isStale: boolean;
    lastHeartbeatAge: number;
}

export interface BotStatusReconciliation {
    statusChanged: boolean;
    newStatus: string;
    errorMessage: string | null;
    reason: string;
    engineHealth: {
        running: boolean;
        lastHealthCheck: number;
        status: string;
    };
}

export interface EngineHealthStatus {
    running: boolean;
    lastHealthCheck: number;
    status: string;
}

/**
 * Bot Status Service
 */
export class BotStatusService {
    private readonly HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds
    private readonly RECOVERY_TIMEOUT_MS = 30000; // 30 seconds for recovery

    /**
     * Validate bot status based on heartbeat and current state
     */
    async validateBotStatus(botData: any, currentTime: number): Promise<BotStatusValidation> {
        const lastHeartbeat = botData.last_heartbeat ? new Date(botData.last_heartbeat).getTime() : 0;
        const heartbeatAge = currentTime - lastHeartbeat;
        const isStale = heartbeatAge > this.HEARTBEAT_TIMEOUT_MS;

        // If bot is running but heartbeat is stale, mark as error
        if (botData.status === 'RUNNING' && isStale) {
            return {
                updatedStatus: 'ERROR',
                errorMessage: 'Bot heartbeat timeout - status validation',
                isStale: true,
                lastHeartbeatAge: heartbeatAge,
            };
        }

        // If bot is in error state but heartbeat is recent, check if it recovered
        if (botData.status === 'ERROR' && !isStale && botData.last_error?.includes('heartbeat timeout')) {
            return {
                updatedStatus: 'RUNNING',
                errorMessage: null,
                isStale: false,
                lastHeartbeatAge: heartbeatAge,
            };
        }

        return {
            updatedStatus: botData.status,
            errorMessage: botData.last_error,
            isStale,
            lastHeartbeatAge: heartbeatAge,
        };
    }

    /**
     * Get engine health status for status validation
     */
    async getEngineHealthStatus(): Promise<EngineHealthStatus> {
        try {
            const status = await engineManager.getEngineStatus();
            return {
                running: status.running,
                lastHealthCheck: Date.now(),
                status: status.health?.status || 'unknown',
            };
        } catch (error) {
            return {
                running: false,
                lastHealthCheck: Date.now(),
                status: 'error',
            };
        }
    }

    /**
     * Perform comprehensive bot status reconciliation
     */
    async reconcileBotStatus(botData: any, currentTime: number): Promise<BotStatusReconciliation> {
        const engineHealth = await this.getEngineHealthStatus();
        const validation = await this.validateBotStatus(botData, currentTime);

        // If engine is not running but bot is supposed to be running
        if (!engineHealth.running && ['RUNNING', 'STARTING'].includes(botData.status)) {
            return {
                statusChanged: true,
                newStatus: 'ERROR',
                errorMessage: 'Engine not running - status reconciliation',
                reason: 'engine_down',
                engineHealth,
            };
        }

        // If status validation indicates a change
        if (validation.updatedStatus !== botData.status) {
            return {
                statusChanged: true,
                newStatus: validation.updatedStatus,
                errorMessage: validation.errorMessage,
                reason: validation.isStale ? 'heartbeat_timeout' : 'status_recovery',
                engineHealth,
            };
        }

        // Check for strategy consistency
        try {
            const strategyResult = await query(
                "SELECT active FROM strategies WHERE id = $1",
                [botData.strategy_id]
            );

            if (strategyResult.rows.length > 0) {
                const strategy = strategyResult.rows[0];

                // If strategy is inactive but bot is running, stop the bot
                if (!strategy.active && botData.status === 'RUNNING') {
                    return {
                        statusChanged: true,
                        newStatus: 'STOPPED',
                        errorMessage: 'Strategy deactivated - status reconciliation',
                        reason: 'strategy_inactive',
                        engineHealth,
                    };
                }

                // If strategy is active but bot is stopped, this might indicate inconsistency
                if (strategy.active && botData.status === 'STOPPED') {
                    return {
                        statusChanged: false,
                        newStatus: botData.status,
                        errorMessage: null,
                        reason: 'strategy_active_bot_stopped',
                        engineHealth,
                    };
                }
            }
        } catch (error) {
            logger.warn("Strategy consistency check failed during reconciliation", {
                botId: botData.id,
                error: (error as Error).message,
            });
        }

        return {
            statusChanged: false,
            newStatus: botData.status,
            errorMessage: botData.last_error,
            reason: 'no_changes_needed',
            engineHealth,
        };
    }

    /**
     * Check if a bot has recovered from error state
     */
    async checkBotRecovery(botData: any): Promise<boolean> {
        if (botData.status !== 'ERROR' || !botData.last_error?.includes('heartbeat timeout')) {
            return false;
        }

        const lastHeartbeat = botData.last_heartbeat ? new Date(botData.last_heartbeat).getTime() : 0;
        const timeSinceHeartbeat = Date.now() - lastHeartbeat;

        // If heartbeat is recent (< 30 seconds), bot may have recovered
        return timeSinceHeartbeat < this.RECOVERY_TIMEOUT_MS;
    }

    /**
     * Update bot status in database with audit logging
     */
    async updateBotStatus(
        botId: string,
        newStatus: string,
        errorMessage: string | null = null,
        reason: string = 'manual_update'
    ): Promise<void> {
        try {
            // Update bot status
            await query(
                "UPDATE bot_instances SET status = $1, last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
                [newStatus, errorMessage, botId]
            );

            // Log status change
            await query(
                "INSERT INTO audit_logs (user_id, action, details) VALUES ((SELECT user_id FROM bot_instances WHERE id = $1), $2, $3)",
                [
                    botId,
                    "BOT_STATUS_UPDATED",
                    {
                        botId,
                        newStatus,
                        errorMessage,
                        reason,
                        timestamp: new Date().toISOString(),
                    },
                ]
            );

            logger.info("Bot status updated", {
                botId,
                newStatus,
                errorMessage,
                reason,
            });

        } catch (error) {
            logger.error("Failed to update bot status", {
                botId,
                newStatus,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get comprehensive bot status information
     */
    async getBotStatusInfo(botId: string, userId: string): Promise<any> {
        try {
            const result = await query(
                `SELECT bi.*, s.name as strategy_name, s.type as strategy_type
         FROM bot_instances bi
         JOIN strategies s ON bi.strategy_id = s.id
         WHERE bi.id = $1 AND bi.user_id = $2`,
                [botId, userId]
            );

            if (result.rows.length === 0) {
                throw new Error('Bot not found');
            }

            const botData = result.rows[0];
            const now = Date.now();

            // Get validation and health information
            const statusValidation = await this.validateBotStatus(botData, now);
            const engineHealth = await this.getEngineHealthStatus();

            // Update status if validation indicates changes
            if (statusValidation.updatedStatus !== botData.status) {
                await this.updateBotStatus(
                    botId,
                    statusValidation.updatedStatus,
                    statusValidation.errorMessage,
                    'status_validation'
                );

                botData.status = statusValidation.updatedStatus;
                botData.last_error = statusValidation.errorMessage;
            }

            return {
                ...botData,
                statusValidation: {
                    isStale: statusValidation.isStale,
                    lastHeartbeatAge: statusValidation.lastHeartbeatAge,
                    engineHealth,
                },
                timestamp: now,
            };

        } catch (error) {
            logger.error("Failed to get bot status info", {
                botId,
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Validate bot belongs to user and get bot data
     */
    async validateBotOwnership(botId: string, userId: string): Promise<any> {
        const result = await query(
            "SELECT * FROM bot_instances WHERE id = $1 AND user_id = $2",
            [botId, userId]
        );

        if (result.rows.length === 0) {
            throw new Error('Bot not found or access denied');
        }

        return result.rows[0];
    }

    /**
     * Check if bot can be started (no conflicts)
     */
    async canStartBot(strategyId: string): Promise<{ canStart: boolean; reason?: string }> {
        const existingBot = await query(
            "SELECT id, status FROM bot_instances WHERE strategy_id = $1 AND status IN ('RUNNING', 'STARTING')",
            [strategyId]
        );

        if (existingBot.rows.length > 0) {
            return {
                canStart: false,
                reason: 'Bot already running for this strategy',
            };
        }

        return { canStart: true };
    }

    /**
     * Check if bot can be stopped
     */
    async canStopBot(botData: any): Promise<{ canStop: boolean; reason?: string }> {
        if (botData.status !== 'RUNNING') {
            return {
                canStop: false,
                reason: 'Bot is not currently running',
            };
        }

        return { canStop: true };
    }

    /**
     * Get bot statistics for monitoring
     */
    async getBotStats(): Promise<{
        totalBots: number;
        runningBots: number;
        errorBots: number;
        staleBots: number;
    }> {
        try {
            const totalResult = await query("SELECT COUNT(*) as count FROM bot_instances");
            const runningResult = await query("SELECT COUNT(*) as count FROM bot_instances WHERE status = 'RUNNING'");
            const errorResult = await query("SELECT COUNT(*) as count FROM bot_instances WHERE status = 'ERROR'");
            const staleResult = await query(`
        SELECT COUNT(*) as count FROM bot_instances
        WHERE status = 'RUNNING'
        AND last_heartbeat < NOW() - INTERVAL '${this.HEARTBEAT_TIMEOUT_MS / 1000} seconds'
      `);

            return {
                totalBots: parseInt(totalResult.rows[0].count),
                runningBots: parseInt(runningResult.rows[0].count),
                errorBots: parseInt(errorResult.rows[0].count),
                staleBots: parseInt(staleResult.rows[0].count),
            };

        } catch (error) {
            logger.error("Failed to get bot stats", {
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                totalBots: 0,
                runningBots: 0,
                errorBots: 0,
                staleBots: 0,
            };
        }
    }
}

// Export singleton instance
export const botStatusService = new BotStatusService();
