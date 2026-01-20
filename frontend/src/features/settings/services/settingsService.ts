/** @format */

import { kodiakApi } from "../../../infrastructure/api";
import { KodiakCredentials, KodiakStatus } from "../types/settings.types";

/**
 * Settings Service
 * Handles Kodiak connection/disconnection and account settings
 */
export class SettingsService {
    private static instance: SettingsService;

    private constructor() { }

    public static getInstance(): SettingsService {
        if (!SettingsService.instance) {
            SettingsService.instance = new SettingsService();
        }
        return SettingsService.instance;
    }

    /**
     * Connect Kodiak credentials
     * Sends encrypted credentials to backend for validation and storage
     */
    async connectKodiak(credentials: KodiakCredentials): Promise<any> {
        try {
            const response = await kodiakApi.connectKodiak(credentials);
            return response;
        } catch (error) {
            console.error("Settings service connectKodiak error:", error);
            throw error;
        }
    }

    /**
     * Disconnect Kodiak credentials
     * Backend handles secure credential removal and user level updates
     */
    async disconnectKodiak(): Promise<any> {
        try {
            const response = await kodiakApi.disconnectKodiak();
            return response;
        } catch (error) {
            console.error("Settings service disconnectKodiak error:", error);
            throw error;
        }
    }

    /**
     * Get Kodiak status
     * Backend returns encrypted status information
     */
    async getKodiakStatus(): Promise<KodiakStatus> {
        try {
            const response = await kodiakApi.getKodiakStatus();
            if (response.data?.success) {
                return {
                    connected: response.data?.connected || false,
                    accountId: response.data?.accountId,
                    connectedAt: response.data?.connectedAt,
                    verified: response.data?.verified,
                };
            }
            return { connected: false };
        } catch (error) {
            console.error("Settings service getKodiakStatus error:", error);
            return { connected: false };
        }
    }

    /**
     * Validate Kodiak credentials format
     */
    validateCredentials(credentials: KodiakCredentials): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];

        if (!credentials.accountId || credentials.accountId.trim().length === 0) {
            errors.push("Account ID is required");
        }

        if (!credentials.apiKey || credentials.apiKey.trim().length === 0) {
            errors.push("API Key is required");
        }

        if (!credentials.secretKey || credentials.secretKey.trim().length === 0) {
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

    /**
     * Get security information
     */
    getSecurityInfo(): string[] {
        return [
            "Your Kodiak API credentials are encrypted using AES-256 encryption before storage",
            "Credentials are only decrypted in memory when needed for API calls",
            "All credential operations are logged for security auditing",
            "You can disconnect your credentials at any time",
        ];
    }
}

export const settingsService = SettingsService.getInstance();
