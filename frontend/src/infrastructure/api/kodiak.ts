/** @format */

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
 * Kodiak API Service
 * Handles Kodiak trading platform integration
 */
class KodiakApi {
    /**
     * Connect Kodiak credentials
     * Frontend sends encrypted credentials to backend for validation and storage
     */
    async connectKodiak(credentials: KodiakCredentials): Promise<any> {
        return httpClient.getClient().post('/api/user/kodiak/connect', credentials);
    }

    /**
     * Disconnect Kodiak credentials
     * Backend handles credential removal and user level downgrade
     */
    async disconnectKodiak(): Promise<any> {
        return httpClient.getClient().post('/api/user/kodiak/disconnect');
    }

    /**
     * Get Kodiak connection status
     * Backend returns encrypted status information
     */
    async getKodiakStatus(): Promise<any> {
        return httpClient.getClient().get('/api/user/kodiak/status');
    }

    /**
     * Get Kodiak account balance
     */
    async getKodiakBalance(): Promise<any> {
        return httpClient.getClient().get('/api/user/kodiak/balance');
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
