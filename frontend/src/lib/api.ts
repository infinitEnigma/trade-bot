/** @format */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = "http://localhost:3000";
console.log("API_BASE_URL:", API_BASE_URL);

class ApiClient {
  private client: AxiosInstance;
  private static instance: ApiClient;

  private constructor() {
    console.log("Creating API client with baseURL:", API_BASE_URL);
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = localStorage.getItem("accessToken");
        console.log("Sending request to:", config.url);
        console.log(
          "Token from localStorage:",
          token ? `${token.substring(0, 20)}...` : "null"
        );
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
          console.log(
            "Authorization header set:",
            `Bearer ${token.substring(0, 20)}...`
          );

          // Track user activity when making authenticated requests
          localStorage.setItem("lastActivity", Date.now().toString());
        } else {
          console.log("No token found, not setting Authorization header");
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const refreshToken = localStorage.getItem("refreshToken");
            if (refreshToken) {
              const response = await axios.post(
                `${API_BASE_URL}/api/auth/refresh`,
                {
                  refreshToken,
                }
              );

              const { accessToken, refreshToken: newRefreshToken } =
                response.data.tokens;
              localStorage.setItem("accessToken", accessToken);
              if (newRefreshToken) {
                localStorage.setItem("refreshToken", newRefreshToken);
              }

              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
              return this.client(originalRequest);
            }
          } catch (refreshError) {
            // Clear tokens and redirect to login
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");

            // Dispatch custom event to notify AuthContext of logout
            window.dispatchEvent(new CustomEvent("auth:logout"));

            // Redirect to login
            window.location.href = "/login";
          }
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

  async connectKodiak(data: {
    accountId: string;
    apiKey: string;
    secretKey: string;
    walletSignature?: string;
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
    const response = await this.client.get("/api/user/kodiak/positions");
    return response.data;
  }

  async getKodiakTrades() {
    const response = await this.client.get("/api/user/kodiak/trades");
    return response.data;
  }

  async getKodiakBalance() {
    const response = await this.client.get("/api/user/kodiak/balance");
    return response.data;
  }

  async verifyWallet(data: {
    walletAddress: string;
    signature: string;
    message: string;
  }) {
    const response = await this.client.post("/api/user/verify-wallet", data);
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

  async getPositions() {
    const response = await this.client.get("/api/market/positions");
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
}

export const api = ApiClient.getInstance();
