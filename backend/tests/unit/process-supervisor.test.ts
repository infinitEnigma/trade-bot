import { ProcessSupervisor, ProcessState, SupervisorConfig } from '../../src/core/strategies/engine/process-supervisor';
import { ProcessSpawner } from '../../src/core/strategies/engine/process-spawner';
import { HealthMonitor, EngineHealth } from '../../src/core/strategies/engine/health-monitor';
import { RestartManager, RestartPolicy } from '../../src/core/strategies/engine/restart-manager';
import { CircuitBreaker, CircuitState } from '../../src/core/strategies/engine/circuit-breaker';

// Mock dependencies
jest.mock('../../src/core/strategies/engine/process-spawner');
jest.mock('../../src/core/strategies/engine/health-monitor');
jest.mock('../../src/core/strategies/engine/restart-manager');
jest.mock('../../src/core/strategies/engine/circuit-breaker');

describe('ProcessSupervisor', () => {
    let processSpawner: jest.Mocked<ProcessSpawner>;
    let healthMonitor: jest.Mocked<HealthMonitor>;
    let restartManager: jest.Mocked<RestartManager>;
    let circuitBreaker: jest.Mocked<CircuitBreaker>;
    let processSupervisor: ProcessSupervisor;

    const mockHealthy: EngineHealth = {
        processAlive: true,
        httpResponsive: true,
        websocketConnected: true,
        botsResponding: true,
        lastTradeActivity: new Date(),
        memoryUsage: 0,
        errorRate: 0,
        overallHealthy: true,
        healthScore: 100,
        issues: [],
        timestamp: new Date(),
        checkDuration: 0,
    };

    const mockUnhealthy: EngineHealth = {
        processAlive: true,
        httpResponsive: true,
        websocketConnected: true,
        botsResponding: true,
        lastTradeActivity: new Date(),
        memoryUsage: 0,
        errorRate: 0.15,
        overallHealthy: false,
        healthScore: 45,
        issues: ['some issue'],
        timestamp: new Date(),
        checkDuration: 0,
    };

    const mockCrashed: EngineHealth = {
        processAlive: false,
        httpResponsive: false,
        websocketConnected: false,
        botsResponding: false,
        lastTradeActivity: new Date(0),
        memoryUsage: 0,
        errorRate: 0,
        overallHealthy: false,
        healthScore: 0,
        issues: ['process crashed'],
        timestamp: new Date(),
        checkDuration: 0,
    };

    beforeEach(() => {
        // Create mock instances
        processSpawner = new ProcessSpawner() as jest.Mocked<ProcessSpawner>;
        healthMonitor = new HealthMonitor(processSpawner) as jest.Mocked<HealthMonitor>;
        restartManager = new RestartManager() as jest.Mocked<RestartManager>;
        circuitBreaker = new CircuitBreaker() as jest.Mocked<CircuitBreaker>;

        // Setup default mock implementations
        healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockHealthy);
        healthMonitor.getHealthTrend.mockReturnValue({
            currentHealth: mockHealthy,
            averageHealthScore: 100,
            healthStability: 'stable',
            recentIssues: []
        });
        restartManager.getRestartStatistics.mockReturnValue({
            totalAttempts: 0,
            successfulAttempts: 0,
            failedAttempts: 0,
            successRate: 0,
            averageBackoffDelay: 0,
            currentBackoffDelay: 0,
            policy: RestartPolicy.EXPONENTIAL_BACKOFF,
            canAttemptRestart: true
        });
        restartManager.getRestartAnalysis.mockReturnValue({
            statistics: {
                totalAttempts: 0,
                successfulAttempts: 0,
                failedAttempts: 0,
                successRate: 0,
                averageBackoffDelay: 0,
                currentBackoffDelay: 0,
                policy: RestartPolicy.EXPONENTIAL_BACKOFF,
                canAttemptRestart: true
            },
            recentAttempts: [],
            recommendations: [],
            healthStatus: 'healthy'
        });
        restartManager.attemptIntelligentRestart.mockResolvedValue({
            success: true,
            attemptNumber: 1,
            totalAttempts: 1
        });
        restartManager.shouldAttemptRestartForReason.mockReturnValue(true);
        circuitBreaker.getAnalysis.mockReturnValue({
            stats: {
                state: CircuitState.CLOSED,
                failures: 0,
                successes: 0,
                lastFailureTime: 0,
                lastSuccessTime: 0,
                nextAttemptTime: 0
            },
            health: {
                healthy: true,
                state: CircuitState.CLOSED,
                issues: [],
                recommendations: []
            },
            config: {
                failureThreshold: 5,
                recoveryTimeout: 60000,
                monitoringPeriod: 60000,
                successThreshold: 3,
                timeout: 5000
            },
            metrics: {
                failureRate: 0,
                averageTimeBetweenFailures: 0,
                uptimePercentage: 100
            }
        });
        circuitBreaker.reset.mockImplementation();

        // Create supervisor instance
        processSupervisor = new ProcessSupervisor(processSpawner, healthMonitor, restartManager, circuitBreaker);
    });

    describe('constructor', () => {
        it('should create a ProcessSupervisor instance with default configuration', () => {
            expect(processSupervisor).toBeInstanceOf(ProcessSupervisor);
        });

        it('should create a ProcessSupervisor instance with custom configuration', () => {
            const customConfig: Partial<SupervisorConfig> = {
                supervisionInterval: 5000,
                maxRecoveryTime: 120000,
                emergencyShutdownTimeout: 15000,
                enableAutoRestart: false,
                enableCircuitBreaker: false,
            };

            const supervisor = new ProcessSupervisor(processSpawner, healthMonitor, restartManager, circuitBreaker, customConfig);
            expect(supervisor).toBeInstanceOf(ProcessSupervisor);
            expect(supervisor.getSupervisorStatus().config).toEqual(expect.objectContaining(customConfig));
        });
    });

    describe('basic functionality', () => {
        it('should start and stop supervision', async () => {
            // Create a new supervisor with auto-restart disabled to simplify test
            processSupervisor = new ProcessSupervisor(processSpawner, healthMonitor, restartManager, circuitBreaker, {
                enableAutoRestart: false
            });

            // Directly call the supervision cycle instead of relying on the interval
            const superviseProcessLifecycle = (ProcessSupervisor.prototype as any).superviseProcessLifecycle;
            await superviseProcessLifecycle.call(processSupervisor);

            expect(processSupervisor.getProcessState()).not.toEqual(ProcessState.STOPPED);
        });

        it('should get current process state', () => {
            const state = processSupervisor.getProcessState();
            expect(Object.values(ProcessState)).toContain(state);
        });

        it('should get supervision statistics', () => {
            const stats = processSupervisor.getSupervisionStats();
            expect(stats).toEqual(expect.objectContaining({
                state: expect.any(String),
                uptime: expect.any(Number),
                totalRestarts: expect.any(Number),
                lastStateChange: expect.any(Number),
                supervisionCycles: expect.any(Number),
                averageHealthScore: expect.any(Number),
            }));
        });

        it('should get supervisor status with all components', () => {
            const status = processSupervisor.getSupervisorStatus();
            expect(status).toEqual(expect.objectContaining({
                state: expect.any(String),
                stats: expect.any(Object),
                healthTrend: expect.any(Object),
                restartAnalysis: expect.any(Object),
                circuitBreakerAnalysis: expect.any(Object),
                config: expect.any(Object),
            }));
        });
    });

    describe('state management', () => {
        it('should transition from STOPPED to RUNNING when process is healthy', async () => {
            // Initial state should be STOPPED
            expect(processSupervisor.getProcessState()).toBe(ProcessState.STOPPED);

            // Directly call the supervision cycle
            const superviseProcessLifecycle = (ProcessSupervisor.prototype as any).superviseProcessLifecycle;
            await superviseProcessLifecycle.call(processSupervisor);

            // After initial check, state should be RUNNING (healthy)
            expect(processSupervisor.getProcessState()).toBe(ProcessState.RUNNING);
        });

        it('should transition to RECOVERING when health check fails and auto-restart is enabled', async () => {
            healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockUnhealthy);

            // Directly call the supervision cycle
            const superviseProcessLifecycle = (ProcessSupervisor.prototype as any).superviseProcessLifecycle;
            await superviseProcessLifecycle.call(processSupervisor);

            expect(processSupervisor.getProcessState()).toBe(ProcessState.RECOVERING);
        });

        it('should transition to RECOVERING when process crashes and auto-restart is enabled', async () => {
            healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockCrashed);

            // Directly call the supervision cycle
            const superviseProcessLifecycle = (ProcessSupervisor.prototype as any).superviseProcessLifecycle;
            await superviseProcessLifecycle.call(processSupervisor);

            expect(processSupervisor.getProcessState()).toBe(ProcessState.RECOVERING);
        });

        it('should transition to UNHEALTHY when health check fails and auto-restart is disabled', async () => {
            processSupervisor = new ProcessSupervisor(processSpawner, healthMonitor, restartManager, circuitBreaker, {
                enableAutoRestart: false
            });
            healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockUnhealthy);

            // Directly call the supervision cycle
            const superviseProcessLifecycle = (ProcessSupervisor.prototype as any).superviseProcessLifecycle;
            await superviseProcessLifecycle.call(processSupervisor);

            expect(processSupervisor.getProcessState()).toBe(ProcessState.UNHEALTHY);
        });

        it('should transition to CRASHED when process crashes and auto-restart is disabled', async () => {
            processSupervisor = new ProcessSupervisor(processSpawner, healthMonitor, restartManager, circuitBreaker, {
                enableAutoRestart: false
            });
            healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockCrashed);

            // Directly call the supervision cycle
            const superviseProcessLifecycle = (ProcessSupervisor.prototype as any).superviseProcessLifecycle;
            await superviseProcessLifecycle.call(processSupervisor);

            expect(processSupervisor.getProcessState()).toBe(ProcessState.CRASHED);
        });
    });

    describe('recovery mechanisms', () => {
        it('should attempt restart when process crashes and auto-restart is enabled', async () => {
            healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockCrashed);
            let stateChangeCallback: (state: ProcessState) => void;

            // We need to wait for handleStateTransition to complete the async work
            await new Promise<void>((resolve) => {
                const originalHandleProcessCrash = (ProcessSupervisor.prototype as any).handleProcessCrash;
                (ProcessSupervisor.prototype as any).handleProcessCrash = async function (health: EngineHealth) {
                    await originalHandleProcessCrash.call(this, health);
                    resolve();
                };

                processSupervisor.startSupervision();
            });

            expect(restartManager.attemptIntelligentRestart).toHaveBeenCalledWith('process_crash');
            expect(processSupervisor.getProcessState()).toBe(ProcessState.RECOVERING);

            processSupervisor.stopSupervision();
        });

        it('should handle failed restart attempts', async () => {
            healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockCrashed);
            restartManager.attemptIntelligentRestart.mockResolvedValue({
                success: false,
                error: 'Restart failed',
                attemptNumber: 1,
                totalAttempts: 1,
                nextRetryIn: 30000
            });

            await new Promise<void>((resolve) => {
                const originalHandlePermanentFailure = (ProcessSupervisor.prototype as any).handlePermanentFailure;
                (ProcessSupervisor.prototype as any).handlePermanentFailure = async function (reason: string) {
                    await originalHandlePermanentFailure.call(this, reason);
                    resolve();
                };

                processSupervisor.startSupervision();
            });

            expect(restartManager.attemptIntelligentRestart).toHaveBeenCalledWith('process_crash');
            expect(processSupervisor.getProcessState()).toBe(ProcessState.STOPPED);

            processSupervisor.stopSupervision();
        });

        it('should handle unhealthy process and attempt recovery', async () => {
            healthMonitor.performMultiLayerHealthCheck.mockResolvedValue(mockUnhealthy);

            await new Promise<void>((resolve) => {
                const originalHandleProcessUnhealthy = (ProcessSupervisor.prototype as any).handleProcessUnhealthy;
                (ProcessSupervisor.prototype as any).handleProcessUnhealthy = async function (health: EngineHealth) {
                    await originalHandleProcessUnhealthy.call(this, health);
                    resolve();
                };

                processSupervisor.startSupervision();
            });

            expect(restartManager.attemptIntelligentRestart).toHaveBeenCalledWith('process_unhealthy');
            expect(processSupervisor.getProcessState()).toBe(ProcessState.RECOVERING);

            processSupervisor.stopSupervision();
        });

        it('should reset state when resetSupervisorState is called', () => {
            processSupervisor.resetSupervisorState();

            expect(processSupervisor.getProcessState()).toBe(ProcessState.STOPPED);
            expect(processSupervisor.getSupervisionStats().supervisionCycles).toBe(0);
            expect(restartManager.resetRestartState).toHaveBeenCalled();
            expect(circuitBreaker.reset).toHaveBeenCalled();
        });
    });

    describe('manual operations', () => {
        it('should handle manual restart', async () => {
            processSpawner.kill.mockResolvedValue();
            processSpawner.spawn.mockResolvedValue({ pid: 123 } as any);
            processSpawner.waitForReady.mockResolvedValue();

            const result = await processSupervisor.manualRestart('test_restart');

            expect(result.success).toBe(true);
            expect(processSpawner.kill).toHaveBeenCalledWith('SIGKILL');
            expect(processSpawner.spawn).toHaveBeenCalled();
            expect(processSpawner.waitForReady).toHaveBeenCalled();
        });

        it('should handle failed manual restart', async () => {
            processSpawner.kill.mockRejectedValue(new Error('Kill failed'));

            const result = await processSupervisor.manualRestart('test_restart');

            expect(result.success).toBe(false);
            expect(result.error).toEqual(expect.any(String));
            expect(processSupervisor.getProcessState()).toBe(ProcessState.CRASHED);
        });

        it('should handle emergency stop', async () => {
            processSpawner.kill.mockResolvedValue();

            await processSupervisor.emergencyStop('test_emergency');

            expect(processSupervisor.getProcessState()).toBe(ProcessState.STOPPED);
            expect(processSpawner.kill).toHaveBeenCalled();
        });
    });

    describe('supervision lifecycle', () => {
        it('should handle supervision failures gracefully', async () => {
            healthMonitor.performMultiLayerHealthCheck.mockRejectedValue(new Error('Health check failed'));

            processSupervisor.startSupervision();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(processSupervisor.getProcessState()).toBe(ProcessState.STOPPED);

            processSupervisor.stopSupervision();
        });

        it('should track supervision cycles', async () => {
            const initialCycles = processSupervisor.getSupervisionStats().supervisionCycles;

            processSupervisor.startSupervision();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(processSupervisor.getSupervisionStats().supervisionCycles).toBeGreaterThan(initialCycles);

            processSupervisor.stopSupervision();
        });
    });
});