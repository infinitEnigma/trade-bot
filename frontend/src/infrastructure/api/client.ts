/** @format */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL;
console.log("API_BASE_URL:", API_BASE_URL);

/**
 * Force a clean re-authentication: drop the persisted auth store (zustand
 * persist would otherwise rehydrate a stale user after the redirect) and
 * send the user to /login.
 *
 * Triggered when the backend reports a definitively-dead session
 * (401 + code -1002 = refresh token invalid/legacy, retrying is futile).
 */
const forceReauthentication = (reason: string): void => {
    console.warn("Forcing re-authentication:", reason);
    // Notify any in-app listeners BEFORE navigating (they may flush state)
    window.dispatchEvent(new CustomEvent("auth:session-expired"));
    // Clear the persisted zustand auth store so /login doesn't rehydrate
    // a stale "authenticated" user (root cause of the wallet-signing bug
    // where the settings page reloaded still showing BASIC).
    localStorage.removeItem("auth-storage");
    window.dispatchEvent(new CustomEvent("auth:logout"));
    if (window.location.pathname !== "/login") {
        window.location.href = "/login";
    }
};

/**
 * Base HTTP client for API communication
 * Handles authentication, error handling, and request/response interceptors
 */
class HttpClient {
    private client: AxiosInstance;
    private static instance: HttpClient;

    private constructor() {
        console.log("Creating HTTP client with baseURL:", API_BASE_URL);
        this.client = axios.create({
            baseURL: API_BASE_URL,
            withCredentials: true, // Required for sending cookies
            headers: {
                "Content-Type": "application/json",
            },
        });

        this.setupRequestInterceptors();
        this.setupResponseInterceptors();
    }

    public static getInstance(): HttpClient {
        if (!HttpClient.instance) {
            HttpClient.instance = new HttpClient();
        }
        return HttpClient.instance;
    }

    public getClient(): AxiosInstance {
        return this.client;
    }

    private setupRequestInterceptors() {
        this.client.interceptors.request.use(
            (config: InternalAxiosRequestConfig) => {
                console.log("Sending request to:", config.url);
                console.log(
                    "Using cookie-based authentication - no manual token needed"
                );
                return config;
            },
            error => Promise.reject(error)
        );
    }

    private setupResponseInterceptors() {
        this.client.interceptors.response.use(
            response => {
                // Ensure all responses follow ApiResponse format
                if (response.data && typeof response.data === 'object') {
                    // If response doesn't have success field, wrap it in ApiResponse format
                    if (!('success' in response.data)) {
                        response.data = {
                            success: true,
                            data: response.data
                        };
                    }
                }
                return response;
            },
            async error => {
                // Handle 429 (Too Many Requests) - Rate limiting
                if (error.response?.status === 429) {
                    const retryAfter = error.response.data?.retryAfter || 60;
                    console.warn(
                        `Rate limited: Too many requests. Retry after ${retryAfter} seconds.`,
                        {
                            endpoint: error.config?.url,
                            retryAfter,
                            limit: error.response.headers?.["ratelimit-limit"],
                            remaining: error.response.headers?.["ratelimit-remaining"],
                            reset: error.response.headers?.["ratelimit-reset"],
                        }
                    );

                    return Promise.reject({
                        ...error,
                        message: `Rate limited. Please wait ${retryAfter} seconds before retrying.`,
                        retryAfter,
                    });
                }

                const originalRequest = error.config;

                // Handle connection errors (server unreachable)
                if (!error.response && error.code === "ERR_NETWORK") {
                    console.error("Server connection failed - redirecting to login");
                    forceReauthentication("network error");
                    return Promise.reject(error);
                }

                // Definitive session death: 401 + code -1002 means the refresh
                // token is invalid/legacy (backend already cleared the session
                // cookies). Retrying or refreshing the page cannot help — clear
                // auth state and force a clean re-login. Applies to ALL
                // endpoints (the old code only redirected on auth/profile 401s,
                // which is how verify-wallet 401s got silently swallowed).
                const isLoginRequest = originalRequest.url?.includes("/api/auth/login");
                if (
                    error.response?.status === 401 &&
                    error.response.data?.code === -1002 &&
                    !isLoginRequest
                ) {
                    forceReauthentication("session definitively expired (-1002)");
                    return Promise.reject(error);
                }

                // Handle 401 (unauthorized) - token might be expired
                const isAuthEndpoint = originalRequest.url?.includes("/api/auth/");
                const isUserProfileEndpoint =
                    originalRequest.url?.includes("/api/user/profile");

                if (
                    error.response?.status === 401 &&
                    !originalRequest._retry &&
                    (isAuthEndpoint || isUserProfileEndpoint)
                ) {
                    console.log(
                        "Received 401 on auth endpoint - redirecting to login (authentication required)",
                        {
                            url: originalRequest.url,
                            status: error.response.status,
                        }
                    );
                    originalRequest._retry = true;

                    forceReauthentication("401 on auth endpoint");
                    return Promise.reject(error);
                }

                // For other 401 errors (market data, external APIs), don't redirect
                if (error.response?.status === 401) {
                    console.log(
                        "Received 401 on non-auth endpoint - not redirecting (may be external API)",
                        {
                            url: originalRequest.url,
                            status: error.response.status,
                        }
                    );
                    return Promise.reject(error);
                }

                // Handle 403 (forbidden) - user doesn't have permission
                if (error.response?.status === 403) {
                    console.error("Received 403 - insufficient permissions");
                    return Promise.reject(error);
                }

                // Handle 500+ server errors for auth endpoints
                if (
                    error.response?.status >= 500 &&
                    (isAuthEndpoint || isUserProfileEndpoint)
                ) {
                    console.error("Auth system server error - redirecting to login");
                    forceReauthentication("auth server error");
                }

                return Promise.reject(error);
            }
        );
    }
}

export const httpClient = HttpClient.getInstance();
