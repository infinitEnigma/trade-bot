/** @format */

import { httpClient } from "./client";
import { globalRequestManager } from "../../lib/global-request-manager";

/**
 * Balance API endpoints
 * Handles user balance operations with global deduplication
 */
export const balanceApi = {
    /**
     * Get user's current balance with global deduplication
     */
    async getCurrentBalance() {
        return globalRequestManager.deduplicateRequest(
            "balance:current",
            () => httpClient.getClient().get("/api/balance/current").then(r => r.data),
            "balanceApi"
        );
    },

    /**
     * Refresh balance from external API with global deduplication
     */
    async refreshBalance() {
        return globalRequestManager.deduplicateRequest(
            "balance:refresh",
            () => httpClient.getClient().post("/api/balance/refresh").then(r => r.data),
            "balanceApi"
        );
    },
};
