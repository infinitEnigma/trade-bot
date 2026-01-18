/** @format */

import { spawn, ChildProcess } from "child_process";
import axios, { AxiosRequestConfig } from "axios";
import path from "path";
import logger from "./logger";

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
}

// Export singleton instance
export const engineManager = new EngineManager();
