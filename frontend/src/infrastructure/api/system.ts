/** @format */

import { httpClient } from "./client";
import type { SystemHealthResponse } from "@trade-bot/shared";

/**
 * System API endpoints - For admin and system management
 */
export const systemApi = {
    /**
     * Get system health status
     */
    async getSystemHealth(): Promise<SystemHealthResponse> {
        const response = await httpClient.getClient().get("/api/system/health/detailed");
        return response.data;
    },

    /**
     * Get system metrics
     */
    async getSystemMetrics(): Promise<any> {
        const response = await httpClient.getClient().get("/api/system/metrics");
        return response.data;
    },

    /**
     * Get service status and migration progress
     */
    async getServiceStatus(): Promise<any> {
        const response = await httpClient.getClient().get("/api/system/health/services");
        return response.data;
    },

    /**
     * Get database metrics
     */
    async getDatabaseMetrics(): Promise<any> {
        const response = await httpClient.getClient().get("/api/system/metrics/database");
        return response.data;
    },

    /**
     * Get rate limit statistics
     */
    async getRateLimitStats(): Promise<any> {
        const response = await httpClient.getClient().get("/api/system/ratelimit");
        return response.data;
    },

    /**
     * Get security and encryption status
     */
    async getSecurityStatus(): Promise<any> {
        const response = await httpClient.getClient().get("/api/system/health/encryption");
        return response.data;
    },

    /**
     * Get external API health status
     */
    async getExternalApiHealth(): Promise<any> {
        const response = await httpClient.getClient().get("/api/system/health/external");
        return response.data;
    }
};