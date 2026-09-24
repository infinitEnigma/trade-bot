/** @format */

import { httpClient } from "./client";

/**
 * Exchange accounts API (C2) — generic venue/environment accounts.
 *
 * Replaces the deleted /api/user/kodiak/* endpoints:
 * - GET    /api/accounts            list (metadata only, never secrets)
 * - POST   /api/accounts/connect    connect + live-verify one account
 * - POST   /api/accounts/:id/verify re-verify (graduates legacy envelopes)
 * - DELETE /api/accounts/:id        revoke (audited, level recompute)
 */
export type AccountExchange = "kodiak" | "lighter";
export type AccountEnvironment = "testnet" | "mainnet";
export type AccountStatus = "PENDING" | "ACTIVE" | "INVALID" | "REVOKED";

export interface ExchangeAccountDto {
  id: string;
  userId: string;
  exchange: AccountExchange;
  environment: AccountEnvironment;
  accountRef: string;
  status: AccountStatus;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConnectAccountRequest =
  | {
      exchange: "kodiak";
      environment: AccountEnvironment;
      accountId: string;
      apiKey: string;
      secretKey: string;
    }
  | {
      exchange: "lighter";
      environment: AccountEnvironment;
      accountIndex: number;
      apiKeyIndex: number;
      privateKey: string;
    };

export interface AccountsListResponse {
  success: boolean;
  data: { accounts: ExchangeAccountDto[] };
  error?: string;
}

export interface AccountMutationResponse {
  success: boolean;
  message?: string;
  data?: ExchangeAccountDto;
  error?: string;
}

/** Lighter keys are 40 bytes = 80 hex characters, `0x` prefix optional. */
export const LIGHTER_PRIVATE_KEY_LENGTH = 80;

/** Mirrors the backend/sidecar bound (C2). */
export const LIGHTER_MAX_API_KEY_INDEX = 254;

/** The native signer's own rule (live-verified: 32 bytes is refused). */
export function isLighterPrivateKeyShape(value: string): boolean {
  return new RegExp(`^(0x)?[0-9a-fA-F]{${LIGHTER_PRIVATE_KEY_LENGTH}}$`).test(
    value.trim()
  );
}

export const accountsApi = {
  async listAccounts(): Promise<AccountsListResponse> {
    const response = await httpClient.getClient().get("/api/accounts");
    const data = response.data as {
      success?: boolean;
      // Backend serialises Date fields to ISO strings over the wire.
      data?: { accounts?: Array<Record<string, unknown>> };
      error?: string;
    };
    const accounts = (data?.data?.accounts ?? []).map(account => ({
      ...account,
      // Backend sends camelCase (verifiedAt); tolerate snake_case history.
      verifiedAt:
        (account["verifiedAt"] as string | null | undefined) ??
        (account["verified_at"] as string | null | undefined) ??
        null,
    })) as ExchangeAccountDto[];
    return {
      success: data?.success ?? true,
      error: data?.error,
      data: { accounts },
    };
  },

  async connectAccount(
    request: ConnectAccountRequest
  ): Promise<AccountMutationResponse> {
    const response = await httpClient
      .getClient()
      .post("/api/accounts/connect", request);
    return response.data;
  },

  async verifyAccount(accountId: string): Promise<AccountMutationResponse> {
    const response = await httpClient
      .getClient()
      .post(`/api/accounts/${accountId}/verify`);
    return response.data;
  },

  async revokeAccount(accountId: string): Promise<AccountMutationResponse> {
    const response = await httpClient
      .getClient()
      .delete(`/api/accounts/${accountId}`);
    return response.data;
  },
};
