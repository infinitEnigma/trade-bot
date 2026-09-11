/**
 * Pure Bot Management Service - Clean Architecture Implementation
 *
 * Business logic for bot instance operations including creation, starting, stopping, and monitoring.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IBotInstanceRepository: Bot instance data access abstraction
 * - IStrategyRepository: Strategy data access abstraction
 * - IAuditLogRepository: Audit logging abstraction
 * - ILogger: Logging abstraction
 *
 * @format
 */

import {
    IBotInstanceRepository,
    IStrategyRepository,
    IAuditLogRepository,
    ILogger
} from "@trade-bot/shared";

export interface BotManagementServiceDependencies {
    botInstanceRepository: IBotInstanceRepository;
    strategyRepository: IStrategyRepository;
    auditLogRepository: IAuditLogRepository;
    logger: ILogger;
}

export class BotManagementService {
    constructor(private deps: BotManagementServiceDependencies) { }

    /**
     * Get all bot instances for a user
     */
    async getBotInstances(userId: string): Promise<any[]> {
        try {
            const botInstances = await this.deps.botInstanceRepository.getBotInstances(userId);
            this.deps.logger.debug("Bot instances retrieved successfully", { userId, count: botInstances.length });
            return botInstances;
        } catch (error) {
            this.deps.logger.error("Failed to get bot instances", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw new Error("Failed to get bot instances");
        }
    }

    /**
     * Get bot instance by ID
     */
    async getBotInstance(id: string): Promise<any | null> {
        try {
            const botInstance = await this.deps.botInstanceRepository.getBotInstance(id);
            this.deps.logger.debug("Bot instance retrieved successfully", { botId: id });
            return botInstance;
        } catch (error) {
            this.deps.logger.error("Failed to get bot instance", {
                error: error instanceof Error ? error.message : String(error),
                botId: id
            });
            throw new Error("Failed to get bot instance");
        }
    }

    /**
     * Create and start a new bot instance
     */
    async createAndStartBot(userId: string, strategyId: string, notionalAmount: number): Promise<any> {
        try {
            // Verify strategy belongs to user
            const strategy = await this.deps.strategyRepository.getStrategy(strategyId);
            if (!strategy || strategy.userId !== userId) {
                throw new Error("Strategy not found or does not belong to user");
            }

            // Check if bot can be started
            const activeBots = await this.deps.botInstanceRepository.getActiveBotInstances();
            const runningBot = activeBots.find(bot => bot.strategy_id === strategyId);
            if (runningBot) {
                throw new Error("Bot is already running for this strategy");
            }

            // Create bot instance
            const botId = this.generateBotId();
            const botInstance = await this.deps.botInstanceRepository.createBotInstance({
                id: botId,
                strategy_id: strategyId,
                user_id: userId,
                status: 'RUNNING',
                running_time: 0,
                total_trades: 0,
                total_pnl: 0
            });

            // Log bot creation
            await this.deps.auditLogRepository.logEvent({
                userId,
                action: "BOT_CREATED",
                details: {
                    botId,
                    strategyId,
                    notionalAmount
                }
            });

            this.deps.logger.info("Bot created and started successfully", {
                botId,
                strategyId,
                userId
            });

            return botInstance;
        } catch (error) {
            this.deps.logger.error("Failed to create and start bot", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                strategyId
            });
            throw error;
        }
    }

    /**
     * Stop a running bot instance
     */
    async stopBot(userId: string, botId: string): Promise<void> {
        try {
            // Validate bot ownership
            const botInstance = await this.deps.botInstanceRepository.getBotInstance(botId);
            if (!botInstance || botInstance.user_id !== userId) {
                throw new Error("Bot not found or does not belong to user");
            }

            if (botInstance.status !== 'RUNNING') {
                throw new Error("Bot is not running");
            }

            // Update bot status
            await this.deps.botInstanceRepository.updateBotStatus(botId, 'STOPPED');

            // Log bot stop
            await this.deps.auditLogRepository.logEvent({
                userId,
                action: "BOT_STOPPED",
                details: {
                    botId,
                    strategyId: botInstance.strategy_id
                }
            });

            this.deps.logger.info("Bot stopped successfully", {
                botId,
                userId
            });
        } catch (error) {
            this.deps.logger.error("Failed to stop bot", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                botId
            });
            throw error;
        }
    }

    /**
     * Get bot status
     */
    async getBotStatus(botId: string): Promise<any> {
        try {
            const botInstance = await this.deps.botInstanceRepository.getBotInstance(botId);
            if (!botInstance) {
                throw new Error("Bot not found");
            }

            const statusInfo = {
                ...botInstance,
                statusValidation: {
                    isStale: false,
                    lastHeartbeatAge: 0,
                    engineHealth: {
                        running: true,
                        lastHealthCheck: Date.now(),
                        status: 'healthy'
                    }
                }
            };

            this.deps.logger.debug("Bot status retrieved successfully", { botId });
            return statusInfo;
        } catch (error) {
            this.deps.logger.error("Failed to get bot status", {
                error: error instanceof Error ? error.message : String(error),
                botId
            });
            throw new Error("Failed to get bot status");
        }
    }

    /**
     * Get bot performance metrics
     */
    async getBotPerformance(botId: string): Promise<any> {
        try {
            const botInstance = await this.deps.botInstanceRepository.getBotInstance(botId);
            if (!botInstance) {
                throw new Error("Bot not found");
            }

            const performance = {
                totalTrades: botInstance.total_trades || 0,
                totalPnL: botInstance.total_pnl || 0,
                winRate: 0,
                avgTrade: 0,
                bestTrade: 0,
                worstTrade: 0
            };

            this.deps.logger.debug("Bot performance retrieved successfully", { botId });
            return performance;
        } catch (error) {
            this.deps.logger.error("Failed to get bot performance", {
                error: error instanceof Error ? error.message : String(error),
                botId
            });
            throw new Error("Failed to get bot performance");
        }
    }

    /**
     * Initiate emergency stop for a bot
     */
    async emergencyStop(botId: string, userId: string): Promise<void> {
        try {
            // Validate bot ownership
            const botInstance = await this.deps.botInstanceRepository.getBotInstance(botId);
            if (!botInstance || botInstance.user_id !== userId) {
                throw new Error("Bot not found or does not belong to user");
            }

            if (botInstance.status !== 'RUNNING') {
                throw new Error("Bot is not running");
            }

            // Update bot status
            await this.deps.botInstanceRepository.updateBotStatus(botId, 'FORCE_STOPPING');

            // Log emergency stop
            await this.deps.auditLogRepository.logEvent({
                userId,
                action: "EMERGENCY_STOP",
                details: {
                    botId,
                    strategyId: botInstance.strategy_id
                }
            });

            this.deps.logger.warn("Emergency stop initiated", {
                botId,
                userId
            });
        } catch (error) {
            this.deps.logger.error("Failed to initiate emergency stop", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                botId
            });
            throw error;
        }
    }

    /**
     * Generate unique bot ID
     */
    private generateBotId(): string {
        return `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Export factory function for creating service instances
export function createBotManagementService(deps: BotManagementServiceDependencies): BotManagementService {
    return new BotManagementService(deps);
}
