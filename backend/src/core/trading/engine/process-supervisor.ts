/**
 * ===========================================
 * 🎭 PROCESS SUPERVISOR - LIFECYCLE ORCHESTRATION
 * ===========================================
 *
 * Orchestrates the complete process supervision lifecycle by coordinating
 * all engine management components: ProcessSpawner, HealthMonitor, RestartManager,
 * and CircuitBreaker.
 *
 * SUPERVISION CYCLE:
 * 1. Health Assessment - Multi-layer health checks
 * 2. State Determination - Process state from health data
 * 3. State Transition - Handle state changes and recovery
 * 4. Failure Recovery - Automatic restart and escalation
 *
 * COMPONENT COORDINATION:
 * - ProcessSpawner: Process lifecycle management
 * - HealthMonitor: Multi-layer health assessment
 * - RestartManager: Intelligent restart policies
 * - CircuitBreaker: Failure isolation and recovery
 *
 * SUPERVISION STATES:
 * - STOPPED: Process not running
 * - STARTING: Process initialization
 * - RUNNING: Process operating normally
 * - UNHEALTHY: Process detected issues
 * - CRASHED: Process terminated unexpectedly
 * - RECOVERING: Process recovery in progress
 *
 * @format
 */

import logger from "../logger";
import { ProcessSpawner } from "./process-spawner";
import { HealthMonitor, EngineHealth } from "./health-monitor";
import { RestartManager } from "./restart-manager";
import { CircuitBreaker } from "./circuit-breaker";
import { ErrorCategory, ErrorSeverity } from "../error-notification";

export enum ProcessState {
    STOPPED = 'stopped',       // Process not running (terminal)
    STARTING = 'starting',     // Process initialization in progress
    RUNNING = 'running',       // Process operating normally
    UNHEALTHY = 'unhealthy',   // Process detected issues
    CRASHED = 'crashed',       // Process terminated unexpectedly
    RECOVERING = 'recovering', // Process recovery in progress
}

export interface SupervisorConfig {
    supervisionInterval: number;    // How often to check (ms)
    maxRecoveryTime: number;       // Max time for recovery operations (ms)
    emergencyShutdownTimeout: number; // Timeout for emergency operations (ms)
    enableAutoRestart: boolean;    // Whether to auto-restart on failures
    enableCircuitBreaker: boolean; // Whether to use circuit breaker
}

export interface SupervisorStats {
    state: ProcessState;
    uptime: number;
    totalRestarts: number;
    lastStateChange: number;
    supervisionCycles: number;
    averageHealthScore: number;
}

export class ProcessSupervisor {
    private config: SupervisorConfig;
    private processSpawner: ProcessSpawner;
    private healthMonitor: HealthMonitor;
    private restartManager: RestartManager;
    private circuitBreaker: CircuitBreaker;

    // Supervision state
    private state: ProcessState = ProcessState.STOPPED;
    private supervisionInterval: NodeJS.Timeout | null = null;
    private lastStateChange = 0;
    private supervisionCycles = 0;

    // Operational tracking
    private startTime = 0;
    private totalUptime = 0;

    constructor(
        processSpawner: ProcessSpawner,
        healthMonitor: HealthMonitor,
        restartManager: RestartManager,
        circuitBreaker: CircuitBreaker,
        config?: Partial<SupervisorConfig>
    ) {
        this.processSpawner = processSpawner;
        this.healthMonitor = healthMonitor;
        this.restartManager = restartManager;
        this.circuitBreaker = circuitBreaker;

        this.config = {
            supervisionInterval: 10000, // 10 seconds
            maxRecoveryTime: 300000,   // 5 minutes
            emergencyShutdownTimeout: 30000, // 30 seconds
            enableAutoRestart: true,
            enableCircuitBreaker: true,
            ...config,
        };
    }

    /**
     * Start process supervision
     */
    startSupervision(): void {
        if (this.supervisionInterval) {
            logger.warn("Supervision already running");
            return;
        }

        logger.info("Starting process supervision", {
            interval: this.config.supervisionInterval,
            autoRestart: this.config.enableAutoRestart,
            circuitBreaker: this.config.enableCircuitBreaker,
        });

        // Start supervision cycle
        this.supervisionInterval = setInterval(async () => {
            await this.superviseProcessLifecycle();
        }, this.config.supervisionInterval);

        // Run initial supervision check
        setImmediate(() => this.superviseProcessLifecycle());
    }

