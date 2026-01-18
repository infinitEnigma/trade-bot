/** @format */

import { spawn, ChildProcess } from "child_process";
import axios, { AxiosRequestConfig } from "axios";
import path from "path";
import logger from "./logger";

// Extend global object to include io
declare global {
  var io: any;
}

// Configure global axios defaults for external API calls
axios.defaults.timeout = 10000; // 10 second global timeout
axios.defaults.headers.common['User-Agent'] = 'TradeBot/1.0';

// Add response interceptor for fallback handling
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // If timeout or network error, log and potentially return cached data
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      logger.warn('External API timeout', {
        url: error.config?.url,
        timeout: error.config?.timeout,
        error: error.message,
      });

      // Could implement fallback to cached data here
      // For now, just re-throw with additional context
      const enhancedError = new Error(`External API timeout: ${error.message}`);
      enhancedError.name = 'APITimeoutError';
      throw enhancedError;
    }

    // If service unavailable, log and re-throw
    if (error.response?.status >= 500) {
      logger.warn('External API server error', {
        url: error.config?.url,
        status: error.response.status,
        statusText: error.response.statusText,
      });
    }

    throw error;
  }
);

// Add request interceptor for logging
axios.interceptors.request.use(
  (config) => {
    logger.debug('External API request', {
      method: config.method?.toUpperCase(),
      url: config.url,
      timeout: config.timeout,
    });
    return config;
  },
  (error) => {
    logger.error('External API request failed', {
      error: error.message,
    });
    return Promise.reject(error);
  }
);

interface EngineStatus {
  running: boolean;
  health?: {
    status: string;
    bots: number;
    uptime: number;
  };
}

export class EngineManager {
  private engineProcess: ChildProcess | null = null;
  private enginePort = 4000;
  private enginePath = path.join(__dirname, "../../engine/kodiak");
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealthCheck = 0;
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 3;
  private restartAttempts = 0;
  private maxRestartAttempts = 5;

  /**
   * Ensure the trading engine is running and ready
   */
  async ensureEngineRunning(): Promise<void> {
    const status = await this.getEngineStatus();

    if (status.running) {
      logger.info("Engine already running");
      return;
    }

    logger.info("Engine not running, starting...");
    await this.startEngine();
    await this.waitForEngineReady();

    logger.info("Engine started and ready");
  }

  /**
   * Start the engine process
   */
  private async startEngine(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Start engine with npm run dev
        this.engineProcess = spawn("npm", ["run", "dev"], {
          cwd: this.enginePath,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_ENV: process.env.NODE_ENV || "development",
          },
        });

        // Handle process events
        this.engineProcess.on("error", error => {
          logger.error("Engine process error", { error: error.message });
          reject(error);
        });

        this.engineProcess.on("exit", (code, signal) => {
          logger.info("Engine process exited", { code, signal });
          this.engineProcess = null;
        });

        // Log engine output
        if (this.engineProcess.stdout) {
          this.engineProcess.stdout.on("data", data => {
            logger.debug("Engine stdout", { output: data.toString().trim() });
          });
        }

        if (this.engineProcess.stderr) {
          this.engineProcess.stderr.on("data", data => {
            logger.debug("Engine stderr", { output: data.toString().trim() });
          });
        }

