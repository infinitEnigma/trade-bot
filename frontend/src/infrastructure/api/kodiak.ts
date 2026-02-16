/** @format */

//import { ApiError } from "@trade-bot/shared";
import { globalRequestManager } from "../request-manager";
import { httpClient } from "./client";

export interface KodiakCredentials {
    accountId: string;
    apiKey: string;
    secretKey: string;
}

export interface KodiakStatus {
    connected: boolean;
    accountId?: string;
    connectedAt?: string;
    verified?: boolean;
    userLevel?: string;
}

/**
 * Kodiak API Response Interfaces
 * Match backend API response structure
 */
export interface KodiakConnectResponse {
    success: boolean;
    message?: string;
    data?: {
        accountId: string;
        connected: boolean;
        verified: boolean;
        userLevel?: string;
    };
    error?: string;
}

export interface KodiakDisconnectResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface KodiakBalanceResponse {
    success: boolean;
    data?: {
        totalBalance: string;
        availableBalance: string;
        lockedBalance: string;
        currency: string;
        assets?: Array<{
            asset: string;
            free: string;
            locked: string;
        }>;
    };
    error?: string;
}

interface ApiError extends Error {
    response?: {
        status?: number;
    };
}

/**
 * Kodiak API Service
 * Handles Kodiak trading platform integration
 */
class KodiakApi {
    /**
     * Connect Kodiak credentials
     * Frontend sends encrypted credentials to backend for validation and storage
     */
    async connectKodiak(credentials: KodiakCredentials): Promise<KodiakConnectResponse> {
        const response = await httpClient.getClient().post('/api/user/kodiak/connect', credentials);
        return response.data;
    }

    /**
     * Disconnect Kodiak credentials
     * Backend handles credential removal and user level downgrade
     */
    async disconnectKodiak(): Promise<KodiakDisconnectResponse> {
        const response = await httpClient.getClient().delete('/api/user/kodiak/disconnect');
        return response.data;
    }

    /**
     * Get Kodiak connection status
     * Backend returns encrypted status information
     */
    async getKodiakStatus(): Promise<{ success: boolean; data?: KodiakStatus; error?: string }> {
        const response = await httpClient.getClient().get('/api/user/kodiak/status');
        return response.data;
    }

    /**
     * Get Kodiak account balance
     
    async getKodiakBalance(): Promise<{ success: boolean; data?: KodiakBalanceResponse; error?: string }> {
        const response = await httpClient.getClient().get('/api/user/kodiak/balance');
        return response.data;
    }*/
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
    }

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
    }

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
    }

    /**
     * Validate Kodiak credentials format
     */
    validateCredentialsFormat(credentials: KodiakCredentials): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];

        if (!credentials.accountId?.trim()) {
            errors.push("Account ID is required");
        }

        if (!credentials.apiKey?.trim()) {
            errors.push("API Key is required");
        }

        if (!credentials.secretKey?.trim()) {
            errors.push("Secret Key is required");
        }

        // Basic format validation
        if (credentials.accountId && !/^[a-zA-Z0-9_-]+$/.test(credentials.accountId)) {
            errors.push("Account ID contains invalid characters");
        }

        if (credentials.apiKey && credentials.apiKey.length < 10) {
            errors.push("API Key appears to be too short");
        }

        if (credentials.secretKey && credentials.secretKey.length < 10) {
            errors.push("Secret Key appears to be too short");
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }
}

export const kodiakApi = new KodiakApi();
