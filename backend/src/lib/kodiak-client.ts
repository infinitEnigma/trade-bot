/**
 * Kodiak API Client
 *
 * Pure API client for Kodiak exchange integration. Handles signature generation,
 * request/response processing, and authentication. No business logic here.
 */

import logger from "../services/logger";

export interface KodiakCredentials {
    accountId: string;
    apiKey: string;
    secretKey: string;
}

export interface KodiakApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    statusCode?: number;
}

export interface KodiakApiConfig {
    baseUrl?: string;
    timeout?: number;
    retryAttempts?: number;
}

/**
 * Kodiak API Client
 */
export class KodiakClient {
    private readonly config: Required<KodiakApiConfig>;

    constructor(config: KodiakApiConfig = {}) {
        this.config = {
            baseUrl: config.baseUrl || process.env.KODIAK_API_URL || "https://api.orderly.org",
            timeout: config.timeout || 30000, // 30 seconds
            retryAttempts: config.retryAttempts || 3,
        };
    }

    /**
     * Make authenticated GET request to Kodiak API
     */
    async get<T = any>(path: string, credentials: KodiakCredentials): Promise<KodiakApiResponse<T>> {
        return this.request<T>("GET", path, credentials);
    }

    /**
     * Make authenticated POST request to Kodiak API
     */
    async post<T = any>(path: string, credentials: KodiakCredentials, body?: any): Promise<KodiakApiResponse<T>> {
        return this.request<T>("POST", path, credentials, body);
    }

    /**
     * Make authenticated PUT request to Kodiak API
     */
    async put<T = any>(path: string, credentials: KodiakCredentials, body?: any): Promise<KodiakApiResponse<T>> {
        return this.request<T>("PUT", path, credentials, body);
    }

    /**
     * Make authenticated DELETE request to Kodiak API
     */
    async delete<T = any>(path: string, credentials: KodiakCredentials): Promise<KodiakApiResponse<T>> {
        return this.request<T>("DELETE", path, credentials);
    }

    /**
     * Core request method with authentication
     */
    private async request<T = any>(
        method: string,
        path: string,
        credentials: KodiakCredentials,
        body?: any
    ): Promise<KodiakApiResponse<T>> {
        const url = this.buildUrl(path);
        const timestamp = Date.now();

        try {
            // Generate signature
            const signaturePath = path.startsWith("/v1/") ? path : `/v1${path}`;
            const bodyStr = body ? JSON.stringify(body) : "";
            const message = `${timestamp}${method.toUpperCase()}${signaturePath}${bodyStr}`;
            const signature = await this.generateSignature(message, credentials.secretKey);

            // Build headers
            const headers: Record<string, string> = {
                "Content-Type": method === "GET" ? "application/x-www-form-urlencoded" : "application/json",
                "orderly-account-id": credentials.accountId,
                "orderly-key": credentials.apiKey,
                "orderly-signature": signature,
                "orderly-timestamp": timestamp.toString(),
            };

            logger.debug("Making Kodiak API request", {
                method,
                url,
                accountId: credentials.accountId,
                hasBody: !!bodyStr,
            });

            // Build request options
            const requestOptions: RequestInit = {
                method: method.toUpperCase(),
                headers,
                signal: AbortSignal.timeout(this.config.timeout),
            };

            if (method.toUpperCase() !== "GET" && bodyStr) {
                requestOptions.body = bodyStr;
            }

            // Make request with retry logic
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
                try {
                    const response = await fetch(url, requestOptions);

                    logger.debug("Kodiak API response received", {
                        status: response.status,
                        statusText: response.statusText,
                        attempt,
                    });

                    // Handle non-2xx responses
                    if (!response.ok) {
                        const errorText = await response.text();

                        // Don't retry on client errors (4xx)
                        if (response.status >= 400 && response.status < 500) {
                            return this.handleApiError(response.status, errorText);
                        }

                        // Retry on server errors (5xx) or network issues
                        lastError = new Error(`HTTP ${response.status}: ${errorText}`);
                        if (attempt === this.config.retryAttempts) {
                            break;
                        }

                        // Exponential backoff
                        await this.delay(Math.pow(2, attempt) * 1000);
                        continue;
                    }

                    // Parse successful response
                    const responseData = await response.json();
                    return this.handleApiSuccess<T>(responseData);

                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt === this.config.retryAttempts) {
                        break;
                    }

                    // Retry on network errors
                    await this.delay(Math.pow(2, attempt) * 1000);
                }
            }

