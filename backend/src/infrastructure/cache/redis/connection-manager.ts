/**
 * ===========================================
 * 🔌 REDIS CONNECTION MANAGER
 * ===========================================
 *
 * Manages Redis client lifecycle, connection health, and database selection.
 * Provides centralized connection management with health monitoring.
 *
 * RESPONSIBILITIES:
 * - Redis client connection and disconnection
 * - Database selection and management
 * - Connection health monitoring
 * - Error handling and recovery
 *
 * @format
 */

import { createClient, RedisClientType } from "redis";
import { redisLogger as logger } from "../../../core/logging/context-aware-logger.service";

export interface ConnectionConfig {
    url?: string;
    database?: number;
    retryDelay?: number;
    maxRetries?: number;
}

export interface ConnectionHealth {
    connected: boolean;
    ready: boolean;
    lastConnected?: number;
    lastError?: string;
    database?: number;
}

export class RedisConnectionManager {
    private client: RedisClientType;
    private config: Required<ConnectionConfig>;
    private health: ConnectionHealth = {
        connected: false,
        ready: false,
    };

    constructor(config: ConnectionConfig = {}) {
        this.config = {
            url: process.env.REDIS_URL || "redis://localhost:6379",
            database: 1,
            retryDelay: 1000,
            maxRetries: 3,
            ...config,
        };

        this.client = createClient({
            url: this.config.url,
        });

        this.setupEventHandlers();
    }

    /**
     * Setup Redis client event handlers
     */
    private setupEventHandlers(): void {
        this.client.on("error", (error: Error) => {
            this.health.connected = false;
            this.health.ready = false;
            this.health.lastError = error.message;

            logger.warn("Redis client error", {
                error: error.message,
                url: this.config.url,
            });
        });

        this.client.on("connect", () => {
            this.health.connected = true;
            this.health.lastConnected = Date.now();

            logger.info("Redis client connected", {
                url: this.config.url,
            });
        });

        this.client.on("ready", () => {
            this.health.ready = true;

            logger.info("Redis client ready", {
                database: this.config.database,
            });
        });

        this.client.on("end", () => {
            this.health.connected = false;
            this.health.ready = false;

            logger.warn("Redis client connection ended");
        });
    }

    /**
     * Connect to Redis with retry logic
     */
    async connect(): Promise<void> {
        if (this.client.isOpen) {
            logger.debug("Redis client already connected");
            return;
        }

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                await this.client.connect();

                // Select database after connection
                await this.selectDatabase(this.config.database);

                this.health.database = this.config.database;

                logger.info("Redis connection established", {
                    attempt,
                    database: this.config.database,
                });

                return;
            } catch (error) {
                lastError = error as Error;

                logger.error("Redis connection attempt failed", error as Error, {
                    attempt,
                    maxRetries: this.config.maxRetries,
                    error: lastError.message,
                });

                if (attempt < this.config.maxRetries) {
                    await this.sleep(this.config.retryDelay * attempt);
                }
            }
        }

        // All retries failed
        this.health.lastError = lastError?.message;
        throw new Error(`Failed to connect to Redis after ${this.config.maxRetries} attempts: ${lastError?.message}`);
    }

    /**
     * Disconnect from Redis
     */
    async disconnect(): Promise<void> {
        if (!this.client.isOpen) {
            logger.debug("Redis client already disconnected");
            return;
        }

        try {
            await this.client.disconnect();
            logger.info("Redis client disconnected");
        } catch (error) {
            logger.error("Error disconnecting Redis client", error as Error, {
                error: (error as Error).message,
            });
            throw error;
        }
    }

    /**
     * Select Redis database
     */
    async selectDatabase(database: number): Promise<void> {
        try {
            await this.client.select(database);
            this.health.database = database;

            logger.debug("Redis database selected", { database });
        } catch (error) {
            logger.error("Failed to select Redis database", error as Error, {
                database,
                error: (error as Error).message,
            });
            throw error;
        }
    }

    /**
     * Check if Redis connection is healthy
     */
    async isHealthy(): Promise<boolean> {
        if (!this.health.connected || !this.health.ready) {
            return false;
        }

        try {
            await this.client.ping();
            return true;
        } catch (error) {
            this.health.lastError = (error as Error).message;
            return false;
        }
    }

    /**
     * Get Redis client instance
     */
    getClient(): RedisClientType {
        return this.client;
    }

    /**
     * Get connection health status
     */
    getHealth(): ConnectionHealth {
        return { ...this.health };
    }

    /**
     * Get connection configuration
     */
    getConfig(): ConnectionConfig {
        return { ...this.config };
    }

    /**
     * Force reconnection
     */
    async reconnect(): Promise<void> {
        logger.info("Forcing Redis reconnection");

        try {
            await this.disconnect();
        } catch (error) {
            logger.error("Error during disconnect before reconnect", error as Error, {
                error: (error as Error).message,
            });
        }

        await this.connect();
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
