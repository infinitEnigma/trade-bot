/**
 * ===========================================
 * 🚀 ENGINE MANAGER - FACADE PATTERN
 * ===========================================
 *
 * Facade for the comprehensive engine process supervision system.
 * Orchestrates all engine management components while maintaining
 * backward compatibility with existing API consumers.
 *
 * ARCHITECTURE:
 * - ProcessSpawner: Core process lifecycle
 * - HealthMonitor: Multi-layer health assessment
 * - RestartManager: Intelligent restart policies
 * - CircuitBreaker: Failure isolation
 * - ProcessSupervisor: Lifecycle orchestration
 *
 * BACKWARD COMPATIBILITY:
 * - All existing methods and interfaces preserved
 * - Enhanced functionality through new supervision system
 * - Automatic migration to enterprise supervision
 *
 * @format
 */

import axios from "axios";
import { logger } from "../../core/logging";
import {
  ProcessSpawner,
  HealthMonitor,
  RestartManager,
  CircuitBreaker,
  ProcessSupervisor,
  ProcessState,
} from "./engine";

// Extend global object to include io
declare global {
  var io: any;
}

interface EngineStatus {
  running: boolean;
  health?: {
    status: string;
    bots: number;
    uptime: number;
  };
}

export class EngineManager {
  // Engine components (enterprise supervision system)
  private processSpawner: ProcessSpawner;
  private healthMonitor: HealthMonitor;
  private restartManager: RestartManager;
  private circuitBreaker: CircuitBreaker;
  private processSupervisor: ProcessSupervisor;

  // Engine configuration
  private enginePort: number;

  constructor(enginePort = 4000) {
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
      const response = await axios.get(
        `http://localhost:${this.enginePort}/api/engine/health`,
        { timeout: 2000 }
      );

      return {
        running: true,
        health: response.data,
      };
    } catch (error) {
      return { running: false };
    }
  }

  /**
   * Stop engine if no active bots (backward compatibility)
   */
  async stopEngineIfNoActiveBots(): Promise<void> {
    try {
      const { query } = await import("../../database/pool.js");
      const result = await query(
        "SELECT COUNT(*) FROM bot_instances WHERE status = 'RUNNING'",
        []
      );

      const activeBotCount = parseInt(result.rows[0].count);

      if (activeBotCount === 0) {
        logger.info("No active bots, stopping engine");
        await this.processSpawner.kill('SIGTERM');
      } else {
        logger.debug(`Engine kept running for ${activeBotCount} active bots`);
      }
    } catch (error) {
      logger.error("Error checking for engine shutdown", {
        error: error instanceof Error ? error.message : String(error),
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

// Enhanced health interface
interface EngineHealth {
  processAlive: boolean;
  httpResponsive: boolean;
  websocketConnected: boolean;
  botsResponding: boolean;
  lastTradeActivity: Date;
  memoryUsage: number;
  errorRate: number;
  overallHealthy: boolean;
}

// Export singleton instance
export const engineManager = new EngineManager();
