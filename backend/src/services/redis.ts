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

  public async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error("Redis GET error", { key, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  public async set(key: string, value: string): Promise<void> {
    try {
      await this.client.set(key, value);
    } catch (error) {
      logger.error("Redis SET error", { key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  public async setex(key: string, ttl: number, value: string): Promise<void> {
    try {
      // Use multi command to ensure atomicity
      const multi = this.client.multi();
      multi.set(key, value);
      multi.pExpire(key, ttl * 1000); // pExpire uses milliseconds
      await multi.exec();
      // logger.debug(`Redis SETEX: ${key} stored for ${ttl}s`);
    } catch (error) {
      logger.error("Redis SETEX error", { key, ttl, error: error instanceof Error ? error.message : String(error) });
      // Fallback to individual commands
      try {
        await this.client.set(key, value);
        await this.client.pExpire(key, ttl * 1000);
        logger.info("Redis SETEX fallback successful", { key, ttl });
      } catch (fallbackError) {
        logger.error("Redis SETEX fallback error", { key, ttl, error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
      }
    }
  }

  public async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error("Redis DEL error", { key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error("Redis EXISTS error", { key, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }
}

export const redisService = RedisService.getInstance();
