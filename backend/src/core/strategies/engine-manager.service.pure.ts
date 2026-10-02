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

import {
  IBotInstanceRepository,
  ILogger,
  StartBotCommand,
} from "@trade-bot/shared";
import {
  ProcessSpawner,
  HealthMonitor,
  RestartManager,
  CircuitBreaker,
  ProcessSupervisor,
} from "./engine";
import { RedisStreamOperations } from "../../infrastructure/cache/redis";

/**
 * Mirrors ENGINE_HEARTBEAT_TIMEOUT_MS in core/bots/engine-registry.service
 * (kept local to avoid importing the registry's service graph here).
 */
const ENGINE_HEARTBEAT_TIMEOUT_S = 30;

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

  constructor(
    private deps: EngineManagerServiceDependencies,
    enginePort = 4000
  ) {
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
   * Ensure the engine is available (backward compatibility).
   *
   * The engine is supervised externally (npm run prod:all / prod:engine, dev
   * siblings — OPERATIONS §7) and is NEVER spawned by the backend: the legacy
   * spawn path targeted the removed engine/kodiak tree and the engine exposes
   * no HTTP health endpoint for waitForReady(), so it only ever produced
   * "Process spawn failed". Liveness comes from engine_registry heartbeats
   * (refreshed every 10s while the engine runs; sweep marks OFFLINE at 30s).
   * When the engine is down, fail fast with an actionable message.
   */
  async ensureEngineRunning(): Promise<void> {
    if (await this.isEngineAlive()) {
      return;
    }

    this.deps.logger.warn("Start rejected: trading engine is offline");
    const error = new Error(
      "Trading engine is not running. Start it with 'npm run prod:engine' (or 'npm run prod:all') and retry."
    ) as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }

  /**
   * True when an externally supervised engine (registry heartbeat) or a
   * legacy backend-owned child process is alive. A registry query failure
   * counts as "not alive" so the start fails fast with the actionable
   * message above instead of a misleading one.
   */
  private async isEngineAlive(): Promise<boolean> {
    // 1. Externally supervised engine? Trust the registry heartbeat.
    try {
      const { query } = await import("../../database/pool");
      const live = await query<{ engine_id: string }>(
        `SELECT engine_id FROM engine_registry
          WHERE status = 'ONLINE'
            AND last_seen_at > NOW() - make_interval(secs => $1)
          LIMIT 1`,
        [ENGINE_HEARTBEAT_TIMEOUT_S]
      );
      if ((live.rowCount ?? 0) > 0) {
        this.deps.logger.debug("Engine alive (registry heartbeat)", {
          engineId: live.rows[0].engine_id,
        });
        return true;
      }
    } catch (error) {
      this.deps.logger.warn("Engine registry liveness check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 2. Legacy backend-owned child process (dev only).
    try {
      if (this.processSpawner.isAlive()) {
        this.deps.logger.debug("Engine alive (backend child process)");
        return true;
      }
    } catch {
      // Fall through → offline.
    }

    return false;
  }

  /**
   * Get engine status (backward compatibility)
   */
  async getEngineStatus(): Promise<EngineStatus> {
    try {
      const axios = await import("axios");
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
      const activeBots =
        await this.deps.botInstanceRepository.getActiveBotInstances();
      const activeBotCount = activeBots.length;

      if (activeBotCount === 0) {
        this.deps.logger.info("No active bots, stopping engine");
        await this.processSpawner.kill("SIGTERM");
      } else {
        this.deps.logger.debug(
          `Engine kept running for ${activeBotCount} active bots`
        );
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
    await this.processSpawner.kill("SIGKILL");
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
  async ensureEngineRunningWithSupervision(): Promise<{
    success: boolean;
    error?: string;
  }> {
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
      lastRestartAttempt:
        this.restartManager.getRestartStatistics().nextRetryIn || 0,
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
  async emergencyStop(reason: string = "emergency_stop"): Promise<void> {
    await this.processSupervisor.emergencyStop(reason);
  }

  /**
   * Manual restart with supervision
   */
  async manualRestart(
    reason: string = "manual_restart"
  ): Promise<{ success: boolean; error?: string }> {
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
  //
  // Note (Phase 4): the legacy `engine:events` listener and its log-only
  // runtime handlers (incl. TRADE_EXECUTED) were removed — nothing published
  // to that stream. The live event path is EngineProtocolService →
  // BotEventProcessor → TradeLedgerService (durable ledger ingest).

  /**
   * Send start engine command
   */
  async sendStartEngineCommand(): Promise<void> {
    const command = {
      type: "START_ENGINE",
      engineId: this.engineId || "default-engine",
      timestamp: Date.now(),
    };

    const result = await this.streamOperations.publish(
      "engine:commands",
      command
    );

    if (result.success) {
      this.deps.logger.info("Start engine command sent");
    } else {
      this.deps.logger.error("Failed to send start engine command", {
        error: result.error,
      });
    }
  }

  /**
   * Send stop engine command
   */
  async sendStopEngineCommand(): Promise<void> {
    const command = {
      type: "STOP_ENGINE",
      engineId: this.engineId || "default-engine",
      timestamp: Date.now(),
    };

    const result = await this.streamOperations.publish(
      "engine:commands",
      command
    );

    if (result.success) {
      this.deps.logger.info("Stop engine command sent");
    } else {
      this.deps.logger.error("Failed to send stop engine command", {
        error: result.error,
      });
    }
  }

  /**
   * Send start bot command
   */
  async sendStartBotCommand(
    botId: string,
    strategyId: string,
    config: Record<string, unknown>,
    credentials: StartBotCommand["credentials"]
  ): Promise<void> {
    const command = {
      type: "START_BOT",
      engineId: this.engineId || "default-engine",
      botId,
      strategyId,
      config,
      credentials,
      timestamp: Date.now(),
    };

    const result = await this.streamOperations.publish(
      "engine:commands",
      command
    );

    if (result.success) {
      this.deps.logger.info("Start bot command sent", {
        botId,
        strategyId,
      });
    } else {
      this.deps.logger.error("Failed to send start bot command", {
        botId,
        strategyId,
        error: result.error,
      });
    }
  }

  /**
   * Send stop bot command
   */
  async sendStopBotCommand(botId: string): Promise<void> {
    const command = {
      type: "STOP_BOT",
      engineId: this.engineId || "default-engine",
      botId,
      timestamp: Date.now(),
    };

    const result = await this.streamOperations.publish(
      "engine:commands",
      command
    );

    if (result.success) {
      this.deps.logger.info("Stop bot command sent", {
        botId,
      });
    } else {
      this.deps.logger.error("Failed to send stop bot command", {
        botId,
        error: result.error,
      });
    }
  }

  /**
   * Send update strategy config command
   */
  async sendUpdateStrategyConfigCommand(
    botId: string,
    config: Record<string, unknown>
  ): Promise<void> {
    const command = {
      type: "UPDATE_STRATEGY_CONFIG",
      engineId: this.engineId || "default-engine",
      botId,
      config,
      timestamp: Date.now(),
    };

    const result = await this.streamOperations.publish(
      "engine:commands",
      command
    );

    if (result.success) {
      this.deps.logger.info("Update strategy config command sent", {
        botId,
      });
    } else {
      this.deps.logger.error("Failed to send update strategy config command", {
        botId,
        error: result.error,
      });
    }
  }
}

// Export factory function for creating service instances
export function createEngineManager(
  deps: EngineManagerServiceDependencies,
  enginePort?: number
): EngineManager {
  return new EngineManager(deps, enginePort);
}
