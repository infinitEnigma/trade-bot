/**
 * Exchange-account credential adapters (C2).
 *
 * Each venue owns its credential validation and plaintext payload shape —
 * the strategy, BotManager and reconciliation layers never see these.
 * Guardrail 1: a new venue adds a NEW adapter + union member, never an
 * optional field on an existing payload.
 *
 * @format
 */

import type { ConnectExchangeAccountRequest } from "@trade-bot/shared";

/** Plaintext credential payloads (memory only — encrypted before storage). */
export type ExchangeCredentialsPlaintext =
  | {
      exchange: "kodiak";
      accountId: string;
      apiKey: string;
      secretKey: string;
    }
  | {
      exchange: "lighter";
      accountIndex: number;
      apiKeyIndex: number;
      privateKey: string;
    };

export interface ExchangeCredentialAdapter {
  readonly exchange: "kodiak" | "lighter";
  /** Structural validation (lengths, prefixes, integer ranges). */
  validate(request: ConnectExchangeAccountRequest): {
    valid: boolean;
    error?: string;
  };
  /** Venue account reference stored in `exchange_accounts.account_ref`. */
  accountRef(request: ConnectExchangeAccountRequest): string;
  /** Plaintext payload that gets JSON-serialized + encrypted (Q1 envelope). */
  toPlaintext(
    request: ConnectExchangeAccountRequest
  ): ExchangeCredentialsPlaintext;
}

/**
 * Kodiak (Orderly) rules — verbatim from the retired
 * `kodiak-connection.service.ts` validateConnectionData so behaviour is
 * identical: accountId >= 10 chars, apiKey must start with `ed25519:`,
 * secretKey >= 30 chars.
 */
export const kodiakCredentialAdapter: ExchangeCredentialAdapter = {
  exchange: "kodiak",
  validate(request) {
    if (request.exchange !== "kodiak") {
      return { valid: false, error: "Not a kodiak request" };
    }
    if (!request.accountId || request.accountId.length < 10) {
      return { valid: false, error: "Invalid account ID format" };
    }
    if (!request.apiKey || !request.apiKey.startsWith("ed25519:")) {
      return { valid: false, error: "Invalid API key format" };
    }
    if (!request.secretKey || request.secretKey.length < 30) {
      return { valid: false, error: "Invalid secret key format" };
    }
    return { valid: true };
  },
  accountRef(request) {
    if (request.exchange !== "kodiak") throw new Error("Not a kodiak request");
    return request.accountId;
  },
  toPlaintext(request) {
    if (request.exchange !== "kodiak") throw new Error("Not a kodiak request");
    return {
      exchange: "kodiak",
      accountId: request.accountId,
      apiKey: request.apiKey,
      secretKey: request.secretKey,
    };
  },
};

/**
 * Lighter rules: int64 indices (non-negative integers) + signing key.
 * Connectivity itself is verified against the venue (testConnectivity),
 * not here — this is structural validation only.
 *
 * Bounds mirror the signer sidecar's pydantic contract (`account_index >= 1`,
 * `api_key_index <= 254`) so a bad index fails here with a clear message
 * instead of as an opaque 422 from the sidecar, and the key length is the native
 * signer's own rule (40 bytes = 80 hex chars, optional `0x`): verified live on
 * testnet, a 32-byte key is refused with "invalid private key length.
 * expected: 40 got: 32".
 */
export const LIGHTER_MAX_API_KEY_INDEX = 254;

export function isValidLighterPrivateKey(privateKey: string): boolean {
  return /^(0x)?[0-9a-fA-F]{80}$/.test(privateKey.trim());
}

export const lighterCredentialAdapter: ExchangeCredentialAdapter = {
  exchange: "lighter",
  validate(request) {
    if (request.exchange !== "lighter") {
      return { valid: false, error: "Not a lighter request" };
    }
    if (!Number.isInteger(request.accountIndex) || request.accountIndex < 1) {
      return { valid: false, error: "Invalid account index" };
    }
    if (
      !Number.isInteger(request.apiKeyIndex) ||
      request.apiKeyIndex < 0 ||
      request.apiKeyIndex > LIGHTER_MAX_API_KEY_INDEX
    ) {
      return { valid: false, error: "Invalid API key index" };
    }
    if (!isValidLighterPrivateKey(request.privateKey ?? "")) {
      return {
        valid: false,
        error: "Invalid private key: expected 80 hex characters (40 bytes)",
      };
    }
    return { valid: true };
  },
  accountRef(request) {
    if (request.exchange !== "lighter")
      throw new Error("Not a lighter request");
    return String(request.accountIndex);
  },
  toPlaintext(request) {
    if (request.exchange !== "lighter")
      throw new Error("Not a lighter request");
    return {
      exchange: "lighter",
      accountIndex: request.accountIndex,
      apiKeyIndex: request.apiKeyIndex,
      privateKey: request.privateKey,
    };
  },
};

/** Registry: exchange name → adapter. No exchange names outside adapters. */
const adapters: Record<string, ExchangeCredentialAdapter> = {
  kodiak: kodiakCredentialAdapter,
  lighter: lighterCredentialAdapter,
};

export function getCredentialAdapter(
  exchange: string
): ExchangeCredentialAdapter | null {
  return adapters[exchange] ?? null;
}
