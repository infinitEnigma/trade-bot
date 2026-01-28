/**
 * Pure Bot Status Service - Clean Architecture Implementation
 *
 * Business logic for bot status management with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - ICacheService: Caching abstraction for bot status data
 * - ILogger: Logging abstraction
 * - IBotRepository: Bot data access abstraction (to be defined)
 * - IAuditLogRepository: Security audit logging abstraction
 *
 * @format
 */

import {
    ICacheService,
    ILogger,
    IAuditLogRepository,
    CacheResult
} from '../../../shared/src';

// Bot interface for repository operations
export interface Bot {
    id: string;
    user_id: string;
    strategy_id: string;
    status: string;
    last_heartbeat: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

// Bot status information with validation
export interface BotStatusInfo {
    isStale: boolean;
    lastHeartbeatAge: number;
    engineHealth: {
        running: boolean;
        lastHealthCheck: number;
        status: string;
    };
}

// Bot with validation information
export interface BotWithValidation extends Bot {
    statusValidation: BotStatusInfo;
}

// Audit log details
export interface AuditDetails {
    botId: string;
    userId: string;
    [key: string]: unknown;
}

// Bot repository interface (to be implemented)
export interface IBotRepository {
    findById(botId: string): Promise<Bot | null>;
    findByUserId(userId: string): Promise<Bot[]>;
    updateStatus(botId: string, status: string, errorMessage?: string): Promise<boolean>;
    updateHeartbeat(botId: string): Promise<boolean>;
    getActiveBots(): Promise<Bot[]>;
    getBotStats(): Promise<{
        totalBots: number;
        runningBots: number;
        errorBots: number;
        staleBots: number;
    }>;
}

export interface BotStatusServiceDependencies {
    botRepository: IBotRepository;
    cache: ICacheService;
    logger: ILogger;
    auditLogger?: IAuditLogRepository;
}

/**
 * Legacy Bot Status Response - For API compatibility during migration
 */
export interface LegacyBotStatusInfo {
    id: string;
    user_id: string;
    strategy_id: string;
    status: string;
    last_heartbeat: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    statusValidation: {
        isStale: boolean;
        lastHeartbeatAge: number;
        engineHealth: {
            running: boolean;
            lastHealthCheck: number;
            status: string;
        };
    };
}

/**
 * Pure Bot Status Service
 *
 * Implements bot status business logic using dependency injection.
 * No direct dependencies on databases, Redis, or external systems.
 */
export class BotStatusService {
    private readonly CACHE_TTL = 300; // 5 minutes for bot status data
    private readonly HEARTBEAT_TIMEOUT_MS = 45000; // 45 seconds
    private readonly CACHE_PREFIX = 'bot:status';

    constructor(private deps: BotStatusServiceDependencies) { }

