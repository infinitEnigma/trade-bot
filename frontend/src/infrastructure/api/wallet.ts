/** @format */

import { httpClient } from "./client";

/**
 * Chain-aware multi-wallet API (C2).
 *
 * Replaces the legacy POST /api/user/verify-wallet + /unlink-wallet pair
 * (deleted with `wallet_addresses`, Q2 clean cut).
 */
export type ChainKind = "evm" | "solana" | "bitcoin";

export interface WalletDto {
  id: string;
  chain: ChainKind;
  address: string;
  label?: string | null;
  isPrimary: boolean;
  verifiedAt?: string | null;
}

export const walletApi = {
  async listWallets(): Promise<{
    success: boolean;
    data?: { wallets: WalletDto[] };
  }> {
    const response = await httpClient.getClient().get("/api/wallets");
    return response.data;
  },

  /**
   * Verify wallet ownership by signing a message
   * (BASIC -> REGISTERED upgrade step)
   */
  async verifyWallet(data: {
    chain?: ChainKind;
    address?: string;
    walletAddress?: string;
    signature: string;
    message: string;
    label?: string;
  }) {
    const response = await httpClient
      .getClient()
      .post("/api/wallets/verify", data);
    return response.data;
  },

  /**
   * Unlink one wallet (explicit, audited downgrade).
   * REGISTERED -> BASIC; VERIFIED -> REGISTERED (or BASIC if no accounts).
   * Note: a plain wallet "Disconnect" in the UI is local-only and does
   * NOT call this endpoint.
   */
  async unlinkWallet(walletId: string) {
    const response = await httpClient
      .getClient()
      .post(`/api/wallets/${walletId}/unlink`);
    return response.data;
  },

  async setPrimaryWallet(walletId: string) {
    const response = await httpClient
      .getClient()
      .patch(`/api/wallets/${walletId}/primary`);
    return response.data;
  },
};
