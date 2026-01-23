/**
 * Pure Trading Engine Service - Clean Architecture Implementation
 *
 * Business logic for trading engine management with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - ILogger: Logging abstraction
 * - IProcessManager: Process management abstraction (simplified interface)
 *
 * @format
 */

import {
    ILogger
} from '@trade-bot/shared';

// Simplified process manager interface for trading engine
export interface IProcessManager {
    spawn(): Promise<boolean>;
    kill(signal?: string): Promise<boolean>;
    isAlive(): boolean;
    getStatus(): Promise<{
        running: boolean;
        pid?: number;
        uptime?: number;
        memoryUsage?: number;
    }>;
}

export interface TradingEngineServiceDependencies {
    processManager: IProcessManager;
    logger: ILogger;
}

/**
 * Legacy Trading Engine Status - For API compatibility during migration
 */
export interface LegacyEngineStatus {
    running: boolean;
    health?: {
        status: string;
        bots: number;
        uptime: number;
    };
}

/**
 * Pure Trading Engine Service
 *
 * Implements trading engine business logic using dependency injection.
 * No direct dependencies on child_process, file system, or external processes.
 */
export class TradingEngineService {
    constructor(private deps: TradingEngineServiceDependencies) { }

    /**
     * Ensure trading engine is running
     *
     * Business Logic:
     * 1. Check if engine process is already running
     * 2. If not running, attempt to start the process
     * 3. Validate that the process started successfully
     * 4. Log the operation result
     */
    async ensureEngineRunning(): Promise<void> {
        try {
            this.deps.logger.debug('Ensuring trading engine is running');

            // Check if already running
            const status = await this.deps.processManager.getStatus();
            if (status.running) {
                this.deps.logger.debug('Trading engine already running', {
                    pid: status.pid,
                    uptime: status.uptime
                });
                return;
            }

            // Attempt to start the engine
            this.deps.logger.info('Starting trading engine process');
            const started = await this.deps.processManager.spawn();

            if (!started) {
                throw new Error('Failed to start trading engine process');
            }

            // Validate the process is running
            const newStatus = await this.deps.processManager.getStatus();
            if (!newStatus.running) {
                throw new Error('Trading engine process failed to start');
            }

            this.deps.logger.info('Trading engine started successfully', {
                pid: newStatus.pid
            });

        } catch (error) {
            this.deps.logger.error('Failed to ensure trading engine is running', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get engine status and health information
     *
     * Business Logic:
     * 1. Query process manager for current status
     * 2. Include health metrics if available
     * 3. Format response for API compatibility
     */
    async getEngineStatus(): Promise<LegacyEngineStatus> {
        try {
            this.deps.logger.debug('Getting trading engine status');

            const status = await this.deps.processManager.getStatus();

            const engineStatus: LegacyEngineStatus = {
                running: status.running,
                health: status.running ? {
                    status: 'healthy',
                    bots: 0, // Would need bot count from separate service
                    uptime: status.uptime || 0
                } : undefined
            };

            this.deps.logger.debug('Trading engine status retrieved', {
                running: engineStatus.running,
                uptime: engineStatus.health?.uptime
            });

            return engineStatus;

        } catch (error) {
            this.deps.logger.error('Failed to get trading engine status', {
                error: error instanceof Error ? error.message : String(error)
            });

            // Return safe default status
            return {
                running: false
            };
        }
    }

    /**
     * Stop engine if no active bots
     *
     * Business Logic:
     * 1. Check if there are any active running bots
     * 2. If no active bots, stop the engine process
     * 3. Log the shutdown decision
     */
    async stopEngineIfNoActiveBots(): Promise<void> {
        try {
            this.deps.logger.debug('Checking if engine should be stopped due to no active bots');

            // Note: This would need integration with bot status service
            // For now, assume we have a way to check active bot count
            const activeBotCount = await this.getActiveBotCount();

            if (activeBotCount === 0) {
                this.deps.logger.info('No active bots, stopping trading engine');

                const stopped = await this.deps.processManager.kill('SIGTERM');
                if (stopped) {
                    this.deps.logger.info('Trading engine stopped successfully');
                } else {
                    this.deps.logger.warn('Failed to stop trading engine gracefully');
                }
            } else {
                this.deps.logger.debug(`Engine kept running for ${activeBotCount} active bots`);
            }

        } catch (error) {
            this.deps.logger.error('Failed to check engine shutdown condition', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Force stop trading engine
     *
     * Business Logic:
     * 1. Immediately terminate the engine process
     * 2. Use SIGKILL for forceful termination
     * 3. Log the emergency stop
     */
    async forceStopEngine(): Promise<void> {
        try {
            this.deps.logger.warn('Force stopping trading engine');

            const killed = await this.deps.processManager.kill('SIGKILL');
            if (killed) {
                this.deps.logger.info('Trading engine force stopped successfully');
            } else {
                this.deps.logger.warn('Failed to force stop trading engine');
            }

        } catch (error) {
            this.deps.logger.error('Failed to force stop trading engine', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Check if engine process is alive
     *
     * Business Logic:
     * - Query process manager for liveness status
     * - Return boolean indicating process health
     */
    isEngineProcessAlive(): boolean {
        try {
            return this.deps.processManager.isAlive();
        } catch (error) {
            this.deps.logger.error('Failed to check engine process liveness', {
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Get active bot count (placeholder implementation)
     *
     * This would integrate with the bot status service in a real implementation.
     * For now, returns a placeholder value.
     */
    private async getActiveBotCount(): Promise<number> {
        // TODO: Integrate with bot status service to get actual active bot count
        // For now, return 0 to allow engine shutdown in pure service
        return 0;
    }
}

// Export factory function for creating service instances
export function createTradingEngineService(deps: TradingEngineServiceDependencies): TradingEngineService {
    return new TradingEngineService(deps);
}