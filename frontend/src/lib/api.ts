/** @format */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
console.log("API_BASE_URL:", API_BASE_URL);

class ApiClient {
  private client: AxiosInstance;
  private static instance: ApiClient;

  private constructor() {
    console.log("Creating API client with baseURL:", API_BASE_URL);
    this.client = axios.create({
      baseURL: API_BASE_URL,
      withCredentials: true, // Required for sending cookies
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Request interceptor - cookies are sent automatically
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        console.log("Sending request to:", config.url);
        console.log("Using cookie-based authentication - no manual token needed");

        // Cookies are automatically included with credentials: 'include'
        // No need to manually add Authorization header
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        // Handle 429 (Too Many Requests) - Rate limiting
        if (error.response?.status === 429) {
          const retryAfter = error.response.data?.retryAfter || 60;
          console.warn(`Rate limited: Too many requests. Retry after ${retryAfter} seconds.`, {
            endpoint: error.config?.url,
            retryAfter,
            limit: error.response.headers?.['ratelimit-limit'],
            remaining: error.response.headers?.['ratelimit-remaining'],
            reset: error.response.headers?.['ratelimit-reset'],
          });

          // You could show a user-friendly notification here
          // For now, just log the rate limit details
          return Promise.reject({
            ...error,
            message: `Rate limited. Please wait ${retryAfter} seconds before retrying.`,
            retryAfter,
          });
        }
        const originalRequest = error.config;

        // Handle connection errors (server unreachable)
        if (!error.response && error.code === 'ERR_NETWORK') {
          console.error('Server connection failed - redirecting to login');
          // With cookie auth, clearing localStorage might still be needed for state
          window.dispatchEvent(new CustomEvent("auth:logout"));
          window.location.href = "/login";
          return Promise.reject(error);
        }

        // Handle 401 (unauthorized) - token might be expired
        // Only redirect on auth endpoints (login/register/me) - other 401s might be external API failures
        const isAuthEndpoint = originalRequest.url?.includes('/api/auth/');
        const isUserProfileEndpoint = originalRequest.url?.includes('/api/user/profile');

        if (error.response?.status === 401 && !originalRequest._retry && (isAuthEndpoint || isUserProfileEndpoint)) {
          console.log('Received 401 on auth endpoint - redirecting to login (authentication required)', {
            url: originalRequest.url,
            status: error.response.status
          });
          originalRequest._retry = true;

          // Dispatch logout event to clear frontend state
          window.dispatchEvent(new CustomEvent("auth:logout"));
          window.location.href = "/login";
          return Promise.reject(error);
        }

        // For other 401 errors (market data, external APIs), don't redirect - just return the error
        if (error.response?.status === 401) {
          console.log('Received 401 on non-auth endpoint - not redirecting (may be external API)', {
            url: originalRequest.url,
            status: error.response.status
          });
          return Promise.reject(error);
        }

        // Handle 403 (forbidden) - user doesn't have permission
        if (error.response?.status === 403) {
          console.error('Received 403 - insufficient permissions');
          return Promise.reject(error);
        }

        // Handle 500+ server errors - but don't redirect for client errors (4xx)
        // Only redirect on server errors that indicate auth system failure
        if (error.response?.status >= 500 && (isAuthEndpoint || isUserProfileEndpoint)) {
          console.error('Auth system server error - redirecting to login');
          window.dispatchEvent(new CustomEvent("auth:logout"));
          window.location.href = "/login";
        }

        return Promise.reject(error);
      }
    );
  }

  public static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  // Auth endpoints
  async register(email: string, password: string) {
    const response = await this.client.post("/api/auth/register", {
      email,
      password,
    });
    return response.data;
  }

  async login(email: string, password: string) {
    console.log("API: Making login request for:", email);
    const response = await this.client.post("/api/auth/login", {
      email,
      password,
    });
    console.log("API: Login response received:", response.data);
    return response.data;
  }

  // Auth endpoints
  async getMe() {
    const response = await this.client.get("/api/auth/me");
    return response.data;
  }

  // User endpoints
  async getProfile() {
    const response = await this.client.get("/api/user/profile");
    return response.data;
  }



  // Strategy endpoints
  async updateStrategy(
    strategyId: string,
    data: {
      name: string;
      type: string;
      config: Record<string, unknown>;
    }
  ) {
    const response = await this.client.put(
      `/api/strategies/${strategyId}`,
      data
    );
    return response.data;
  }

