/**
 * Engine Management Components
 *
 * Modular architecture for comprehensive engine process supervision:
 * - ProcessSpawner: Core process lifecycle management
 * - HealthMonitor: Multi-layer health assessment
 * - RestartManager: Intelligent restart policies
 * - CircuitBreaker: Failure isolation and recovery
 * - ProcessSupervisor: Lifecycle orchestration
 */

// Core components
export { ProcessSpawner } from './process-spawner';
export type { ProcessConfig, ReadinessConfig } from './process-spawner';

export { HealthMonitor } from './health-monitor';
export type { EngineHealth, HealthCheckConfig } from './health-monitor';

export { RestartManager } from './restart-manager';
export type { RestartAttempt, RestartResult, RestartConfig } from './restart-manager';
export { RestartPolicy } from './restart-manager';

export { CircuitBreaker } from './circuit-breaker';
export type { CircuitBreakerConfig, CircuitBreakerStats } from './circuit-breaker';
export { CircuitState } from './circuit-breaker';

export { ProcessSupervisor } from './process-supervisor';
export type { SupervisorConfig, SupervisorStats } from './process-supervisor';
export { ProcessState } from './process-supervisor';
