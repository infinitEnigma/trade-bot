/** @format */

//import { ApiError } from "@trade-bot/shared";
import { globalRequestManager } from "../request-manager";
import { httpClient } from "./client";

export interface KodiakCredentials {
  accountId: string;
  apiKey: string;
  secretKey: string;
  /** C2: venue environment; defaults to mainnet for legacy callers. */
  environment?: "testnet" | "mainnet";
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
    data?: { error?: string; message?: string };
  };
}

/**
 * L15: venue-neutral balance failure. The server answers 400 with a reason
 * when a venue read fails (sidecar down, venue 401 like the wiped Lighter
 * testnet account, unknown account); the message must not name a venue and
 * must never leak secrets — the server already sanitises it.
 */
export function toBalanceError(error: unknown): Error {
  const apiError = error as ApiError;
  const serverReason =
    apiError?.response?.data?.error || apiError?.response?.data?.message;
  if (serverReason) {
    return new Error(`Balance unavailable: ${serverReason}`);
  }
  if (apiError?.response?.status) {
    return new Error(
      `Balance unavailable (request failed with status ${apiError.response.status})`
    );
  }
  return new Error(
    (apiError as Error)?.message || "Balance unavailable: network error"
  );
}

/**
 * Kodiak API Service
 * Handles Kodiak trading platform integration.
 *
 * C2: connect/status/disconnect go through /api/accounts (generic
 * exchange-account router), user data through /api/market/*. Response
 * shapes are mapped onto the legacy DTOs so existing consumers keep working.
 */
class KodiakApi {
  /**
   * Connect Kodiak credentials
   * Frontend sends encrypted credentials to backend for validation and storage
   */
  async connectKodiak(
    credentials: KodiakCredentials
  ): Promise<KodiakConnectResponse> {
    const {
      environment = "mainnet",
      accountId,
      apiKey,
      secretKey,
    } = credentials;
    const response = await httpClient
      .getClient()
      .post("/api/accounts/connect", {
        exchange: "kodiak",
        environment,
        accountId,
        apiKey,
        secretKey,
      });
    // Map the C2 account DTO onto the legacy response shape the Settings
    // flow (verified flag) and hooks already consume.
    const account = response.data?.data;
    return {
      success: response.data?.success ?? false,
      message: response.data?.message,
      error: response.data?.error,
      data: account
        ? {
            accountId: account.accountRef,
            connected: true,
            verified: account.status === "ACTIVE",
          }
        : undefined,
    };
  }

  /**
   * Disconnect Kodiak credentials
   * Backend handles credential removal and user level downgrade
   */
  async disconnectKodiak(): Promise<KodiakDisconnectResponse> {
    // Legacy no-arg disconnect: revoke the first live Kodiak account.
    const list = await httpClient.getClient().get("/api/accounts");
    const accounts: { id: string; exchange: string; status: string }[] =
      list.data?.data?.accounts ?? [];
    const target =
      accounts.find(a => a.exchange === "kodiak" && a.status === "ACTIVE") ??
      accounts.find(a => a.exchange === "kodiak" && a.status !== "REVOKED");
    if (!target) {
      return { success: true, message: "No Kodiak account connected" };
    }
    const response = await httpClient
      .getClient()
      .delete(`/api/accounts/${target.id}`);
    return response.data;
  }

  /**
   * Get Kodiak connection status
   * Backend returns encrypted status information
   */
  async getKodiakStatus(): Promise<{
    success: boolean;
    data?: KodiakStatus;
    error?: string;
  }> {
    // C2: status is derived from the accounts list (no dedicated endpoint).
    const response = await httpClient.getClient().get("/api/accounts");
    const accounts: {
      id: string;
      exchange: string;
      status: string;
      accountRef: string;
      verifiedAt?: string | null;
      createdAt: string;
    }[] = response.data?.data?.accounts ?? [];
    const live = accounts.filter(
      a => a.exchange === "kodiak" && a.status !== "REVOKED"
    );
    const active = live.find(a => a.status === "ACTIVE") ?? live[0];
    return {
      success: true,
      data: active
        ? {
            connected: true,
            accountId: active.accountRef,
            connectedAt: active.verifiedAt ?? active.createdAt,
            verified: active.status === "ACTIVE",
          }
        : { connected: false },
    };
  }

  /**
     * Get Kodiak account balance
     
    async getKodiakBalance(): Promise<{ success: boolean; data?: KodiakBalanceResponse; error?: string }> {
        const response = await httpClient.getClient().get('/api/user/kodiak/balance');
        return response.data;
    }*/
  async getKodiakBalance(exchangeAccountId?: string) {
    return globalRequestManager.deduplicateRequest(
      `kodiak:balance${exchangeAccountId ? `:${exchangeAccountId}` : ""}`,
      async () => {
        try {
          const response = await httpClient
            .getClient()
            .get("/api/market/balance", {
              params: exchangeAccountId ? { exchangeAccountId } : undefined,
            });
          return response.data;
        } catch (error: unknown) {
          // L15: propagate — masking 400/403 as success made a failed read
          // indistinguishable from a zero balance.
          throw toBalanceError(error);
        }
      },
      "tradingApi"
    );
  }

  // Kodiak exchange integration endpoints with global deduplication
  // (C3b: optional exchangeAccountId scopes the read to one account; the
  // dedup key carries it so two accounts never share an in-flight request)
  async getKodiakPositions(exchangeAccountId?: string) {
    return globalRequestManager.deduplicateRequest(
      `kodiak:positions${exchangeAccountId ? `:${exchangeAccountId}` : ""}`,
      async () => {
        try {
          const response = await httpClient
            .getClient()
            .get("/api/market/positions", {
              params: exchangeAccountId ? { exchangeAccountId } : undefined,
            });
          return response.data;
        } catch (error: unknown) {
          // Return empty data instead of throwing for missing credentials
          const apiError = error as ApiError;
          if (
            apiError.response?.status === 403 ||
            apiError.response?.status === 400
          ) {
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

  async getKodiakTrades(limit = 50, exchangeAccountId?: string) {
    return globalRequestManager.deduplicateRequest(
      `kodiak:trades:${limit}${exchangeAccountId ? `:${exchangeAccountId}` : ""}`,
      async () => {
        try {
          const response = await httpClient
            .getClient()
            .get(
              `/api/market/trades?limit=${limit}${
                exchangeAccountId
                  ? `&exchangeAccountId=${exchangeAccountId}`
                  : ""
              }`
            );
          return response.data;
        } catch (error: unknown) {
          // Return empty data instead of throwing for missing credentials
          const apiError = error as ApiError;
          if (
            apiError.response?.status === 403 ||
            apiError.response?.status === 400
          ) {
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
    if (
      credentials.accountId &&
      !/^[a-zA-Z0-9_-]+$/.test(credentials.accountId)
    ) {
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
