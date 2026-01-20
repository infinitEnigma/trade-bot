/** @format */

import { httpClient } from "./client";

/**
 * Trading API endpoints
 * Handles strategies, bots, and trading operations
 */
export const tradingApi = {
    // Strategy endpoints
    async getStrategies() {
        const response = await httpClient.getClient().get("/api/strategies");
        return response.data;
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
        const response = await httpClient.getClient().get("/api/bot/instances");
        return response.data;
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
};