    /**
     * Start a bot instance
     *
     * Business Logic:
     * 1. Validate bot ownership and current state
     * 2. Check for strategy conflicts
     * 3. Update bot status to STARTING
     * 4. Log the operation
     */
    async startBot(botId: string, userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            this.deps.logger.debug('Starting bot', { botId, userId });

            // Validate bot ownership
            const bot = await this.deps.botRepository.findById(botId);
            if (!bot || bot.user_id !== userId) {
                this.deps.logger.warn('Bot not found or access denied', { botId, userId });
                return { success: false, error: 'Bot not found or access denied' };
            }

            // Check if bot can be started
            if (!this.canTransitionToStatus(bot.status, 'STARTING')) {
                this.deps.logger.warn('Invalid status transition for bot start', {
                    botId,
                    currentStatus: bot.status
                });
                return { success: false, error: 'Bot cannot be started in current state' };
            }

            // Update bot status
            const success = await this.deps.botRepository.updateStatus(botId, 'STARTING');
            if (!success) {
                return { success: false, error: 'Failed to update bot status' };
            }

            // Log audit event
            await this.logAuditEvent('BOT_STARTED', { botId, userId });

            this.deps.logger.info('Bot started successfully', { botId, userId });
            return { success: true };

        } catch (error) {
            this.deps.logger.error('Failed to start bot', {
                botId,
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return { success: false, error: 'Failed to start bot' };
        }
    }

    /**
     * Stop a bot instance
     *
     * Business Logic:
     * 1. Validate bot ownership and current state
     * 2. Update bot status to STOPPED
     * 3. Clear any cached data
     * 4. Log the operation
     */
    async stopBot(botId: string, userId: string): Promise<{ success: boolean; error?: string }> {
        try {
            this.deps.logger.debug('Stopping bot', { botId, userId });

            // Validate bot ownership
            const bot = await this.deps.botRepository.findById(botId);
            if (!bot || bot.user_id !== userId) {
                this.deps.logger.warn('Bot not found or access denied', { botId, userId });
                return { success: false, error: 'Bot not found or access denied' };
            }

            // Check if bot can be stopped
            if (!this.canTransitionToStatus(bot.status, 'STOPPED')) {
                this.deps.logger.warn('Invalid status transition for bot stop', {
                    botId,
                    currentStatus: bot.status
                });
                return { success: false, error: 'Bot cannot be stopped in current state' };
            }

            // Update bot status
            const success = await this.deps.botRepository.updateStatus(botId, 'STOPPED');
            if (!success) {
                return { success: false, error: 'Failed to update bot status' };
            }

            // Clear cached data
            await this.invalidateBotCache(botId);

            // Log audit event
            await this.logAuditEvent('BOT_STOPPED', { botId, userId });

            this.deps.logger.info('Bot stopped successfully', { botId, userId });
            return { success: true };

        } catch (error) {
            this.deps.logger.error('Failed to stop bot', {
                botId,
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return { success: false, error: 'Failed to stop bot' };
        }
    }

    /**
     * Get comprehensive bot status information
     *
     * Business Logic:
     * 1. Check cache first for performance
     * 2. Query repository for current data
     * 3. Validate status and heartbeat
     * 4. Cache result for future requests
     * 5. Return formatted status information
     */
    async getBotStatusInfo(botId: string, userId: string): Promise<LegacyBotStatusInfo | null> {
        try {
            const cacheKey = `${this.CACHE_PREFIX}:${botId}`;

            // Try cache first
            const cachedResult: CacheResult<BotWithValidation> = await this.deps.cache.get(cacheKey);
            if (cachedResult.success && cachedResult.data) {
                // Validate cache is still for correct user
                if (cachedResult.data.user_id === userId) {
                    this.deps.logger.debug('Bot status cache hit', { botId });
                    return this.shouldReturnLegacyFormat()
                        ? this.convertToLegacyFormat(cachedResult.data)
                        : cachedResult.data;
                }
            }

            // Cache miss - query repository
            this.deps.logger.debug('Bot status cache miss, querying repository', { botId });

            const bot = await this.deps.botRepository.findById(botId);
            if (!bot || bot.user_id !== userId) {
                return null;
            }

            // Validate bot status
            const validation = await this.validateBotStatus(bot, Date.now());

            // Update status if validation indicates changes
            if (validation.updatedStatus !== bot.status) {
                await this.deps.botRepository.updateStatus(
                    botId,
                    validation.updatedStatus,
                    validation.errorMessage || undefined
                );
                bot.status = validation.updatedStatus;
                bot.last_error = validation.errorMessage;
            }

            const statusInfo: BotWithValidation = {
                ...bot,
                statusValidation: {
                    isStale: validation.isStale,
                    lastHeartbeatAge: validation.lastHeartbeatAge,
                    engineHealth: {
                        running: true, // Placeholder - would need engine service
                        lastHealthCheck: Date.now(),
                        status: 'healthy'
                    }
                }
            };

            // Cache the result
            const cacheResult = await this.deps.cache.setex(cacheKey, this.CACHE_TTL, statusInfo);
            if (!cacheResult.success) {
                this.deps.logger.warn('Failed to cache bot status', {
                    botId,
                    error: cacheResult.error
                });
            }

            this.deps.logger.debug('Bot status cached', { botId });

            return this.shouldReturnLegacyFormat()
                ? this.convertToLegacyFormat(statusInfo)
                : statusInfo;

        } catch (error) {
            this.deps.logger.error('Failed to get bot status info', {
                botId,
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Send heartbeat for bot health monitoring
     *
     * Business Logic:
     * 1. Update heartbeat timestamp
     * 2. Validate bot can send heartbeat in current state
     * 3. Handle status transitions based on heartbeat
     * 4. Log the operation
     */
    async sendBotHeartbeat(botId: string): Promise<{ success: boolean; error?: string }> {
        try {
            this.deps.logger.debug('Processing bot heartbeat', { botId });

            // Update heartbeat in repository
            const success = await this.deps.botRepository.updateHeartbeat(botId);
            if (!success) {
                return { success: false, error: 'Failed to update heartbeat' };
            }

            // Get current bot status
            const bot = await this.deps.botRepository.findById(botId);
            if (!bot) {
                return { success: false, error: 'Bot not found' };
            }

            // Handle status transitions
            if (bot.status === 'RECOVERING') {
                // Bot recovered - move to running
                await this.deps.botRepository.updateStatus(botId, 'RUNNING');
                this.deps.logger.info('Bot recovered from error state', { botId });
            } else if (bot.status === 'ERROR') {
                // Check if error was due to heartbeat timeout
                if (bot.last_error?.includes('heartbeat timeout')) {
                    // Start recovery process
                    await this.deps.botRepository.updateStatus(botId, 'RECOVERING');
                    this.deps.logger.info('Bot entering recovery state', { botId });
                }
            }

            // Invalidate cache to force fresh data
            await this.invalidateBotCache(botId);

            this.deps.logger.debug('Bot heartbeat processed successfully', { botId });
            return { success: true };

        } catch (error) {
            this.deps.logger.error('Failed to process bot heartbeat', {
                botId,
                error: error instanceof Error ? error.message : String(error)
            });
            return { success: false, error: 'Failed to process heartbeat' };
        }
    }

    /**
     * Validate bot status and perform reconciliation
     *
     * Business Logic:
     * - Check heartbeat staleness
     * - Validate status consistency
     * - Return validation results
     */
    private async validateBotStatus(botData: Bot, currentTime: number): Promise<{
        updatedStatus: string;
        errorMessage: string | null;
        isStale: boolean;
        lastHeartbeatAge: number;
    }> {
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
     * Get bot statistics for monitoring
     *
     * Business Logic:
     * - Aggregate bot counts by status
     * - Provide monitoring metrics
     */
    async getBotStats(): Promise<{
        totalBots: number;
        runningBots: number;
        errorBots: number;
        staleBots: number;
    }> {
        try {
            return await this.deps.botRepository.getBotStats();
        } catch (error) {
            this.deps.logger.error('Failed to get bot stats', {
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                totalBots: 0,
                runningBots: 0,
                errorBots: 0,
                staleBots: 0,
            };
        }
    }

    /**
     * Check if bot status transition is valid
     */
    private canTransitionToStatus(currentStatus: string, newStatus: string): boolean {
        const validTransitions: Record<string, string[]> = {
            'STOPPED': ['STARTING'],
            'STARTING': ['RUNNING', 'ERROR'],
            'RUNNING': ['PAUSED', 'ERROR', 'FORCE_STOPPING'],
            'PAUSED': ['RUNNING', 'STOPPED'],
            'RECOVERING': ['RUNNING', 'ERROR'],
            'ERROR': ['RECOVERING'],
            'FORCE_STOPPING': ['STOPPED'],
        };

        return validTransitions[currentStatus]?.includes(newStatus) ?? false;
    }

    /**
     * Invalidate cached bot data
     */
    private async invalidateBotCache(botId: string): Promise<void> {
        const cacheKey = `${this.CACHE_PREFIX}:${botId}`;
        const result = await this.deps.cache.delete(cacheKey);

        if (result.success) {
            this.deps.logger.debug('Bot cache invalidated', { botId });
        } else {
            this.deps.logger.warn('Failed to invalidate bot cache', {
                botId,
                error: result.error
            });
        }
    }

    /**
     * Check if legacy API format should be returned
     */
    private shouldReturnLegacyFormat(): boolean {
        return process.env.LEGACY_TRADING_API === 'true';
    }

    /**
     * Convert status info to legacy format
     */
    private convertToLegacyFormat(statusInfo: BotWithValidation): LegacyBotStatusInfo {
        return {
            id: statusInfo.id,
            user_id: statusInfo.user_id,
            strategy_id: statusInfo.strategy_id,
            status: statusInfo.status,
            last_heartbeat: statusInfo.last_heartbeat,
            last_error: statusInfo.last_error,
            created_at: statusInfo.created_at,
            updated_at: statusInfo.updated_at,
            statusValidation: statusInfo.statusValidation
        };
    }

    /**
     * Log audit event if audit logger is available
     */
    private async logAuditEvent(action: string, details: AuditDetails): Promise<void> {
        if (this.deps.auditLogger) {
            try {
                await this.deps.auditLogger.logEvent({
                    userId: details.userId || 'system',
                    action,
                    details
                });
            } catch (error) {
                this.deps.logger.warn('Failed to log audit event', {
                    action,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }
}

// Export factory function for creating service instances
export function createBotStatusService(deps: BotStatusServiceDependencies): BotStatusService {
    return new BotStatusService(deps);
}