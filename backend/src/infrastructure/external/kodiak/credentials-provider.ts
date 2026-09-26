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
 * Resolved view of the account a read/write should run against (C3b).
 * `id` is the `exchange_accounts.id` UUID (snapshot/FK target); `accountRef`
 * is the venue-side account reference carried in the envelope.
 */
export interface ResolvedKodiakAccount {
  id: string;
  accountRef: string;
  credentials: KodiakCredentials;
}

/**
 * Decrypt the stored envelope of an already-loaded account row.
 * Current single-envelope rows first, then the backfilled kodiak-legacy
 * wrapper path (see migration 012 header).
 */
async function decryptStoredCredentials(
  userId: string,
  stored: { credentialsEncrypted: string },
  fallbackAccountRef: string
): Promise<KodiakCredentials | null> {
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
        accountId: parsed.accountId ?? fallbackAccountRef,
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
}

/**
 * Resolve the Kodiak account a request should run against — C3b.
 *
 * - `exchangeAccountId` given: that exact row, but only when the caller owns
 *   it (`getAccountWithSecret` is user-scoped), it is a kodiak row and it is
 *   ACTIVE; otherwise `null` (callers answer 400/404/409 before getting here,
 *   this is defence in depth).
 * - omitted: the user's first ACTIVE kodiak account (legacy default, so
 *   unscoped reads behave exactly as before C3).
 *
 * Returns the account UUID alongside the decrypted envelope so snapshot
 * writes (`exchange_positions` / `exchange_balances`) key by
 * `exchange_accounts.id`, not by the venue's own account id.
 */
export async function resolveKodiakAccount(
  userId: string,
  exchangeAccountId?: string
): Promise<ResolvedKodiakAccount | null> {
  try {
    if (exchangeAccountId) {
      const stored =
        await exchangeAccountRepositoryAdapter.getAccountWithSecret(
          userId,
          exchangeAccountId
        );
      if (
        !stored ||
        stored.exchange !== "kodiak" ||
        stored.status !== "ACTIVE"
      ) {
        return null;
      }
      const credentials = await decryptStoredCredentials(
        userId,
        stored,
        stored.accountRef
      );
      if (!credentials) return null;
      return { id: stored.id, accountRef: stored.accountRef, credentials };
    }

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

    const credentials = await decryptStoredCredentials(
      userId,
      stored,
      active.accountRef
    );
    if (!credentials) return null;
    return { id: active.id, accountRef: active.accountRef, credentials };
  } catch (error) {
    logger.error("Failed to get exchange account credentials", error as Error, {
      userId,
      exchangeAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get decrypted Kodiak credentials for a user — first ACTIVE kodiak account.
 *
 * C3 keeps the legacy (userId) contract for callers that do not care which
 * account answers (`market-cache.ts` gate); account-aware callers use
 * `resolveKodiakAccount` instead.
 */
export async function getUserCredentials(
  userId: string
): Promise<KodiakCredentials | null> {
  const resolved = await resolveKodiakAccount(userId);
  return resolved?.credentials ?? null;
}
