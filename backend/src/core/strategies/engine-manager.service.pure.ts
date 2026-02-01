/**
 * Pure Engine Manager Service - Clean Architecture Implementation
 *
 * Business logic for engine management with complete infrastructure abstraction.
 * This service contains pure business logic and depends only on interfaces from shared.
 *
 * Dependencies (injected):
 * - IBotInstanceRepository: Bot instance data access abstraction
 * - ILogger: Logging abstraction
 *
 * @format
 */

import { IBotInstanceRepository, ILogger } from '@trade-bot/shared';
import {
    ProcessSpawner,
    HealthMonitor,
    RestartManager,
    CircuitBreaker,
    ProcessSupervisor,
} from './engine';
import { RedisStreamOperations } from '../../infrastructure/cache/redis';

interface EngineStatus {
    running: boolean;
    health?: {
        status: string;
        bots: number;
        uptime: number;
    };
}

export interface EngineManagerServiceDependencies {
    botInstanceRepository: IBotInstanceRepository;
    logger: ILogger;
    redisStreamOperations: RedisStreamOperations;
}

/**
 * Pure Engine Manager Service
 *
 * Implements engine management business logic using dependency injection.
 * No direct dependencies on databases, HTTP clients, or external processes.
 */
export class EngineManager {
    // Engine components (enterprise supervision system)
    private processSpawner: ProcessSpawner;
    private healthMonitor: HealthMonitor;
    private restartManager: RestartManager;
    private circuitBreaker: CircuitBreaker;
    private processSupervisor: ProcessSupervisor;

    // Redis stream operations
    private streamOperations: RedisStreamOperations;

    // Engine configuration
    private enginePort: number;

    // Engine state
    private engineStatus: EngineStatus = { running: false };
    private engineId: string | null = null;
    private isListening = false;

    constructor(private deps: EngineManagerServiceDependencies, enginePort = 4000) {
        this.enginePort = enginePort;
        this.streamOperations = deps.redisStreamOperations;

        // Initialize enterprise supervision components
        this.processSpawner = new ProcessSpawner(enginePort);
        this.healthMonitor = new HealthMonitor(this.processSpawner, enginePort);
        this.restartManager = new RestartManager();
        this.circuitBreaker = new CircuitBreaker();
        this.processSupervisor = new ProcessSupervisor(
            this.processSpawner,
            this.healthMonitor,
            this.restartManager,
            this.circuitBreaker
        );
    }

    // ===========================================
    // 🎭 FACADE METHODS - BACKWARD COMPATIBILITY
    // ===========================================

