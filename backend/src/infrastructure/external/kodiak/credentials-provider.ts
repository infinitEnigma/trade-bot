/**
 * Kodiak credentials resolution for a user — C2 (exchange_accounts).
 *
 * Replaces the legacy single-row credentials lookup. Decrypts the single versioned
 * envelope (`credentials_encrypted`, Q1 decision):
 * - current rows: `decryptWithVersion` → JSON `{v, kind, ...fields}`;
 * - backfilled `kodiak-legacy` wrappers: outer decrypt → JSON whose
 *   apiKeyCipher/secretKeyCipher are the untouched legacy per-field
 *   ciphertext blobs, each decrypted with the existing per-field logic.
 */

import { encryptionService } from "../../security/encryption.service";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
import type { KodiakCredentials } from "./types";
import { exchangeAccountRepositoryAdapter } from "../../adapters/repositories/exchange-account-repository.adapter";

interface LegacyWrapper {
  v: number;
  kind: "kodiak-legacy";
  accountId: string;
  apiKeyCipher: string;
  secretKeyCipher: string;
}

interface CurrentEnvelope {
  v: number;
  kind: string;
  accountId?: string;
  apiKey?: string;
  secretKey?: string;
}

function decryptFieldBlob(blob: string): string {
  try {
    return encryptionService.decryptApiKey(blob);
  } catch {
    // try versioned next
  }
  try {
    return encryptionService.decryptSecretKey(blob);
  } catch {
    // try versioned next
  }
  // Rows re-encrypted by key rotation carry versioned per-field blobs
  // (encryption_version >= 3); decrypt synchronously is impossible so the
  // async path below handles them — this throw keeps the sync signature.
  throw new Error("Field blob needs versioned decryption");
}

async function decryptFieldBlobAsync(blob: string): Promise<string> {
  try {
    return decryptFieldBlob(blob);
  } catch {
    return encryptionService.decryptWithVersion(blob);
  }
}

/**
 * Get decrypted Kodiak credentials for a user.
 *
 * C3 replaces the "first ACTIVE account" lookup with an explicit
 * bot→account binding — the signature stays so C3 is a data-source swap.
 */
export async function getUserCredentials(
  userId: string
): Promise<KodiakCredentials | null> {
  try {
    const accounts =
      await exchangeAccountRepositoryAdapter.listAccounts(userId);
    const active = accounts.find(
      a => a.exchange === "kodiak" && a.status === "ACTIVE"
    );
    if (!active) return null;

    const stored = await exchangeAccountRepositoryAdapter.getAccountWithSecret(
      userId,
      active.id
    );
    if (!stored) return null;

    // Current single-envelope rows: one versioned decrypt → plaintext JSON.
    try {
      const plaintext = await encryptionService.decryptWithVersion(
        stored.credentialsEncrypted
      );
      const parsed = JSON.parse(plaintext) as CurrentEnvelope;
      if (
        (parsed.kind === "kodiak" || parsed.kind === undefined) &&
        typeof parsed.apiKey === "string" &&
        typeof parsed.secretKey === "string"
      ) {
        return {
          accountId: parsed.accountId ?? active.accountRef,
          apiKey: parsed.apiKey,
          secretKey: parsed.secretKey,
        };
      }
    } catch {
      // Not a versioned single envelope — try the legacy wrapper path.
    }

    // Backfilled wrapper: the column holds the wrapper JSON itself; each
    // field is the untouched legacy ciphertext blob (see migration 012
    // header). Decrypt per-field with the existing logic.
    try {
      const wrapper = JSON.parse(stored.credentialsEncrypted) as LegacyWrapper;
      if (wrapper.kind !== "kodiak-legacy") return null;
      const [apiKey, secretKey] = await Promise.all([
        decryptFieldBlobAsync(wrapper.apiKeyCipher),
        decryptFieldBlobAsync(wrapper.secretKeyCipher),
      ]);
      return { accountId: wrapper.accountId, apiKey, secretKey };
    } catch (error) {
      logger.error(
        "Failed to decrypt exchange account envelope",
        error as Error,
        { userId }
      );
      return null;
    }
  } catch (error) {
    logger.error("Failed to get exchange account credentials", error as Error, {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
