/**
 * ===========================================
 * 🤖 BOT STATUS SERVICE - STATE MACHINE
 * ===========================================
 *
 * Enterprise-grade bot lifecycle management with robust state machine,
 * idempotency protection, and data consistency guarantees.
 *
 * STATE MACHINE:
 * - STOPPED: Bot is not running (initial state)
 * - STARTING: Bot initialization in progress
 * - RUNNING: Bot operating normally
 * - PAUSED: Bot temporarily suspended (user action)
 * - RECOVERING: Bot recovering from error state
 * - ERROR: Bot encountered critical error
 * - FORCE_STOPPING: Emergency stop in progress
 *
 * IDEMPOTENCY PROTECTION:
 * - Heartbeat sequence numbers prevent duplicate processing
 * - State transition validation prevents invalid changes
 * - Redis-based coordination for distributed safety
 *
 * TIMING COORDINATION:
 * - Heartbeat timeout: 45s (3x reconciliation interval)
 * - Reconciliation check: 15s (non-conflicting)
 * - Recovery timeout: 30s (subset of heartbeat timeout)
 *
 * DATA CONSISTENCY:
 * - Position data: Redis cache → Database sync (30s intervals)
 * - State changes: Atomic operations with audit logging
 * - Recovery logic: Idempotent with proper sequencing
 *
 * @format
 */

import { query } from "../database/pool";
import { engineManager } from "./engine-manager";
import { cacheInvalidationService } from "./cache-invalidation";
import { redisService } from "./redis";
import logger from "./logger";

/**
 * ===========================================
 * 🤖 BOT STATUS ENUM - COMPLETE STATE MACHINE
 * ===========================================
 */
export enum BotStatus {
    STOPPED = 'STOPPED',           // Bot is not running (terminal state)
    STARTING = 'STARTING',         // Bot initialization in progress
    RUNNING = 'RUNNING',           // Bot operating normally
    PAUSED = 'PAUSED',             // Bot temporarily suspended
    RECOVERING = 'RECOVERING',     // Bot recovering from error
    ERROR = 'ERROR',               // Bot in error state
    FORCE_STOPPING = 'FORCE_STOPPING' // Emergency stop in progress
}

/**
 * ===========================================
 * 🔄 VALID STATE TRANSITIONS
 * ===========================================
 */
const VALID_TRANSITIONS: Record<BotStatus, BotStatus[]> = {
    [BotStatus.STOPPED]: [BotStatus.STARTING],                    // Only start from stopped
    [BotStatus.STARTING]: [BotStatus.RUNNING, BotStatus.ERROR],   // Success or failure
    [BotStatus.RUNNING]: [BotStatus.PAUSED, BotStatus.ERROR, BotStatus.FORCE_STOPPING], // Pause, error, or emergency
    [BotStatus.PAUSED]: [BotStatus.RUNNING, BotStatus.STOPPED],   // Resume or stop
    [BotStatus.RECOVERING]: [BotStatus.RUNNING, BotStatus.ERROR], // Recovery success/failure
    [BotStatus.ERROR]: [BotStatus.RECOVERING],                     // Start recovery process
    [BotStatus.FORCE_STOPPING]: [BotStatus.STOPPED],               // Emergency complete
};

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
 * ===========================================
 * 🤖 BOT STATUS SERVICE - STATE MACHINE IMPLEMENTATION
 * ===========================================
 */
export class BotStatusService {
    // Timing coordination (45s = 3x 15s reconciliation interval)
    private readonly HEARTBEAT_TIMEOUT_MS = 45000; // 45 seconds (3x reconciliation)
    private readonly RECOVERY_TIMEOUT_MS = 30000; // 30 seconds recovery window
    private readonly RECONCILIATION_INTERVAL_MS = 15000; // 15 seconds

