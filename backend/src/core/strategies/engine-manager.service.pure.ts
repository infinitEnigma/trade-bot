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

    // Engine configuration
    private enginePort: number;

    constructor(private deps: EngineManagerServiceDependencies, enginePort = 4000) {
        this.enginePort = enginePort;

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
}

// Export factory function for creating service instances
export function createEngineManager(deps: EngineManagerServiceDependencies, enginePort?: number): EngineManager {
    return new EngineManager(deps, enginePort);
}