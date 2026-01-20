/**
 * ===========================================
 * 🏭 PROCESS SPAWNER - ENGINE LIFECYCLE MANAGEMENT
 * ===========================================
 *
 * Handles the core process lifecycle for the trading engine:
 * - Process spawning with proper configuration
 * - Readiness waiting and validation
 * - Graceful and force termination
 * - Process liveness checking
 *
 * This component focuses solely on process management,
 * delegating health monitoring to HealthMonitor.
 *
 * @format
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import axios from "axios";
import { logger } from "../../logging";

export interface ProcessConfig {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    timeout: number;
}

export interface ReadinessConfig {
    healthEndpoint: string;
    maxAttempts: number;
    attemptInterval: number;
    timeout: number;
}

export class ProcessSpawner {
    private engineProcess: ChildProcess | null = null;
    private enginePort: number;
    private enginePath: string;

    constructor(enginePort = 4000, enginePath?: string) {
        this.enginePort = enginePort;
        this.enginePath = enginePath || path.join(__dirname, "../../../engine/kodiak");
    }

    /**
     * Spawn the engine process with proper configuration
     */
    async spawn(config?: Partial<ProcessConfig>): Promise<ChildProcess> {
        if (this.engineProcess && !this.engineProcess.killed) {
            logger.warn("Engine process already running, returning existing process");
            return this.engineProcess;
        }

        const defaultConfig: ProcessConfig = {
            command: "npm",
            args: ["run", "dev"],
            cwd: this.enginePath,
            env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV || "development",
                PORT: this.enginePort.toString(),
            },
            timeout: 30000,
        };

        const finalConfig = { ...defaultConfig, ...config };

        logger.info("Spawning engine process", {
            command: finalConfig.command,
            args: finalConfig.args,
            cwd: finalConfig.cwd,
            port: this.enginePort,
        });

        return new Promise((resolve, reject) => {
            try {
                this.engineProcess = spawn(finalConfig.command, finalConfig.args, {
                    cwd: finalConfig.cwd,
                    stdio: ["pipe", "pipe", "pipe"],
                    env: finalConfig.env,
                });

                // Handle process events
                this.engineProcess.on("error", (error) => {
                    logger.error("Engine process spawn error", { error: error.message });
                    this.engineProcess = null;
                    reject(error);
                });

                this.engineProcess.on("exit", (code, signal) => {
                    logger.info("Engine process exited", { code, signal });
                    this.engineProcess = null;
                });

                // Log process output for debugging
                this.setupProcessLogging();

                // Resolve after initial spawn (readiness checking happens separately)
                setTimeout(() => {
                    if (this.engineProcess && !this.engineProcess.killed) {
                        resolve(this.engineProcess);
                    } else {
                        reject(new Error("Process failed to start within timeout"));
                    }
                }, 3000);

            } catch (error) {
                logger.error("Failed to spawn engine process", {
                    error: error instanceof Error ? error.message : String(error),
                });
                this.engineProcess = null;
                reject(error);
            }
        });
    }

    /**
     * Wait for the process to be ready and responding
     */
    async waitForReady(config?: Partial<ReadinessConfig>): Promise<void> {
        const defaultConfig: ReadinessConfig = {
            healthEndpoint: `http://localhost:${this.enginePort}/api/engine/health`,
            maxAttempts: 15,
            attemptInterval: 1000,
            timeout: 15000,
        };

        const finalConfig = { ...defaultConfig, ...config };

        logger.info("Waiting for engine readiness", {
            healthEndpoint: finalConfig.healthEndpoint,
            maxAttempts: finalConfig.maxAttempts,
            timeout: finalConfig.timeout,
        });

        for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
            try {
                const response = await axios.get(finalConfig.healthEndpoint, {
                    timeout: finalConfig.timeout,
                });

                if (response.data?.status === "healthy") {
                    logger.info("Engine readiness check passed", { attempt });
                    return;
                }
            } catch (error) {
                // Engine not ready yet, continue waiting
                logger.debug(`Engine not ready, attempt ${attempt}/${finalConfig.maxAttempts}`);
            }

            // Wait before next attempt
            if (attempt < finalConfig.maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, finalConfig.attemptInterval));
            }
        }

        throw new Error(`Engine failed to become ready after ${finalConfig.maxAttempts} attempts`);
    }

    /**
     * Terminate the process gracefully, with force kill fallback
     */
    async kill(signal: string = "SIGTERM", forceKillTimeout = 10000): Promise<void> {
        if (!this.engineProcess) {
            logger.debug("No engine process to kill");
            return;
        }

        logger.info("Terminating engine process", {
            pid: this.engineProcess.pid,
            signal,
            forceKillTimeout,
        });

        // Send graceful termination signal
        this.engineProcess.kill(signal as any);

        // Wait for graceful exit or force kill
        const exitPromise = new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                logger.warn("Engine did not exit gracefully, force killing", {
                    pid: this.engineProcess?.pid,
                });
                if (this.engineProcess && !this.engineProcess.killed) {
                    this.engineProcess.kill("SIGKILL");
                }
                resolve();
            }, forceKillTimeout);

            this.engineProcess?.on("exit", () => {
                clearTimeout(timeout);
                resolve();
            });
        });

        await exitPromise;
        this.engineProcess = null;

        logger.info("Engine process terminated");
    }

    /**
     * Check if the process is currently alive (OS level)
     */
    isAlive(): boolean {
        if (!this.engineProcess) return false;

        try {
            // Send signal 0 to check if process exists without actually sending a signal
            process.kill(this.engineProcess.pid!, 0 as any);
            return true;
        } catch (error) {
            // ESRCH means process doesn't exist
            return false;
        }
    }

    /**
     * Get the current process instance
     */
    getProcess(): ChildProcess | null {
        return this.engineProcess;
    }

    /**
     * Get process information for monitoring
     */
    getProcessInfo() {
        return {
            pid: this.engineProcess?.pid || null,
            killed: this.engineProcess?.killed || false,
            connected: this.engineProcess?.connected || false,
            exitCode: this.engineProcess?.exitCode || null,
            signalCode: this.engineProcess?.signalCode || null,
        };
    }

    /**
     * Setup process output logging
     */
    private setupProcessLogging(): void {
        if (!this.engineProcess) return;

        // Log stdout for debugging
        if (this.engineProcess.stdout) {
            this.engineProcess.stdout.on("data", (data) => {
                const output = data.toString().trim();
                if (output) {
                    logger.debug("Engine stdout", { output });
                }
            });
        }

        // Log stderr as warnings
        if (this.engineProcess.stderr) {
            this.engineProcess.stderr.on("data", (data) => {
                const output = data.toString().trim();
                if (output) {
                    logger.warn("Engine stderr", { output });
                }
            });
        }
    }
}