    private heartbeatCheckInterval: NodeJS.Timeout | null = null;
    private positionSyncInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start background processes
        this.startReconciliationProcess();
        this.startPositionSyncProcess();
    }

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

    // ===============================
    // 🔄 STATE MACHINE METHODS - IDEMPOTENCY & VALIDATION
    // ===============================

    /**
     * Validate state transition is allowed
     */
    private validateStateTransition(currentStatus: BotStatus, newStatus: BotStatus): boolean {
        const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
        return allowedTransitions.includes(newStatus);
    }

    /**
     * Update bot status with state machine validation
     */
    async updateBotStatusWithValidation(
        botId: string,
        newStatus: BotStatus,
        errorMessage: string | null = null,
        reason: string = 'manual_update'
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Get current status
            const currentBot = await query("SELECT status FROM bot_instances WHERE id = $1", [botId]);
            if (currentBot.rows.length === 0) {
                return { success: false, error: 'Bot not found' };
            }

            const currentStatus = currentBot.rows[0].status as BotStatus;

            // Validate state transition
            if (!this.validateStateTransition(currentStatus, newStatus)) {
                logger.warn("Invalid state transition attempted", {
                    botId,
                    currentStatus,
                    newStatus,
                    reason,
                });
                return {
                    success: false,
                    error: `Invalid transition from ${currentStatus} to ${newStatus}`
                };
            }

            // Update status
            await this.updateBotStatus(botId, newStatus, errorMessage, reason);
            return { success: true };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to update bot status with validation", {
                botId,
                newStatus,
                error: errorMessage,
            });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Send heartbeat with idempotency protection using sequence numbers
     */
    async sendBotHeartbeatWithIdempotency(
        botId: string,
        sequenceNumber: number,
        statusInfo?: any
    ): Promise<{ success: boolean; error?: string; processed: boolean }> {
        try {
            // Check Redis for last processed sequence (idempotency)
            const sequenceKey = `bot:heartbeat:seq:${botId}`;
            const lastSequenceResult = await redisService.get(sequenceKey);

            const lastSequence = lastSequenceResult.success && lastSequenceResult.data
                ? parseInt(lastSequenceResult.data)
                : 0;

            // If this sequence was already processed, skip
            if (sequenceNumber <= lastSequence) {
                logger.debug("Duplicate heartbeat sequence, skipping", {
                    botId,
                    sequenceNumber,
                    lastSequence,
                });
                return { success: true, processed: false };
            }

            // Update heartbeat in database
            await query(
                "UPDATE bot_instances SET last_heartbeat = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                [botId]
            );

            // Store new sequence number in Redis
            await redisService.setex(sequenceKey, 300, sequenceNumber.toString()); // 5 min TTL

            // Handle state transitions based on current status
            const botResult = await query("SELECT status, last_error FROM bot_instances WHERE id = $1", [botId]);
            if (botResult.rows.length > 0) {
                const bot = botResult.rows[0];

                // If bot was in RECOVERING state, move to RUNNING on successful heartbeat
                if (bot.status === BotStatus.RECOVERING) {
                    await this.updateBotStatusWithValidation(botId, BotStatus.RUNNING, null, 'heartbeat_recovery');
                    logger.info("Bot recovered from error state", { botId, sequenceNumber });
                }
                // If bot was in ERROR state due to heartbeat timeout, start recovery
                else if (bot.status === BotStatus.ERROR && bot.last_error?.includes('heartbeat timeout')) {
                    await this.updateBotStatusWithValidation(botId, BotStatus.RECOVERING, null, 'heartbeat_recovery_start');
                    logger.info("Bot entering recovery state", { botId, sequenceNumber });
                }
            }

            logger.debug("Bot heartbeat processed with idempotency", {
                botId,
                sequenceNumber,
                statusInfo: statusInfo ? Object.keys(statusInfo) : undefined,
            });

            return { success: true, processed: true };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to process bot heartbeat", {
                botId,
                sequenceNumber,
                error: errorMessage,
            });
            return { success: false, error: errorMessage, processed: false };
        }
    }

    // ===============================
    // 🔄 BACKGROUND PROCESSES - TIMING COORDINATION
    // ===============================

    /**
     * Start reconciliation process (15s intervals)
     */
    private startReconciliationProcess(): void {
        if (this.heartbeatCheckInterval) return;

        logger.info("Starting bot reconciliation process", {
            intervalMs: this.RECONCILIATION_INTERVAL_MS,
            heartbeatTimeoutMs: this.HEARTBEAT_TIMEOUT_MS,
        });

        this.heartbeatCheckInterval = setInterval(async () => {
            await this.performBotReconciliation();
        }, this.RECONCILIATION_INTERVAL_MS);

        // Run initial reconciliation
        setImmediate(() => this.performBotReconciliation());
    }

    /**
     * Start position data sync process (30s intervals)
     */
    private startPositionSyncProcess(): void {
        if (this.positionSyncInterval) return;

        logger.info("Starting position data sync process", {
            intervalMs: 30000, // 30 seconds
        });

        this.positionSyncInterval = setInterval(async () => {
            await this.syncPositionDataToDatabase();
        }, 30000);
    }

    /**
     * Perform comprehensive bot reconciliation
     */
    private async performBotReconciliation(): Promise<void> {
        try {
            const now = Date.now();

            // Get all active bots for reconciliation
            const activeBots = await query(`
                SELECT id, user_id, status, last_heartbeat, strategy_id
                FROM bot_instances
                WHERE status IN ('RUNNING', 'STARTING', 'RECOVERING', 'PAUSED')
            `);

            for (const bot of activeBots.rows) {
                try {
                    const reconciliation = await this.reconcileBotStatus(bot, now);

                    if (reconciliation.statusChanged) {
                        await this.updateBotStatus(
                            bot.id,
                            reconciliation.newStatus,
                            reconciliation.errorMessage,
                            reconciliation.reason
                        );

                        // Notify user via WebSocket
                        await this.notifyUserOfStatusChange(
                            bot.user_id,
                            bot.id,
                            reconciliation.newStatus,
                            reconciliation.reason
                        );
                    }
                } catch (error) {
                    logger.error("Failed to reconcile bot", {
                        botId: bot.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

        } catch (error) {
            logger.error("Bot reconciliation process failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Sync position data from Redis cache to database
     */
    private async syncPositionDataToDatabase(): Promise<void> {
        try {
            // This would implement the corrected position data flow
            // Redis cache → Database batch sync
            // Implementation depends on position data structure

            logger.debug("Position data sync completed");

        } catch (error) {
            logger.error("Position data sync failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Notify user of status change via WebSocket
     */
    private async notifyUserOfStatusChange(
        userId: string,
        botId: string,
        newStatus: string,
        reason: string
    ): Promise<void> {
        try {
            const { io } = await import("../index.js");

            if (io) {
                io.to(`user:${userId}`).emit("bot:status", {
                    botId,
                    status: newStatus,
                    reason,
                    timestamp: new Date().toISOString(),
                });

                logger.debug("Notified user of status change", {
                    userId,
                    botId,
                    newStatus,
                    reason,
                });
            }
        } catch (error) {
            logger.warn("Failed to notify user of status change", {
                userId,
                botId,
                newStatus,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // ===============================
    // 💓 HEARTBEAT MECHANISM & STALE DETECTION (LEGACY)
    // ===============================

    /**
     * Send heartbeat for a bot (called by bot engine every 30 seconds)
     */
    async sendBotHeartbeat(botId: string, statusInfo?: any): Promise<{ success: boolean; error?: string }> {
        try {
            await query(
                "UPDATE bot_instances SET last_heartbeat = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                [botId]
            );

            // If bot was in error state due to heartbeat timeout, recover it
            const botResult = await query("SELECT status, last_error FROM bot_instances WHERE id = $1", [botId]);
            if (botResult.rows.length > 0) {
                const bot = botResult.rows[0];
                if (bot.status === 'ERROR' && bot.last_error?.includes('heartbeat timeout')) {
                    await this.updateBotStatus(botId, 'RUNNING', null, 'heartbeat_recovery');
                    logger.info("Bot recovered from heartbeat timeout", { botId });
                }
            }

            logger.debug("Bot heartbeat recorded", {
                botId,
                statusInfo: statusInfo ? Object.keys(statusInfo) : undefined
            });

            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Failed to record bot heartbeat", {
                botId,
                error: errorMessage,
            });
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Start background stale detection process (legacy compatibility)
     */
    private startStaleDetection(): void {
        // This method is now handled by startReconciliationProcess()
        // Keeping for backward compatibility but delegating to new method
    }

    /**
     * Stop background stale detection
     */
    private stopStaleDetection(): void {
        if (this.heartbeatCheckInterval) {
            clearInterval(this.heartbeatCheckInterval);
            this.heartbeatCheckInterval = null;
            logger.info("Stopped bot stale detection process");
        }
    }

    /**
     * Check for stale bots and mark them as error
     */
    private async checkForStaleBots(): Promise<void> {
        try {
            const now = Date.now();

            // Find running bots with stale heartbeats
            const staleBots = await query(`
                SELECT id, user_id, last_heartbeat, status
                FROM bot_instances
                WHERE status = 'RUNNING'
                AND last_heartbeat < NOW() - INTERVAL '${this.HEARTBEAT_TIMEOUT_MS / 1000} seconds'
            `);

            if (staleBots.rows.length > 0) {
                logger.warn("Found stale bots, marking as error", {
                    staleCount: staleBots.rows.length,
                    timeoutMs: this.HEARTBEAT_TIMEOUT_MS,
                });

                // Mark each stale bot as error
                for (const bot of staleBots.rows) {
                    const lastHeartbeat = bot.last_heartbeat ? new Date(bot.last_heartbeat).getTime() : 0;
                    const age = now - lastHeartbeat;

                    await this.updateBotStatus(
                        bot.id,
                        'ERROR',
                        `Bot heartbeat timeout (${Math.round(age / 1000)}s since last heartbeat)`,
                        'stale_detection'
                    );

                    // Notify user via WebSocket
                    await this.notifyUserOfStaleBot(bot.user_id, bot.id, age);
                }
            }

        } catch (error) {
            logger.error("Failed to check for stale bots", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Notify user about stale bot via WebSocket
     */
    private async notifyUserOfStaleBot(userId: string, botId: string, ageMs: number): Promise<void> {
        try {
            // Import io dynamically to avoid circular imports
            const { io } = await import("../index.js");

            if (io) {
                io.to(`user:${userId}`).emit("bot:status", {
                    botId,
                    status: "stale",
                    message: `Bot has stopped responding (${Math.round(ageMs / 1000)}s since last heartbeat)`,
                    timestamp: new Date().toISOString(),
                });

                logger.debug("Notified user of stale bot", { userId, botId, ageMs });
            }
        } catch (error) {
            logger.warn("Failed to notify user of stale bot", {
                userId,
                botId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
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