    /**
     * Stop process supervision
     */
    stopSupervision(): void {
        if (this.supervisionInterval) {
            clearInterval(this.supervisionInterval);
            this.supervisionInterval = null;
            logger.info("Stopped process supervision");
        }

        // Update total uptime
        if (this.startTime > 0) {
            this.totalUptime += Date.now() - this.startTime;
        }
    }

    /**
     * Main supervision cycle
     */
    private async superviseProcessLifecycle(): Promise<void> {
        try {
            this.supervisionCycles++;

            // Perform comprehensive health assessment
            const health = await this.healthMonitor.performMultiLayerHealthCheck();

            // Determine new process state from health
            const newState = this.determineProcessState(health);

            // Handle state transitions
            if (newState !== this.state) {
                await this.handleStateTransition(this.state, newState, health);
                this.state = newState;
                this.lastStateChange = Date.now();
            }

            // Log supervision cycle (debug level)
            logger.debug("Supervision cycle completed", {
                cycle: this.supervisionCycles,
                state: this.state,
                healthScore: health.healthScore,
                overallHealthy: health.overallHealthy,
            });

        } catch (error) {
            logger.error("Supervision cycle failed", {
                error: error instanceof Error ? error.message : String(error),
                state: this.state,
                cycle: this.supervisionCycles,
            });

            // If supervision itself is failing, that's critical
            await this.handleSupervisionFailure(error);
        }
    }

    /**
     * Determine process state from health assessment
     */
    private determineProcessState(health: EngineHealth): ProcessState {
        // Critical: Process must be alive
        if (!health.processAlive) {
            return ProcessState.CRASHED;
        }

        // Critical: HTTP must be responsive
        if (!health.httpResponsive) {
            return ProcessState.UNHEALTHY;
        }

        // If we're in recovery state and health is good, move to running
        if (this.state === ProcessState.RECOVERING && health.overallHealthy) {
            return ProcessState.RUNNING;
        }

        // If overall health is good, we're running
        if (health.overallHealthy) {
            return ProcessState.RUNNING;
        }

        // Otherwise, we're unhealthy
        return ProcessState.UNHEALTHY;
    }

    /**
     * Handle process state transitions
     */
    private async handleStateTransition(
        oldState: ProcessState,
        newState: ProcessState,
        health: EngineHealth
    ): Promise<void> {
        logger.info("Process state transition", {
            from: oldState,
            to: newState,
            healthScore: health.healthScore,
            issues: health.issues,
        });

        // Update timing tracking
        if (newState === ProcessState.RUNNING && oldState !== ProcessState.RUNNING) {
            this.startTime = Date.now();
        } else if (oldState === ProcessState.RUNNING && newState !== ProcessState.RUNNING) {
            if (this.startTime > 0) {
                this.totalUptime += Date.now() - this.startTime;
                this.startTime = 0;
            }
        }

        // Handle specific state transitions
        switch (newState) {
            case ProcessState.CRASHED:
                await this.handleProcessCrash(health);
                break;
            case ProcessState.UNHEALTHY:
                await this.handleProcessUnhealthy(health);
                break;
            case ProcessState.RUNNING:
                if (oldState === ProcessState.RECOVERING) {
                    await this.handleProcessRecovery();
                }
                break;
        }
    }

    /**
     * Handle process crash
     */
    private async handleProcessCrash(health: EngineHealth): Promise<void> {
        logger.error("Process crash detected", {
            state: this.state,
            healthIssues: health.issues,
        });

        // Notify about crash
        await this.notifyProcessFailure('process_crash', health);

        // Attempt restart if enabled
        if (this.config.enableAutoRestart) {
            const restartResult = await this.restartManager.attemptIntelligentRestart('process_crash');

            if (restartResult.success) {
                this.state = ProcessState.RECOVERING;
                logger.info("Process restart initiated after crash");
            } else {
                logger.error("Process restart failed after crash", {
                    error: restartResult.error,
                    nextRetryIn: restartResult.nextRetryIn,
                });
                await this.handlePermanentFailure('Process crashed and restart failed');
            }
        }
    }

