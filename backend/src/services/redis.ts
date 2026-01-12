/** @format */

import { createClient, RedisClientType } from "redis";

class RedisService {
  private client: RedisClientType;
  private static instance: RedisService;

  private constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });

    this.client.on("error", (err) => {
      console.error("❌ Redis Client Error:", err);
    });

    this.client.on("connect", () => {
      console.log("✅ Redis Client Connected");
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
      console.error("Redis GET error:", error);
      return null;
    }
  }

  public async set(key: string, value: string): Promise<void> {
    try {
      await this.client.set(key, value);
    } catch (error) {
      console.error("Redis SET error:", error);
    }
  }

  public async setex(key: string, ttl: number, value: string): Promise<void> {
    try {
      await this.client.setEx(key, ttl, value);
    } catch (error) {
      console.error("Redis SETEX error:", error);
    }
  }

  public async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error("Redis DEL error:", error);
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error("Redis EXISTS error:", error);
      return false;
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }
}

export const redisService = RedisService.getInstance();
