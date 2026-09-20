/** @format */

import { httpClient } from "./client";
import type { SystemHealthResponse } from "@trade-bot/shared";

/** Performance metrics payload of `GET /api/system/metrics`. */
export interface SystemMetrics {
  cpu: number;
  memory: number;
  disk: number;
}

/** One service entry in `GET /api/system/health/services`. */
export interface ServiceStatusEntry {
  implementation: string;
  status?: string;
}

/** Service inventory + migration progress for the admin dashboard. */
export interface ServiceStatusResponse {
  services: Record<string, ServiceStatusEntry>;
  summary: {
    pureServicesEnabled: number;
    totalServices: number;
    migrationProgress: number;
  };
}

/** Payload of `GET /api/system/metrics/database`. */
export interface DatabaseMetrics {
  connections: number;
  queriesPerSecond: number;
  cacheHitRate: number;
}

/** Payload of `GET /api/system/ratelimit`. */
export interface RateLimitStats {
  limit: number;
  remaining: number;
  reset: number;
}

/** Payload of `GET /api/system/health/encryption`. */
export interface SecurityStatus {
  encryption: string;
  ssl: string;
  vulnerabilities: string[];
}

/** Payload of `GET /api/system/health/external` (service → status map). */
export type ExternalApiHealth = Record<string, string>;

/**
 * System API endpoints - For admin and system management
 */
export const systemApi = {
  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<SystemHealthResponse> {
    const response = await httpClient
      .getClient()
      .get("/api/system/health/detailed");
    return response.data;
  },

  /**
   * Get system metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    const response = await httpClient.getClient().get("/api/system/metrics");
    return response.data;
  },

  /**
   * Get service status and migration progress
   */
  async getServiceStatus(): Promise<ServiceStatusResponse> {
    const response = await httpClient
      .getClient()
      .get("/api/system/health/services");
    return response.data;
  },

  /**
   * Get database metrics
   */
  async getDatabaseMetrics(): Promise<DatabaseMetrics> {
    const response = await httpClient
      .getClient()
      .get("/api/system/metrics/database");
    return response.data;
  },

  /**
   * Get rate limit statistics
   */
  async getRateLimitStats(): Promise<RateLimitStats> {
    const response = await httpClient.getClient().get("/api/system/ratelimit");
    return response.data;
  },

  /**
   * Get security and encryption status
   */
  async getSecurityStatus(): Promise<SecurityStatus> {
    const response = await httpClient
      .getClient()
      .get("/api/system/health/encryption");
    return response.data;
  },

  /**
   * Get external API health status
   */
  async getExternalApiHealth(): Promise<ExternalApiHealth> {
    const response = await httpClient
      .getClient()
      .get("/api/system/health/external");
    return response.data;
  },
};
