/**
 * Bot Reconciliation Worker
 *
 * Background worker that handles bot status reconciliation and recovery.
 * Runs periodic checks to ensure bot states are consistent with reality.
 */

import { query } from "../database/pool";
import { botStatusService } from "../services/bot-status";
import { errorNotificationService, ErrorSeverity, ErrorCategory } from "../services/error-notification";
import logger from "../services/logger";

export interface ReconciliationResult {
    totalBotsChecked: number;
    statusChanges: number;
    recoveries: number;
    errors: string[];
    duration: number;
}

/**
 * Bot Reconciliation Worker
 */
export class BotReconciliationWorker {
    private intervalId: NodeJS.Timeout | null = null;
    private readonly RECONCILIATION_INTERVAL_MS = 30000; // 30 seconds
    private readonly IDLE_INTERVAL_MS = 300000; // 5 minutes when no active bots
    private isRunning = false;
    private lastActivityCheck = 0;
    private cachedActiveBotCount = 0;

    /**
     * Start the reconciliation worker
     */
    start(): void {
        if (this.isRunning) {
            logger.warn("Bot reconciliation worker is already running");
            return;
        }

        logger.info("Starting bot reconciliation worker", {
            intervalMs: this.RECONCILIATION_INTERVAL_MS,
        });

        this.isRunning = true;
        this.intervalId = setInterval(() => {
            this.runReconciliation().catch(error => {
                logger.error("Bot reconciliation cycle failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }, this.RECONCILIATION_INTERVAL_MS);
    }

    /**
     * Stop the reconciliation worker
     */
    stop(): void {
        if (!this.isRunning) {
            logger.warn("Bot reconciliation worker is not running");
            return;
        }

        logger.info("Stopping bot reconciliation worker");
        this.isRunning = false;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Register shutdown handlers for proper cleanup
     */
    registerShutdownHandlers(): void {
        // Handle process termination signals
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received in bot reconciliation worker, stopping...');
            this.stop();
        });

        process.on('SIGINT', () => {
            logger.info('SIGINT received in bot reconciliation worker, stopping...');
            this.stop();
        });

        // Handle uncaught exceptions and unhandled rejections
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception in bot reconciliation worker', {
                error: error.message,
                stack: error.stack,
            });
            this.stop();
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection in bot reconciliation worker', {
                reason: reason instanceof Error ? reason.message : String(reason),
            });
            this.stop();
        });

        logger.debug("Bot reconciliation worker shutdown handlers registered");
    }

    /**
     * Check if there are any active bots that need reconciliation
     */
    private async hasActiveBots(): Promise<boolean> {
        try {
            const result = await query(
                "SELECT COUNT(*) as count FROM bot_instances WHERE status IN ('RUNNING', 'STARTING', 'FORCE_STOPPING')"
            );
            const count = parseInt(result.rows[0].count);
            this.cachedActiveBotCount = count;
            this.lastActivityCheck = Date.now();
            return count > 0;
        } catch (error) {
            logger.warn("Failed to check for active bots", {
                error: error instanceof Error ? error.message : String(error),
            });
            return false; // Assume no active bots on error to be safe
        }
    }

    /**
     * Run a single reconciliation cycle
     */
    async runReconciliation(): Promise<ReconciliationResult> {
        const startTime = Date.now();

        // Quick optimization: Skip reconciliation if no active bots
        const hasActiveBots = await this.hasActiveBots();
        if (!hasActiveBots) {
            logger.debug("Skipping reconciliation cycle - no active bots");

            return {
                totalBotsChecked: 0,
                statusChanges: 0,
                recoveries: 0,
                errors: [],
                duration: Date.now() - startTime,
            };
        }

        const errors: string[] = [];
        let totalBotsChecked = 0;
        let statusChanges = 0;
        let recoveries = 0;

        try {
            // Get all bots that need reconciliation
            const botsToReconcile = await query(`
                SELECT bi.*, s.active as strategy_active, s.user_id
                FROM bot_instances bi
                JOIN strategies s ON bi.strategy_id = s.id
                WHERE bi.status IN ('RUNNING', 'STARTING', 'FORCE_STOPPING')
            `);

            totalBotsChecked = botsToReconcile.rows.length;

            logger.debug("Bot reconciliation cycle started", {
                botsToCheck: totalBotsChecked,
                cycleStartTime: new Date(startTime).toISOString(),
            });

            for (const bot of botsToReconcile.rows) {
                try {
                    const reconciliation = await botStatusService.reconcileBotStatus(bot, Date.now());

                    if (reconciliation.statusChanged) {
                        statusChanges++;

                        // Update bot status in database
                        await botStatusService.updateBotStatus(
                            bot.id,
                            reconciliation.newStatus,
                            reconciliation.errorMessage,
                            reconciliation.reason
                        );

                        // Emit status update via WebSocket
                        const io = global.io;
                        if (io) {
                            io.to(`user:${bot.user_id}`).emit("bot:status", {
                                botId: bot.id,
                                status: reconciliation.newStatus,
                                previousStatus: bot.status,
                                reconciled: true,
                                reason: reconciliation.reason,
                                timestamp: Date.now(),
                            });
                        }

                        logger.info("Bot status reconciled by worker", {
                            botId: bot.id,
                            oldStatus: bot.status,
                            newStatus: reconciliation.newStatus,
                            reason: reconciliation.reason,
                        });

                        // Log reconciliation action
                        await query(
                            "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                            [
                                bot.user_id,
                                "BOT_AUTO_RECONCILED",
                                {
                                    botId: bot.id,
                                    oldStatus: bot.status,
                                    newStatus: reconciliation.newStatus,
                                    reason: reconciliation.reason,
                                    engineHealth: reconciliation.engineHealth,
                                    reconciledBy: "worker",
                                    reconciliationCycle: startTime,
                                },
                            ]
                        );
                    }

                    // Check for recovery opportunities
                    if (bot.status === 'ERROR' && bot.last_error?.includes('heartbeat timeout')) {
                        const lastHeartbeat = bot.last_heartbeat ? new Date(bot.last_heartbeat).getTime() : 0;
                        const timeSinceHeartbeat = Date.now() - lastHeartbeat;

                        // If heartbeat is recent (< 30 seconds), bot may have recovered
                        if (timeSinceHeartbeat < botStatusService['RECOVERY_TIMEOUT_MS']) {
                            recoveries++;

                            await botStatusService.updateBotStatus(
                                bot.id,
                                'RUNNING',
                                null,
                                'auto_recovery'
                            );

                            // Emit recovery notification
                            const io = global.io;
                            if (io) {
                                io.to(`user:${bot.user_id}`).emit("bot:status", {
                                    botId: bot.id,
                                    status: 'RUNNING',
                                    previousStatus: 'ERROR',
                                    reconciled: true,
                                    reason: 'auto_recovered',
                                    timestamp: Date.now(),
                                });
                            }

                            logger.info("Bot auto-recovered by worker", {
                                botId: bot.id,
                                timeSinceHeartbeat,
                            });

                            // Log recovery action
                            await query(
                                "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
                                [
                                    bot.user_id,
                                    "BOT_AUTO_RECOVERED",
                                    {
                                        botId: bot.id,
                                        timeSinceHeartbeat,
                                        recoveredBy: "worker",
                                        recoveryCycle: startTime,
                                    },
                                ]
                            );
                        }
                    }

                } catch (botError) {
                    const errorMsg = `Bot ${bot.id}: ${botError instanceof Error ? botError.message : String(botError)}`;
                    errors.push(errorMsg);

                    logger.error("Bot reconciliation error in worker", {
                        botId: bot.id,
                        error: botError instanceof Error ? botError.message : String(botError),
                    });

                    // Notify about reconciliation failures
                    await errorNotificationService.notifyError(
                        botError as Error,
                        {
                            category: ErrorCategory.SYSTEM,
                            operation: "bot_reconciliation",
                            userId: bot.user_id,
                            metadata: {
                                botId: bot.id,
                                reconciliationFailure: true,
                                reconciliationCycle: startTime,
                            },
                        },
                        ErrorSeverity.MEDIUM
                    );
                }
            }

            // Check if any engines should be stopped (only if we have active bots)
            if (totalBotsChecked > 0) {
                try {
                    // Import engine manager dynamically to avoid circular dependencies
                    const { engineManager } = await import("../services/engine-manager.js");
                    await engineManager.stopEngineIfNoActiveBots();
                } catch (engineError) {
                    logger.error("Engine check failed during reconciliation", {
                        error: engineError instanceof Error ? engineError.message : String(engineError),
                        activeBots: totalBotsChecked,
                    });
                }
            }

        } catch (cycleError) {
            const errorMsg = `Reconciliation cycle failed: ${cycleError instanceof Error ? cycleError.message : String(cycleError)}`;
            errors.push(errorMsg);

            logger.error("Bot reconciliation cycle error", {
                error: cycleError instanceof Error ? cycleError.message : String(cycleError),
                cycleStartTime: startTime,
            });
        }

        const duration = Date.now() - startTime;

        const result: ReconciliationResult = {
            totalBotsChecked,
            statusChanges,
            recoveries,
            errors,
            duration,
        };

        // Log reconciliation summary
        if (statusChanges > 0 || recoveries > 0 || errors.length > 0) {
            logger.info("Bot reconciliation cycle completed", {
                ...result,
                cycleStartTime: new Date(startTime).toISOString(),
                hasErrors: errors.length > 0,
            });
        } else {
            logger.debug("Bot reconciliation cycle completed (no changes)", {
                ...result,
                cycleStartTime: new Date(startTime).toISOString(),
            });
        }

        return result;
    }

    /**
     * Manually trigger reconciliation for a specific bot
     */
    async reconcileBot(botId: string): Promise<{
        reconciled: boolean;
        oldStatus?: string;
        newStatus?: string;
        reason?: string;
        error?: string;
    }> {
        try {
            // Get bot data
            const botResult = await query(
                `SELECT bi.*, s.active as strategy_active, s.user_id
                 FROM bot_instances bi
                 JOIN strategies s ON bi.strategy_id = s.id
                 WHERE bi.id = $1`,
                [botId]
            );

            if (botResult.rows.length === 0) {
                throw new Error('Bot not found');
            }

            const bot = botResult.rows[0];
            const oldStatus = bot.status;

            // Perform reconciliation
            const reconciliation = await botStatusService.reconcileBotStatus(bot, Date.now());

            if (reconciliation.statusChanged) {
                // Update bot status
                await botStatusService.updateBotStatus(
                    botId,
                    reconciliation.newStatus,
                    reconciliation.errorMessage,
                    `manual_reconciliation:${reconciliation.reason}`
                );

                // Emit status update
                const io = global.io;
                if (io) {
                    io.to(`user:${bot.user_id}`).emit("bot:status", {
                        botId,
                        status: reconciliation.newStatus,
                        previousStatus: oldStatus,
                        reconciled: true,
                        reason: reconciliation.reason,
                        timestamp: Date.now(),
                    });
                }

                return {
                    reconciled: true,
                    oldStatus,
                    newStatus: reconciliation.newStatus,
                    reason: reconciliation.reason,
                };
            }

            return {
                reconciled: false,
                oldStatus,
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error("Manual bot reconciliation failed", {
                botId,
                error: errorMsg,
            });

            return {
                reconciled: false,
                error: errorMsg,
            };
        }
    }

    /**
     * Get worker statistics
     */
    getStats(): {
        isRunning: boolean;
        reconciliationInterval: number;
        idleInterval: number;
        cachedActiveBotCount: number;
        lastActivityCheck: number;
        optimizationEnabled: boolean;
    } {
        return {
            isRunning: this.isRunning,
            reconciliationInterval: this.RECONCILIATION_INTERVAL_MS,
            idleInterval: this.IDLE_INTERVAL_MS,
            cachedActiveBotCount: this.cachedActiveBotCount,
            lastActivityCheck: this.lastActivityCheck,
            optimizationEnabled: true,
        };
    }

    /**
     * Force a reconciliation cycle to run immediately
     */
    async forceReconciliation(): Promise<ReconciliationResult> {
        logger.info("Forced reconciliation triggered");
        return this.runReconciliation();
    }
}

// Export singleton instance
export const botReconciliationWorker = new BotReconciliationWorker();