            // All retries failed
            logger.error("Kodiak API request failed after retries", {
                method,
                url,
                attempts: this.config.retryAttempts,
                lastError: lastError?.message,
            });

            return {
                success: false,
                error: `Request failed after ${this.config.retryAttempts} attempts: ${lastError?.message}`,
            };

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            logger.error("Kodiak API request error", {
                method,
                url,
                error: err.message,
            });

            return {
                success: false,
                error: `Request error: ${err.message}`,
            };
        }
    }

    /**
     * Generate Ed25519 signature for Kodiak API authentication
     */
    private async generateSignature(message: string, secretKey: string): Promise<string> {
        try {
            // Configure @noble/ed25519 hash functions BEFORE any usage
            const { createHash } = await import("crypto");
            const { default: bs58 } = await import("bs58");
            const ed25519 = await import("@noble/ed25519");

            const sha512Hash = (message: Uint8Array) => {
                const hash = createHash("sha512");
                hash.update(message);
                return new Uint8Array(hash.digest());
            };

            // Set hash function
            if ((ed25519 as any).hashes) {
                (ed25519 as any).hashes.sha512 = sha512Hash;
            } else if ((ed25519 as any).etc && typeof (ed25519 as any).etc.sha512Sync !== "undefined") {
                (ed25519 as any).etc.sha512Sync = sha512Hash;
            } else if ((ed25519 as any).utils) {
                (ed25519 as any).utils.sha512Sync = sha512Hash;
            }

            const privateKey = bs58.decode(secretKey);
            const messageBytes = new TextEncoder().encode(message);
            const signature = await ed25519.sign(messageBytes, privateKey);

            return Buffer.from(signature).toString("base64url");
        } catch (error) {
            logger.error("Failed to generate Kodiak signature", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Build full URL from path
     */
    private buildUrl(path: string): string {
        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        return `${this.config.baseUrl}${cleanPath}`;
    }

    /**
     * Handle successful API response
     */
    private handleApiSuccess<T>(data: any): KodiakApiResponse<T> {
        // Kodiak API typically wraps successful responses
        if (data && typeof data === "object" && "success" in data) {
            if (data.success) {
                return {
                    success: true,
                    data: data.data || data,
                };
            } else {
                return {
                    success: false,
                    error: data.message || data.error || "API returned success: false",
                };
            }
        }

        // Assume success if no explicit success field
        return {
            success: true,
            data,
        };
    }

    /**
     * Handle API error responses
     */
    private handleApiError(statusCode: number, errorText: string): KodiakApiResponse {
        let errorMessage = `HTTP ${statusCode}`;

        try {
            const errorData = JSON.parse(errorText);
            if (errorData.message) {
                errorMessage = errorData.message;
            } else if (errorData.error) {
                errorMessage = errorData.error;
            }
        } catch {
            // Use raw error text if not JSON
            if (errorText) {
                errorMessage = errorText;
            }
        }

        return {
            success: false,
            error: errorMessage,
            statusCode,
        };
    }

    /**
     * Utility delay function for retry backoff
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Test API connectivity
     */
    async testConnectivity(credentials: KodiakCredentials): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await this.get("/client/info", credentials);

            if (response.success) {
                logger.info("Kodiak API connectivity test successful", {
                    accountId: credentials.accountId,
                });
                return { success: true };
            } else {
                logger.warn("Kodiak API connectivity test failed", {
                    accountId: credentials.accountId,
                    error: response.error,
                });
                return { success: false, error: response.error };
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.warn("Kodiak API connectivity test error", {
                accountId: credentials.accountId,
                error: err.message,
            });
            return {
                success: false,
                error: err.message,
            };
        }
    }
}

// Export singleton instance
export const kodiakClient = new KodiakClient();
