/** @format */

import { httpClient } from "./client";

// Request deduplication for balance API
let pendingBalanceRequest: Promise<any> | null = null;
let pendingRefreshRequest: Promise<any> | null = null;

/**
 * Balance API endpoints
 * Handles user balance operations with request deduplication
 */
export const balanceApi = {
    /**
     * Get user's current balance with deduplication
     */
    async getCurrentBalance() {
        // Return existing request if one is pending
        if (pendingBalanceRequest) {
            return pendingBalanceRequest;
        }

        // Create new request
        pendingBalanceRequest = httpClient.getClient().get("/api/balance/current");

        try {
            const result = await pendingBalanceRequest;
            return result;
        } finally {
            // Clear pending request after completion
            pendingBalanceRequest = null;
        }
    },

    /**
     * Refresh balance from external API with deduplication
     */
    async refreshBalance() {
        // Return existing request if one is pending
        if (pendingRefreshRequest) {
            return pendingRefreshRequest;
        }

        // Create new request
        pendingRefreshRequest = httpClient.getClient().post("/api/balance/refresh");

        try {
            const result = await pendingRefreshRequest;
            return result;
        } finally {
            // Clear pending request after completion
            pendingRefreshRequest = null;
        }
    },
};
