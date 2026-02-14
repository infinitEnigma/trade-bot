/** @format */

import { httpClient } from "./client";
import { globalRequestManager } from "../request-manager";

interface ApiError extends Error {
    response?: {
        status?: number;
    };
}

/**
 * Trading API endpoints
 * Handles strategies, bots, and trading operations with global deduplication
 */
export const tradingApi = {
    // Strategy endpoints
    async getStrategies() {
        return globalRequestManager.deduplicateRequest(
            "strategies:list",
            () => httpClient.getClient().get("/api/strategies").then(r => r.data),
            "tradingApi"
        );
    },

    async createStrategy(data: {
        name: string;
        type: string;
        config: Record<string, unknown>;
    }) {
        const response = await httpClient.getClient().post("/api/strategies", data);
        return response.data;
    },

    async updateStrategy(
        strategyId: string,
        data: {
            name: string;
            type: string;
            config: Record<string, unknown>;
        }
    ) {
        const response = await httpClient.getClient().put(
            `/api/strategies/${strategyId}`,
            data
        );
        return response.data;
    },

    async deleteStrategy(strategyId: string) {
        const response = await httpClient.getClient().delete(`/api/strategies/${strategyId}`);
        return response.data;
    },

    // Bot endpoints
    async getBotInstances() {
        return globalRequestManager.deduplicateRequest(
            "bots:instances",
            () => httpClient.getClient().get("/api/bot/instances").then(r => r.data),
            "tradingApi"
        );
    },

    async getEngineStatus() {
        return globalRequestManager.deduplicateRequest(
            "bots:engine-status",
            () => httpClient.getClient().get("/api/bot/engine/status").then(r => r.data),
            "tradingApi"
        );
    },

    async startBot(strategyId: string) {
        const response = await httpClient.getClient().post("/api/bot/start", { strategyId });
        return response.data;
    },

    async stopBot(botId: string) {
        const response = await httpClient.getClient().post("/api/bot/stop", { botId });
        return response.data;
    },

    async emergencyStop(botId: string) {
        const response = await httpClient.getClient().post("/api/bot/emergency-stop", {
            botId,
        });
        return response.data;
    },

    // Kodiak exchange integration endpoints with global deduplication
    async getKodiakPositions() {
        return globalRequestManager.deduplicateRequest(
            "kodiak:positions",
            async () => {
                try {
                    const response = await httpClient.getClient().get("/api/user/kodiak/positions");
                    return response.data;
                } catch (error: unknown) {
                    // Return empty data instead of throwing for missing credentials
                    const apiError = error as ApiError;
                    if (apiError.response?.status === 403 || apiError.response?.status === 400) {
                        return {
                            success: true,
                            data: { rows: [] },
                            message: "Kodiak account not connected",
                        };
                    }
                    throw error;
                }
            },
            "tradingApi"
        );
    },

    async getKodiakTrades(limit = 50) {
        return globalRequestManager.deduplicateRequest(
            `kodiak:trades:${limit}`,
            async () => {
                try {
                    const response = await httpClient.getClient().get(`/api/user/kodiak/trades?limit=${limit}`);
                    return response.data;
                } catch (error: unknown) {
                    // Return empty data instead of throwing for missing credentials
                    const apiError = error as ApiError;
                    if (apiError.response?.status === 403 || apiError.response?.status === 400) {
                        return {
                            success: true,
                            data: { rows: [] },
                            message: "Kodiak account not connected",
                        };
                    }
                    throw error;
                }
            },
            "tradingApi"
        );
    },

    async getKodiakBalance() {
        return globalRequestManager.deduplicateRequest(
            "kodiak:balance",
            async () => {
                try {
                    const response = await httpClient.getClient().get("/api/user/kodiak/balance");
                    return response.data;
                } catch (error: unknown) {
                    // Return empty data instead of throwing for missing credentials
                    const apiError = error as ApiError;
                    if (apiError.response?.status === 403 || apiError.response?.status === 400) {
                        return {
                            success: true,
                            data: null,
                            message: "Kodiak account not connected",
                        };
                    }
                    throw error;
                }
            },
            "tradingApi"
        );
    },

};
