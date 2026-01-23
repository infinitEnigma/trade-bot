/** @format */

import { httpClient } from "./client";

/**
 * Wallet API endpoints
 * Handles wallet verification and related operations
 */
export const walletApi = {
    /**
     * Verify wallet ownership by signing a message
     */
    async verifyWallet(data: {
        walletAddress: string;
        signature: string;
        message: string;
    }) {
        const response = await httpClient.getClient().post("/api/user/verify-wallet", data);
        return response.data;
    },
};