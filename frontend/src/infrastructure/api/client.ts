/** @format */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL;
console.log("API_BASE_URL:", API_BASE_URL);

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
            response => response,
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
                    window.dispatchEvent(new CustomEvent("auth:logout"));
                    window.location.href = "/login";
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

                    window.dispatchEvent(new CustomEvent("auth:logout"));
                    window.location.href = "/login";
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
                    window.dispatchEvent(new CustomEvent("auth:logout"));
                    window.location.href = "/login";
                }

                return Promise.reject(error);
            }
        );
    }
}

export const httpClient = HttpClient.getInstance();
