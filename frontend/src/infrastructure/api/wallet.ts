/** @format */

import { httpClient } from "./client";

/**
 * Wallet API endpoints
 * Handles wallet verification and related operations
 */
export const walletApi = {
    /**
     * Verify wallet ownership by signing a message
     * (BASIC -> REGISTERED upgrade step)
     */
    async verifyWallet(data: {
        walletAddress: string;
        signature: string;
        message: string;
    }) {
        const response = await httpClient.getClient().post("/api/user/verify-wallet", data);
        return response.data;
    },

    /**
     * Unlink the wallet from the account (explicit, audited downgrade).
     * REGISTERED -> BASIC; VERIFIED -> REGISTERED (or BASIC if Kodiak gone).
     * Note: a plain wallet "Disconnect" in the UI is local-only and does
     * NOT call this endpoint.
     */
    async unlinkWallet() {
        const response = await httpClient.getClient().post("/api/user/unlink-wallet");
        return response.data;
    },
};