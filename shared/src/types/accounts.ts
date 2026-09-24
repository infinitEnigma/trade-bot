/**
 * C2 — wallets + exchange accounts domain contract.
 *
 * `Wallet.chain` is a closed set ('evm' | 'solana' | 'bitcoin'): the platform
 * verifies EVM + SOL (account-based) vs BTC (UTXO-based) address shapes, and
 * per-chain validation lives in backend code, not in SQL CHECK text.
 * `ExchangeAccount.exchange` reuses the engine's ExchangeKind vocabulary
 * ('kodiak' | 'lighter'); a new venue extends the union, never adds a column.
 *
 * Secrets never leave the backend: list/detail shapes carry metadata only.
 *
 * @format
 */

import type { EngineEnvironment, ExchangeKind } from "./engine-credentials";

/** Chains the platform can link wallets on. */
export type ChainKind = "evm" | "solana" | "bitcoin";

/** Lifecycle of a venue account: unverified → trading → revoked. */
export type ExchangeAccountStatus =
  "PENDING" | "ACTIVE" | "INVALID" | "REVOKED";

/** A linked chain wallet (many per user, exactly one primary). */
export interface Wallet {
  id: string;
  userId: string;
  chain: ChainKind;
  address: string;
  label?: string | null;
  isPrimary: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Request body for linking a wallet (signature verified server-side). */
export interface LinkWalletRequest {
  chain: ChainKind;
  address: string;
  label?: string;
  signature: string;
  message: string;
}

/**
 * A venue account (many per user: kodiak + lighter testnet + lighter
 * mainnet can coexist). `credentials` are write-only — responses never
 * include them.
 */
export interface ExchangeAccount {
  id: string;
  userId: string;
  exchange: ExchangeKind;
  environment: EngineEnvironment;
  accountRef: string;
  status: ExchangeAccountStatus;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Request body for connecting a venue account. */
export type ConnectExchangeAccountRequest =
  | {
      exchange: "kodiak";
      environment: EngineEnvironment;
      accountId: string;
      apiKey: string;
      secretKey: string;
    }
  | {
      exchange: "lighter";
      environment: EngineEnvironment;
      accountIndex: number;
      apiKeyIndex: number;
      privateKey: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChainKind(value: unknown): value is ChainKind {
  return value === "evm" || value === "solana" || value === "bitcoin";
}

/** Wire guard: unknown link-wallet payloads are rejected before services. */
export function isLinkWalletRequest(
  value: unknown
): value is LinkWalletRequest {
  if (!isRecord(value)) return false;
  return (
    isChainKind(value.chain) &&
    typeof value.address === "string" &&
    value.address.length > 0 &&
    typeof value.signature === "string" &&
    value.signature.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    (value.label === undefined || typeof value.label === "string")
  );
}

function isEngineEnvironment(value: unknown): value is EngineEnvironment {
  return value === "testnet" || value === "mainnet";
}

/** Wire guard: unknown connect-account payloads never reach the adapters. */
export function isConnectExchangeAccountRequest(
  value: unknown
): value is ConnectExchangeAccountRequest {
  if (!isRecord(value)) return false;
  if (!isEngineEnvironment(value.environment)) return false;
  if (value.exchange === "kodiak") {
    return (
      typeof value.accountId === "string" &&
      value.accountId.length > 0 &&
      typeof value.apiKey === "string" &&
      value.apiKey.length > 0 &&
      typeof value.secretKey === "string" &&
      value.secretKey.length > 0
    );
  }
  if (value.exchange === "lighter") {
    return (
      typeof value.accountIndex === "number" &&
      Number.isInteger(value.accountIndex) &&
      value.accountIndex >= 0 &&
      typeof value.apiKeyIndex === "number" &&
      Number.isInteger(value.apiKeyIndex) &&
      value.apiKeyIndex >= 0 &&
      typeof value.privateKey === "string" &&
      value.privateKey.length > 0
    );
  }
  return false;
}