        // Engine starts relatively quickly
        setTimeout(resolve, 3000);
      } catch (error) {
        logger.error("Failed to start engine process", {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      }
    });
  }

  /**
   * Wait for engine to be ready and responding
   */
  private async waitForEngineReady(maxAttempts = 15): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.get(
          `http://localhost:${this.enginePort}/api/engine/health`,
          {
            timeout: 2000,
          }
        );

        if (response.data.status === "healthy") {
          logger.info("Engine health check passed", { attempt });
          return;
        }
      } catch (error) {
        // Engine not ready yet, continue waiting
      }

      logger.debug(`Engine not ready, attempt ${attempt}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Engine failed to start after ${maxAttempts} attempts`);
  }

  /**
   * Get engine status
   */
  async getEngineStatus(): Promise<EngineStatus> {
    try {
      const response = await axios.get(
        `http://localhost:${this.enginePort}/api/engine/health`,
        {
          timeout: 2000,
        }
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
   * Stop engine if no active bots
   */
  async stopEngineIfNoActiveBots(): Promise<void> {
    try {
      // Import query function (avoid circular imports)
      const { query } = await import("../database/pool.js");

      // Check for active bots
      const result = await query(
        "SELECT COUNT(*) FROM bot_instances WHERE status = 'RUNNING'",
        []
      );

      const activeBotCount = parseInt(result.rows[0].count);

      if (activeBotCount === 0 && this.engineProcess) {
        logger.info("No active bots, stopping engine");

        // Send graceful shutdown signal
        this.engineProcess.kill("SIGTERM");

        // Wait for process to exit
        await new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            logger.warn("Engine did not exit gracefully, force killing");
            this.engineProcess?.kill("SIGKILL");
            resolve();
          }, 10000);

          this.engineProcess?.on("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        this.engineProcess = null;
        logger.info("Engine stopped successfully");
      } else if (activeBotCount > 0) {
        logger.debug(`Engine kept running for ${activeBotCount} active bots`);
      }
    } catch (error) {
      logger.error("Error checking for engine shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Force stop engine (emergency)
   */
  async forceStopEngine(): Promise<void> {
    if (this.engineProcess) {
      logger.warn("Force stopping engine");

      this.engineProcess.kill("SIGKILL");
      this.engineProcess = null;

      logger.warn("Engine force stopped");
    }
  }

  /**
   * Check if engine process is still alive
   */
  isEngineProcessAlive(): boolean {
    return this.engineProcess !== null && !this.engineProcess.killed;
  }

  /**
   * Start monitoring the engine process
   */
  startProcessMonitoring(): void {
    if (this.healthCheckInterval) return;

    logger.info("Starting engine process monitoring");

    // Check engine health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      await this.checkEngineHealth();
    }, 30000);
  }

  /**
   * Stop monitoring the engine process
   */
  stopProcessMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info("Stopped engine process monitoring");
    }
  }

  /**
   * Check engine health and handle failures
   */
  private async checkEngineHealth(): Promise<void> {
    const now = Date.now();

    // Skip if we just checked recently
    if (now - this.lastHealthCheck < 25000) return; // 25 seconds to avoid overlap
    this.lastHealthCheck = now;

    try {
      const status = await this.getEngineStatus();

      if (status.running && status.health?.status === "healthy") {
        // Engine is healthy
        this.consecutiveFailures = 0;
        this.restartAttempts = 0;

        // Start monitoring if not already started
        if (!this.healthCheckInterval) {
          this.startProcessMonitoring();
        }

        logger.debug("Engine health check passed");
        return;
      }

      // Engine is not healthy
      this.consecutiveFailures++;

      logger.warn("Engine health check failed", {
        consecutiveFailures: this.consecutiveFailures,
        maxConsecutiveFailures: this.maxConsecutiveFailures,
        isProcessAlive: this.isEngineProcessAlive(),
      });

      // If we've had too many consecutive failures, attempt restart
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        await this.handleEngineFailure();
      }

    } catch (error) {
      this.consecutiveFailures++;

      logger.error("Engine health check error", {
        error: (error as Error).message,
        consecutiveFailures: this.consecutiveFailures,
      });

      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        await this.handleEngineFailure();
      }
    }
  }

  /**
   * Handle engine failure and attempt restart
   */
  private async handleEngineFailure(): Promise<void> {
    logger.error("Engine failure detected, attempting recovery", {
      consecutiveFailures: this.consecutiveFailures,
      restartAttempts: this.restartAttempts,
      maxRestartAttempts: this.maxRestartAttempts,
    });

    // Notify all users about engine failure
    await this.notifyUsersOfEngineFailure();

    // Mark all running bots as error state
    await this.markAllBotsAsError("Engine process failure");

    // Attempt restart if we haven't exceeded max attempts
    if (this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      logger.info("Attempting engine restart", {
        attempt: this.restartAttempts,
        maxAttempts: this.maxRestartAttempts,
      });

      try {
        // Force stop any existing process
        await this.forceStopEngine();

        // Wait a bit before restarting
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Start new engine
        await this.startEngine();
        await this.waitForEngineReady();

        // Reset failure counters
        this.consecutiveFailures = 0;
        this.restartAttempts = 0;

        logger.info("Engine successfully restarted");

        // Notify users of recovery
        await this.notifyUsersOfEngineRecovery();

      } catch (restartError) {
        logger.error("Engine restart failed", {
          error: (restartError as Error).message,
          attempt: this.restartAttempts,
        });

        // If restart fails, try again after a longer delay
        if (this.restartAttempts < this.maxRestartAttempts) {
          setTimeout(() => {
            this.handleEngineFailure();
          }, 10000); // Wait 10 seconds before retry
        } else {
          logger.error("Max restart attempts exceeded, giving up");
          await this.notifyUsersOfEngineFailurePermanent();
        }
      }
    } else {
      logger.error("Max restart attempts reached, engine recovery failed");
      await this.notifyUsersOfEngineFailurePermanent();
    }
  }

  /**
   * Notify all users about engine failure
   */
  private async notifyUsersOfEngineFailure(): Promise<void> {
    try {
      // Import required modules (avoid circular imports)
      const { query } = await import("../database/pool.js");

      // Get all users with running bots
      const usersWithBots = await query(`
        SELECT DISTINCT bi.user_id
        FROM bot_instances bi
        WHERE bi.status IN ('RUNNING', 'STARTING')
      `);

      // Emit WebSocket notifications
      const io = global.io; // Assuming io is available globally
      if (io) {
        for (const user of usersWithBots.rows) {
          io.to(`user:${user.user_id}`).emit("engine:status", {
            status: "failed",
            message: "Trading engine has failed. Your bots may not be trading.",
            timestamp: new Date().toISOString(),
          });
        }
      }

      logger.info("Notified users of engine failure", {
        userCount: usersWithBots.rows.length,
      });
    } catch (error) {
      logger.error("Failed to notify users of engine failure", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Notify all users about engine recovery
   */
  private async notifyUsersOfEngineRecovery(): Promise<void> {
    try {
      const { query } = await import("../database/pool.js");

      const usersWithBots = await query(`
        SELECT DISTINCT bi.user_id
        FROM bot_instances bi
        WHERE bi.status IN ('RUNNING', 'STARTING', 'ERROR')
      `);

      const io = global.io;
      if (io) {
        for (const user of usersWithBots.rows) {
          io.to(`user:${user.user_id}`).emit("engine:status", {
            status: "recovered",
            message: "Trading engine has recovered. Your bots are resuming trading.",
            timestamp: new Date().toISOString(),
          });
        }
      }

      logger.info("Notified users of engine recovery", {
        userCount: usersWithBots.rows.length,
      });
    } catch (error) {
      logger.error("Failed to notify users of engine recovery", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Notify users that engine failure is permanent
   */
  private async notifyUsersOfEngineFailurePermanent(): Promise<void> {
    try {
      const { query } = await import("../database/pool.js");

      const usersWithBots = await query(`
        SELECT DISTINCT bi.user_id
        FROM bot_instances bi
        WHERE bi.status IN ('RUNNING', 'STARTING', 'ERROR')
      `);

      const io = global.io;
      if (io) {
        for (const user of usersWithBots.rows) {
          io.to(`user:${user.user_id}`).emit("engine:status", {
            status: "permanent_failure",
            message: "Trading engine has failed permanently. Please contact support.",
            timestamp: new Date().toISOString(),
          });
        }
      }

      logger.error("Notified users of permanent engine failure", {
        userCount: usersWithBots.rows.length,
      });
    } catch (error) {
      logger.error("Failed to notify users of permanent engine failure", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Mark all running bots as error state
   */
  private async markAllBotsAsError(reason: string): Promise<void> {
    try {
      const { query } = await import("../database/pool.js");

      const result = await query(`
        UPDATE bot_instances
        SET status = 'ERROR', last_error = $1, updated_at = CURRENT_TIMESTAMP
        WHERE status IN ('RUNNING', 'STARTING')
      `, [reason]);

      logger.info("Marked bots as error due to engine failure", {
        affectedBots: result.rowCount,
        reason,
      });
    } catch (error) {
      logger.error("Failed to mark bots as error", {
        error: (error as Error).message,
        reason,
      });
    }
  }
}

// Export singleton instance
export const engineManager = new EngineManager();