    /**
     * Handle unhealthy process
     */
    private async handleProcessUnhealthy(health: EngineHealth): Promise<void> {
        logger.warn("Process unhealthy detected", {
            state: this.state,
            healthScore: health.healthScore,
            issues: health.issues,
        });

        // For unhealthy state, we can either monitor or attempt recovery
        // depending on severity and restart policy
        if (this.config.enableAutoRestart &&
            this.restartManager.shouldAttemptRestartForReason('process_unhealthy')) {

            this.state = ProcessState.RECOVERING;

            const restartResult = await this.restartManager.attemptIntelligentRestart('process_unhealthy');

            if (restartResult.success) {
                logger.info("Process restart initiated for unhealthy state");
            } else {
                this.state = ProcessState.UNHEALTHY;
                logger.warn("Process restart declined for unhealthy state", {
                    reason: restartResult.error,
                });
            }
        }
    }

    /**
     * Handle process recovery
     */
    private async handleProcessRecovery(): Promise<void> {
        logger.info("Process recovery completed", {
            state: this.state,
            uptime: this.getUptime(),
        });

        // Notify about successful recovery
        await this.notifyProcessRecovery();

        // Reset any circuit breaker issues
        if (this.config.enableCircuitBreaker) {
            // Circuit breaker will auto-reset on successful operations
        }
    }

    /**
     * Handle permanent failure
     */
    private async handlePermanentFailure(reason: string): Promise<void> {
        logger.error("Permanent process failure", {
            reason,
            state: this.state,
            totalRestarts: this.restartManager.getRestartStatistics().totalAttempts,
        });

        this.state = ProcessState.STOPPED;

        // Notify about permanent failure
        await this.notifyPermanentFailure(reason);

        // Stop supervision to prevent further attempts
        this.stopSupervision();
    }

    /**
     * Handle supervision system failure
     */
    private async handleSupervisionFailure(error: unknown): Promise<void> {
        logger.error("Supervision system failure", {
            error: error instanceof Error ? error.message : String(error),
            state: this.state,
            cycles: this.supervisionCycles,
        });

        // If supervision is failing, that's a critical system issue
        // We should probably alert and potentially stop the system
        this.state = ProcessState.STOPPED;
        await this.notifySupervisionFailure(error);
    }