  async deleteStrategy(strategyId: string) {
    const response = await this.client.delete(`/api/strategies/${strategyId}`);
    return response.data;
  }

  // Market endpoints
  async getTicker(symbol?: string) {
    const params = symbol ? { symbol } : {};
    const response = await this.client.get("/api/market/ticker", { params });
    return response.data;
  }

  async getKlines(params: {
    symbol?: string;
    interval?: string;
    limit?: number;
  }) {
    const response = await this.client.get("/api/market/klines", { params });
    return response.data;
  }

  async getKlineHistory(params: {
    symbol?: string;
    resolution?: string;
    from?: number;
    to?: number;
    limit?: number;
  }) {
    const response = await this.client.get("/api/market/kline-history", { params });
    return response.data;
  }

  async getPositions() {
    const response = await this.client.get("/api/market/positions");
    return response.data;
  }

  // TradingView endpoints
  async getTvConfig() {
    const response = await this.client.get("/api/market/tv/config");
    return response.data;
  }

  async getTvSymbols(params: { symbol?: string }) {
    const response = await this.client.get("/api/market/tv/symbols", {
      params,
    });
    return response.data;
  }

  async getTvHistory(params: {
    symbol?: string;
    resolution?: string;
    from?: number;
    to?: number;
  }) {
    const response = await this.client.get("/api/market/tv/history", {
      params,
    });
    return response.data;
  }

  // Strategy endpoints
  async getStrategies() {
    const response = await this.client.get("/api/strategies");
    return response.data;
  }

  async createStrategy(data: {
    name: string;
    type: string;
    config: Record<string, unknown>;
  }) {
    const response = await this.client.post("/api/strategies", data);
    return response.data;
  }

  // Bot endpoints
  async getBotInstances() {
    const response = await this.client.get("/api/bot/instances");
    return response.data;
  }

  async startBot(strategyId: string) {
    const response = await this.client.post("/api/bot/start", { strategyId });
    return response.data;
  }

  async stopBot(botId: string) {
    const response = await this.client.post("/api/bot/stop", { botId });
    return response.data;
  }

  async emergencyStop(botId: string) {
    const response = await this.client.post("/api/bot/emergency-stop", { botId });
    return response.data;
  }

  // Kodiak API methods
  async connectKodiak(data: {
    accountId: string;
    apiKey: string;
    secretKey: string;
  }) {
    const response = await this.client.post("/api/user/kodiak/connect", data);
    return response.data;
  }

  async disconnectKodiak() {
    const response = await this.client.delete("/api/user/kodiak/disconnect");
    return response.data;
  }

  async getKodiakStatus() {
    const response = await this.client.get("/api/user/kodiak/status");
    return response.data;
  }

  async getKodiakPositions() {
    try {
      const response = await this.client.get("/api/user/kodiak/positions");
      return response.data;
    } catch (error: any) {
      // Return empty data instead of throwing for missing credentials
      if (error.response?.status === 403 || error.response?.status === 400) {
        return {
          success: true,
          data: { rows: [] },
          message: "Kodiak account not connected"
        };
      }
      throw error;
    }
  }

  async getKodiakTrades() {
    try {
      const response = await this.client.get("/api/user/kodiak/trades");
      return response.data;
    } catch (error: any) {
      // Return empty data instead of throwing for missing credentials
      if (error.response?.status === 403 || error.response?.status === 400) {
        return {
          success: true,
          data: { rows: [] },
          message: "Kodiak account not connected"
        };
      }
      throw error;
    }
  }

  async getKodiakBalance() {
    try {
      const response = await this.client.get("/api/user/kodiak/balance");
      return response.data;
    } catch (error: any) {
      // Return empty data instead of throwing for missing credentials
      if (error.response?.status === 403 || error.response?.status === 400) {
        return {
          success: true,
          data: null,
          message: "Kodiak account not connected"
        };
      }
      throw error;
    }
  }

  async verifyWallet(data: {
    walletAddress: string;
    signature: string;
    message: string;
  }) {
    const response = await this.client.post("/api/user/verify-wallet", data);
    return response.data;
  }

  // Balance endpoints
  async getCurrentBalance() {
    const response = await this.client.get("/api/balance/current");
    return response.data;
  }

  async refreshBalance() {
    const response = await this.client.post("/api/balance/refresh");
    return response.data;
  }
}

export const api = ApiClient.getInstance();
