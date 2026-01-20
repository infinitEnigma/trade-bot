/** @format */

import { httpClient } from "./client";

/**
 * Balance API endpoints
 * Handles user balance operations
 */
export const balanceApi = {
    /**
     * Get user's current balance
     */
    async getCurrentBalance() {
        const response = await httpClient.getClient().get("/api/balance/current");
        return response.data;
    },

    /**
     * Refresh balance from external API
     */
    async refreshBalance() {
        const response = await httpClient.getClient().post("/api/balance/refresh");
        return response.data;
    },
};