    /**
     * Notify about process failure
     */
    private async notifyProcessFailure(reason: string, health: EngineHealth): Promise<void> {
        try {
            // Import notification service dynamically to avoid circular imports
            const { errorNotificationService } = await import("../error-notification.js");

            await errorNotificationService.notifyError(
                new Error(`Engine process failure: ${reason}`),
                {
                    category: ErrorCategory.SYSTEM,
                    operation: 'engine_supervision',
                    metadata: {
                        processState: this.state,
                        healthScore: health.healthScore,
                        healthIssues: health.issues,
                        supervisionCycles: this.supervisionCycles,
                    },
                },
                ErrorSeverity.HIGH,
                undefined,
                `Process entered ${this.state} state with health score ${health.healthScore}`
            );
        } catch (error) {
            logger.error("Failed to notify about process failure", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Notify about process recovery
     */
    private async notifyProcessRecovery(): Promise<void> {
        try {
            const { errorNotificationService } = await import("../error-notification.js");

            await errorNotificationService.notifyError(
                new Error("Engine process recovered successfully"),
                {
                    category: ErrorCategory.SYSTEM,
                    operation: 'engine_recovery',
                    metadata: {
                        processState: this.state,
                        uptime: this.getUptime(),
                        supervisionCycles: this.supervisionCycles,
                    },
                },
                ErrorSeverity.LOW, // Recovery is good news
                undefined,
                `Process recovered and is now ${this.state}`
            );
        } catch (error) {
            logger.error("Failed to notify about process recovery", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Notify about permanent failure
     */
    private async notifyPermanentFailure(reason: string): Promise<void> {
        try {
            const { errorNotificationService } = await import("../error-notification.js");

            await errorNotificationService.notifyError(
                new Error(`Engine permanent failure: ${reason}`),
                {
                    category: ErrorCategory.SYSTEM,
                    operation: 'engine_permanent_failure',
                    metadata: {
                        reason,
                        processState: this.state,
                        totalRestarts: this.restartManager.getRestartStatistics().totalAttempts,
                        supervisionCycles: this.supervisionCycles,
                    },
                },
                ErrorSeverity.CRITICAL,
                undefined,
                'Engine has failed permanently - manual intervention required'
            );
        } catch (error) {
            logger.error("Failed to notify about permanent failure", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Notify about supervision failure
     */
    private async notifySupervisionFailure(error: unknown): Promise<void> {
        try {
            const { errorNotificationService } = await import("../error-notification.js");

            await errorNotificationService.notifyError(
                new Error(`Supervision system failure: ${error}`),
                {
                    category: ErrorCategory.SYSTEM,
                    operation: 'supervision_failure',
                    metadata: {
                        error: error instanceof Error ? error.message : String(error),
                        processState: this.state,
                        supervisionCycles: this.supervisionCycles,
                    },
                },
                ErrorSeverity.CRITICAL,
                undefined,
                'Process supervision system has failed - critical system issue'
            );
        } catch (notifyError) {
            logger.error("Failed to notify about supervision failure", {
                originalError: error instanceof Error ? error.message : String(error),
                notifyError: notifyError instanceof Error ? notifyError.message : String(notifyError),
            });
        }
    }

    /**
     * Get current process state
     */
    getProcessState(): ProcessState {
        return this.state;
    }

    /**
     * Get supervision statistics
     */
    getSupervisionStats(): SupervisorStats {
        const healthTrend = this.healthMonitor.getHealthTrend();

        return {
            state: this.state,
            uptime: this.getUptime(),
            totalRestarts: this.restartManager.getRestartStatistics().totalAttempts,
            lastStateChange: this.lastStateChange,
            supervisionCycles: this.supervisionCycles,
            averageHealthScore: healthTrend.averageHealthScore,
        };
    }

    /**
     * Get current uptime in milliseconds
     */
    private getUptime(): number {
        let currentUptime = this.totalUptime;

        if (this.startTime > 0 && this.state === ProcessState.RUNNING) {
            currentUptime += Date.now() - this.startTime;
        }

        return currentUptime;
    }

    /**
     * Get comprehensive supervisor status
     */
    getSupervisorStatus(): {
        state: ProcessState;
        stats: SupervisorStats;
        healthTrend: ReturnType<HealthMonitor['getHealthTrend']>;
        restartAnalysis: ReturnType<RestartManager['getRestartAnalysis']>;
        circuitBreakerAnalysis: ReturnType<CircuitBreaker['getAnalysis']>;
        config: SupervisorConfig;
    } {
        return {
            state: this.state,
            stats: this.getSupervisionStats(),
            healthTrend: this.healthMonitor.getHealthTrend(),
            restartAnalysis: this.restartManager.getRestartAnalysis(),
            circuitBreakerAnalysis: this.circuitBreaker.getAnalysis(),
            config: { ...this.config },
        };
    }

    /**
     * Emergency stop - force termination
     */
    async emergencyStop(reason: string = 'emergency_stop'): Promise<void> {
        logger.warn("Emergency stop initiated", { reason, state: this.state });

        this.state = ProcessState.STOPPED;
        this.stopSupervision();

        try {
            await this.processSpawner.kill('SIGKILL', this.config.emergencyShutdownTimeout);
            await this.notifyProcessFailure(reason, await this.healthMonitor.performMultiLayerHealthCheck());
        } catch (error) {
            logger.error("Emergency stop failed", {
                error: error instanceof Error ? error.message : String(error),
                reason,
            });
        }
    }

    /**
     * Manual restart (for admin intervention)
     */
    async manualRestart(reason: string = 'manual_restart'): Promise<{ success: boolean; error?: string }> {
        logger.info("Manual restart initiated", { reason, currentState: this.state });

        try {
            // Force stop current process
            await this.processSpawner.kill('SIGKILL');

            // Start new process
            await this.processSpawner.spawn();
            await this.processSpawner.waitForReady();

            // Start supervision
            this.startSupervision();

            this.state = ProcessState.RUNNING;
            this.lastStateChange = Date.now();

            logger.info("Manual restart completed successfully");
            return { success: true };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error("Manual restart failed", { error: errorMessage, reason });

            this.state = ProcessState.CRASHED;
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Reset supervisor state (for testing)
     */
    resetSupervisorState(): void {
        this.state = ProcessState.STOPPED;
        this.lastStateChange = 0;
        this.supervisionCycles = 0;
        this.startTime = 0;
        this.totalUptime = 0;

        // Reset component states
        this.restartManager.resetRestartState();
        this.circuitBreaker.reset();

        logger.info("Supervisor state reset");
    }
}