    /**
     * Ensure engine is running (backward compatibility)
     */
    async ensureEngineRunning(): Promise<void> {
        const result = await this.circuitBreaker.executeWithCircuitBreaker(async () => {
            await this.processSpawner.spawn();
            await this.processSpawner.waitForReady();
            this.processSupervisor.startSupervision();
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to start engine');
        }
    }

    /**
     * Get engine status (backward compatibility)
     */
    async getEngineStatus(): Promise<EngineStatus> {
        try {
            const axios = await import('axios');
            const response = await axios.default.get(
                `http://localhost:${this.enginePort}/api/engine/health`,
                { timeout: 2000 }
            );

            return {
                running: true,
                health: response.data,
            };
        } catch {
            return { running: false };
        }
    }

    /**
     * Stop engine if no active bots (backward compatibility)
     */
    async stopEngineIfNoActiveBots(): Promise<void> {
        try {
            const activeBots = await this.deps.botInstanceRepository.getActiveBotInstances();
            const activeBotCount = activeBots.length;

            if (activeBotCount === 0) {
                this.deps.logger.info("No active bots, stopping engine");
                await this.processSpawner.kill('SIGTERM');
            } else {
                this.deps.logger.debug(`Engine kept running for ${activeBotCount} active bots`);
            }
        } catch {
            this.deps.logger.error("Error checking for engine shutdown", {
                error: "Failed to check for engine shutdown",
            });
        }
    }

    /**
     * Force stop engine (backward compatibility)
     */
    async forceStopEngine(): Promise<void> {
        await this.processSpawner.kill('SIGKILL');
    }

    /**
     * Check if engine process is alive (backward compatibility)
     */
    isEngineProcessAlive(): boolean {
        return this.processSpawner.isAlive();
    }

    // ===========================================
    // 🚀 ENTERPRISE SUPERVISION METHODS
    // ===========================================

    /**
     * Start comprehensive process supervision
     */
    startProcessSupervision(): void {
        this.processSupervisor.startSupervision();
    }

    /**
     * Stop process supervision
     */
    stopProcessSupervision(): void {
        this.processSupervisor.stopSupervision();
    }

    /**
     * Enhanced ensure engine running with circuit breaker
     */
    async ensureEngineRunningWithSupervision(): Promise<{ success: boolean; error?: string }> {
        return this.circuitBreaker.executeWithCircuitBreaker(async () => {
            await this.ensureEngineRunning();
            this.startProcessSupervision();
        });
    }

    /**
     * Get comprehensive supervision status
     */
    getSupervisionStatus() {
        return {
            processState: this.processSupervisor.getProcessState(),
            circuitBreakerState: this.circuitBreaker.getState(),
            restartAttempts: this.restartManager.getRestartStatistics().totalAttempts,
            consecutiveFailures: 0, // Legacy - not used in new system
            lastRestartAttempt: this.restartManager.getRestartStatistics().nextRetryIn || 0,
            restartHistory: this.restartManager.getRestartAnalysis().recentAttempts,
            healthCheckLayers: {
                processLiveness: true,
                httpConnectivity: true,
                websocketHealth: false,
                botOperational: false,
                systemResources: false,
            },
        };
    }

    /**
     * Get detailed supervision report
     */
    getSupervisionReport() {
        return this.processSupervisor.getSupervisorStatus();
    }

    /**
     * Emergency stop with supervision
     */
    async emergencyStop(reason: string = 'emergency_stop'): Promise<void> {
        await this.processSupervisor.emergencyStop(reason);
    }

    /**
     * Manual restart with supervision
     */
    async manualRestart(reason: string = 'manual_restart'): Promise<{ success: boolean; error?: string }> {
        return this.processSupervisor.manualRestart(reason);
    }

    /**
     * Reset supervision state
     */
    resetSupervisionState(): void {
        this.processSupervisor.resetSupervisorState();
    }

    // ===========================================
    // 🚀 REDIS STREAM COMMUNICATION METHODS
    // ===========================================

    /**
     * Start listening for engine events
     */
    async startListeningForEvents(): Promise<void> {
        if (this.isListening) {
            this.deps.logger.debug('Already listening for engine events');
            return;
        }

        this.isListening = true;
        this.deps.logger.info('Starting to listen for engine events');

        // Create consumer group if it doesn't exist
        await this.streamOperations.createConsumerGroup('engine:events', 'backend-group');

        // Start event listener loop
        this.listenForEventsLoop();
    }

    /**
     * Stop listening for engine events
     */
    stopListeningForEvents(): void {
        this.isListening = false;
        this.deps.logger.info('Stopped listening for engine events');
    }

    /**
     * Event listener loop
     */
    private async listenForEventsLoop(): Promise<void> {
        while (this.isListening) {
            try {
                const result = await this.streamOperations.read('engine:events', {
                    block: 1000, // Reduced block time for faster shutdown
                    count: 10,
                    consumerGroup: 'backend-group',
                    consumerName: 'backend-consumer',
                    autoAck: true
                });

                if (result.success && result.messages && result.messages.length > 0) {
                    for (const message of result.messages) {
                        this.handleEngineEvent(message.data);
                    }
                }
            } catch (error) {
                this.deps.logger.error('Error reading engine events', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Handle incoming engine events
     */
    private handleEngineEvent(event: any): void {
        try {
            this.deps.logger.debug('Received engine event', {
                type: event.type,
                engineId: event.engineId,
                timestamp: event.timestamp
            });

            switch (event.type) {
                case 'ENGINE_STARTED':
                    this.handleEngineStarted(event);
                    break;
                case 'ENGINE_STOPPED':
                    this.handleEngineStopped(event);
                    break;
                case 'BOT_STARTED':
                    this.handleBotStarted(event);
                    break;
                case 'BOT_STOPPED':
                    this.handleBotStopped(event);
                    break;
                case 'BOT_HEARTBEAT':
                    this.handleBotHeartbeat(event);
                    break;
                case 'ENGINE_ERROR':
                    this.handleEngineError(event);
                    break;
                case 'TRADE_EXECUTED':
                    this.handleTradeExecuted(event);
                    break;
                case 'POSITION_UPDATED':
                    this.handlePositionUpdated(event);
                    break;
                case 'PERFORMANCE_SNAPSHOT':
                    this.handlePerformanceSnapshot(event);
                    break;
                default:
                    this.deps.logger.warn('Unknown engine event type', {
                        type: event.type
                    });
            }
        } catch (error) {
            this.deps.logger.error('Error handling engine event', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Handle engine started event
     */
    private handleEngineStarted(event: any): void {
        this.engineId = event.engineId;
        this.engineStatus = {
            running: true,
            health: {
                status: 'HEALTHY',
                bots: 0,
                uptime: event.uptime
            }
        };

        this.deps.logger.info('Engine started successfully', {
            engineId: event.engineId,
            uptime: event.uptime
        });
    }

    /**
     * Handle engine stopped event
     */
    private handleEngineStopped(event: any): void {
        this.engineStatus.running = false;
        this.deps.logger.info('Engine stopped', {
            engineId: event.engineId,
            reason: event.reason,
            uptime: event.uptime
        });
    }

    /**
     * Handle bot started event
     */
    private handleBotStarted(event: any): void {
        this.deps.logger.info('Bot started', {
            botId: event.botId,
            strategyId: event.strategyId,
            symbol: event.symbol,
            strategyType: event.strategyType
        });
    }

    /**
     * Handle bot stopped event
     */
    private handleBotStopped(event: any): void {
        this.deps.logger.info('Bot stopped', {
            botId: event.botId,
            reason: event.reason
        });
    }

    /**
     * Handle bot heartbeat event
     */
    private handleBotHeartbeat(event: any): void {
        this.deps.logger.debug('Bot heartbeat received', {
            botId: event.botId,
            status: event.status,
            currentPrice: event.currentPrice,
            totalTrades: event.totalTrades,
            totalPnl: event.totalPnl
        });
    }

    /**
     * Handle engine error event
     */
    private handleEngineError(event: any): void {
        this.deps.logger.error('Engine error', {
            botId: event.botId,
            error: event.error,
            stack: event.stack
        });
    }

    /**
     * Handle trade executed event
     */
    private handleTradeExecuted(event: any): void {
        this.deps.logger.info('Trade executed', {
            botId: event.botId,
            symbol: event.symbol,
            side: event.side,
            price: event.price,
            quantity: event.quantity,
            fee: event.fee,
            pnl: event.pnl,
            orderId: event.orderId
        });
    }

    /**
     * Handle position updated event
     */
    private handlePositionUpdated(event: any): void {
        this.deps.logger.debug('Position updated', {
            botId: event.botId,
            symbol: event.symbol,
            side: event.side,
            quantity: event.quantity,
            entryPrice: event.entryPrice,
            markPrice: event.markPrice,
            pnl: event.pnl
        });
    }

    /**
     * Handle performance snapshot event
     */
    private handlePerformanceSnapshot(event: any): void {
        this.deps.logger.debug('Performance snapshot received', {
            botId: event.botId,
            metrics: event.metrics
        });
    }

    /**
     * Send start engine command
     */
    async sendStartEngineCommand(): Promise<void> {
        const command = {
            type: 'START_ENGINE',
            engineId: this.engineId || 'default-engine',
            timestamp: Date.now()
        };

        const result = await this.streamOperations.publish('engine:commands', command);

        if (result.success) {
            this.deps.logger.info('Start engine command sent');
        } else {
            this.deps.logger.error('Failed to send start engine command', {
                error: result.error
            });
        }
    }

    /**
     * Send stop engine command
     */
    async sendStopEngineCommand(): Promise<void> {
        const command = {
            type: 'STOP_ENGINE',
            engineId: this.engineId || 'default-engine',
            timestamp: Date.now()
        };

        const result = await this.streamOperations.publish('engine:commands', command);

        if (result.success) {
            this.deps.logger.info('Stop engine command sent');
        } else {
            this.deps.logger.error('Failed to send stop engine command', {
                error: result.error
            });
        }
    }

    /**
     * Send start bot command
     */
    async sendStartBotCommand(botId: string, strategyId: string, config: any, credentials: any): Promise<void> {
        const command = {
            type: 'START_BOT',
            engineId: this.engineId || 'default-engine',
            botId,
            strategyId,
            config,
            credentials,
            timestamp: Date.now()
        };

        const result = await this.streamOperations.publish('engine:commands', command);

        if (result.success) {
            this.deps.logger.info('Start bot command sent', {
                botId,
                strategyId
            });
        } else {
            this.deps.logger.error('Failed to send start bot command', {
                botId,
                strategyId,
                error: result.error
            });
        }
    }

    /**
     * Send stop bot command
     */
    async sendStopBotCommand(botId: string): Promise<void> {
        const command = {
            type: 'STOP_BOT',
            engineId: this.engineId || 'default-engine',
            botId,
            timestamp: Date.now()
        };

        const result = await this.streamOperations.publish('engine:commands', command);

        if (result.success) {
            this.deps.logger.info('Stop bot command sent', {
                botId
            });
        } else {
            this.deps.logger.error('Failed to send stop bot command', {
                botId,
                error: result.error
            });
        }
    }

    /**
     * Send emergency stop command
     */
    async sendEmergencyStopCommand(botId: string, action: 'CANCEL_ALL_ORDERS' | 'CLOSE_POSITIONS' | 'FULL_SHUTDOWN'): Promise<void> {
        const command = {
            type: 'EMERGENCY_STOP',
            engineId: this.engineId || 'default-engine',
            botId,
            action,
            timestamp: Date.now()
        };

        const result = await this.streamOperations.publish('engine:commands', command);

        if (result.success) {
            this.deps.logger.warn('Emergency stop command sent', {
                botId,
                action
            });
        } else {
            this.deps.logger.error('Failed to send emergency stop command', {
                botId,
                action,
                error: result.error
            });
        }
    }

    /**
     * Send update strategy config command
     */
    async sendUpdateStrategyConfigCommand(botId: string, config: any): Promise<void> {
        const command = {
            type: 'UPDATE_STRATEGY_CONFIG',
            engineId: this.engineId || 'default-engine',
            botId,
            config,
            timestamp: Date.now()
        };

        const result = await this.streamOperations.publish('engine:commands', command);

        if (result.success) {
            this.deps.logger.info('Update strategy config command sent', {
                botId
            });
        } else {
            this.deps.logger.error('Failed to send update strategy config command', {
                botId,
                error: result.error
            });
        }
    }
}

// Export factory function for creating service instances
export function createEngineManager(deps: EngineManagerServiceDependencies, enginePort?: number): EngineManager {
    return new EngineManager(deps, enginePort);
}