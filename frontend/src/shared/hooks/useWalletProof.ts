/** @format */

/**
 * useWalletProof (X4) — get a signed wallet-proof for a gated action.
 *
 * Wraps the challenge → sign → payload flow on top of wagmi v3 (same
 * `useConnection` / `useSignMessage` pattern as `WalletConnectDialog`).
 * `getWalletProof(action)` resolves to:
 *  - `undefined` when the backend reports `proofRequired: false`
 *    (WALLET_PROOF_REQUIRED off — the harness/e2e escape hatch, D3), so
 *    callers can chain it unconditionally;
 *  - a `{nonce, address, signature}` payload to send as `walletProof`.
 *
 * All failure modes throw with user-ready messages (never raw wagmi errors):
 *  - wallet not connected       → "Connect the wallet linked to your account"
 *  - connected but unlinked     → "Switch to 0x…abc"
 *  - user rejects the signature → "Signature required"
 */

import { useCallback } from "react";
import { useConnection, useSignMessage } from "wagmi";
import {
  walletApi,
  WalletDto,
  WalletProofPayload,
} from "../../infrastructure/api/wallet";

export type WalletProofAction =
  "bot:start" | "bot:stop" | "bot:resume" | "runs:attach" | "account:bind";

function shortAddress(address: string): string {
  return address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useWalletProof() {
  const { address, isConnected } = useConnection();
  const { mutateAsync: signMessageAsync } = useSignMessage();

  const getWalletProof = useCallback(
    async (
      action: WalletProofAction
    ): Promise<WalletProofPayload | undefined> => {
      // The flag rides on GET /api/wallets (additive). If the fetch itself
      // fails we fall through to the challenge flow — the backend gate is
      // authoritative and will 403 with a clear reason if the proof really
      // was required.
      let proofRequired = true;
      let wallets: WalletDto[] = [];
      try {
        const listed = await walletApi.listWallets();
        proofRequired = listed.data?.proofRequired ?? true;
        wallets = listed.data?.wallets ?? [];
      } catch {
        proofRequired = true;
      }
      if (!proofRequired) return undefined;

      if (!isConnected || !address) {
        throw new Error("Connect the wallet linked to your account.");
      }

      const linked = wallets.some(
        wallet =>
          wallet.chain === "evm" &&
          wallet.address.toLowerCase() === address.toLowerCase()
      );
      if (!linked) {
        const primary =
          wallets.find(wallet => wallet.chain === "evm" && wallet.isPrimary) ??
          wallets.find(wallet => wallet.chain === "evm");
        throw new Error(
          primary
            ? `Switch to ${shortAddress(primary.address)} — it is the wallet linked to this account.`
            : "The connected wallet is not linked to your account. Link it in Settings first."
        );
      }

      const challenge = await walletApi.createChallenge(action);
      if (!challenge.success || !challenge.data) {
        throw new Error(
          challenge.error ?? "Could not request a wallet challenge. Try again."
        );
      }

      let signature: string;
      try {
        signature = await signMessageAsync({
          message: challenge.data.message,
        });
      } catch {
        throw new Error("Signature required to continue.");
      }

      return {
        nonce: challenge.data.nonce,
        address,
        signature,
      };
    },
    [address, isConnected, signMessageAsync]
  );

  return { getWalletProof };
}
