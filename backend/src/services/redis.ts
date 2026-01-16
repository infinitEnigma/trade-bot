/** @format */

import { createClient, RedisClientType } from "redis";
import logger from "./logger";

class RedisService {
  private client: RedisClientType;
  private static instance: RedisService;

  private constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
      database: 1, // Use database 1 (was likely used in Docker setup)
    });

    this.client.on("error", (err) => {
      logger.error("Redis Client Error", { error: err.message });
    });

    this.client.on("connect", () => {
      logger.info("Redis Client Connected");
    });
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      // Explicitly select database 1 after connecting
      await this.client.select(1);
      logger.info("Redis database 1 selected");
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }

  public async get(key: string): Promise<{ success: boolean; data: string | null; error?: string }> {
    try {
      const data = await this.client.get(key);
      return { success: true, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Redis GET error", { key, error: errorMessage });
      return { success: false, data: null, error: errorMessage };
    }
  }

  public async set(key: string, value: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.set(key, value);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Redis SET error", { key, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  public async setex(key: string, ttl: number, value: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Use multi command to ensure atomicity
      const multi = this.client.multi();
      multi.set(key, value);
      multi.pExpire(key, ttl * 1000); // pExpire uses milliseconds
      await multi.exec();
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Redis SETEX error", { key, ttl, error: errorMessage });
      // Fallback to individual commands
      try {
        await this.client.set(key, value);
        await this.client.pExpire(key, ttl * 1000);
        logger.info("Redis SETEX fallback successful", { key, ttl });
        return { success: true };
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logger.error("Redis SETEX fallback error", { key, ttl, error: fallbackErrorMessage });
        return { success: false, error: fallbackErrorMessage };
      }
    }
  }

  public async del(key: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.client.del(key);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Redis DEL error", { key, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  public async exists(key: string): Promise<{ success: boolean; data: boolean; error?: string }> {
    try {
      const result = await this.client.exists(key);
      return { success: true, data: result === 1 };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Redis EXISTS error", { key, error: errorMessage });
      return { success: false, data: false, error: errorMessage };
    }
  }

  /**
   * Check if Redis is currently healthy
   */
  public async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }
}

export const redisService = RedisService.getInstance();
