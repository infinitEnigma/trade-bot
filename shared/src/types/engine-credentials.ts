/**
 * Engine credential contract (exchange-agnostic).
 *
 * This is the envelope the backend hands the engine on
 * `GET /api/bot/engine/credentials/:botId`, and the shape the engine's
 * credential fetcher validates and the exchange client factory consumes.
 *
 * Guardrails (EXCHANGE_INTEGRATION_PLAN.md §0):
 * - No exchange-specific fields leak onto a shared member. A new venue means
 *   a NEW union member, never an optional field on an existing one.
 * - The engine's strategy / BotManager / reconciliation layers consume this
 *   contract only — they never read venue-specific columns directly.
 *
 * @format
 */

/** Venues the engine can trade on. Extend with a new union member, not a field. */
export type ExchangeKind = "kodiak" | "lighter";

/** Venue environment the credentials are valid for. */
export type EngineEnvironment = "testnet" | "mainnet";

/** Orderly/Kodiak credential payload (orderly account + ed25519 API keys). */
export interface KodiakEngineCredentials {
  accountId: string;
  accessKey: string;
  secretKey: string;
}

/** Lighter credential payload (int64 indices + signing key for the sidecar). */
export interface LighterEngineCredentials {
  accountIndex: number;
  apiKeyIndex: number;
  privateKey: string;
}

/**
 * Discriminated credential envelope. The `exchange` discriminator guarantees
 * the payload always matches the venue — a Kodiak envelope can never carry a
 * Lighter payload and vice versa.
 */
export type EngineCredentials =
  | {
      exchange: "kodiak";
      environment: EngineEnvironment;
      /** Venue account reference (C3: comes from `exchange_accounts`). */
      accountRef: string;
      credentials: KodiakEngineCredentials;
    }
  | {
      exchange: "lighter";
      environment: EngineEnvironment;
      accountRef: string;
      credentials: LighterEngineCredentials;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isKodiakPayload(value: unknown): value is KodiakEngineCredentials {
  return (
    isRecord(value) &&
    isNonEmptyString(value.accountId) &&
    isNonEmptyString(value.accessKey) &&
    isNonEmptyString(value.secretKey)
  );
}

function isLighterPayload(value: unknown): value is LighterEngineCredentials {
  return (
    isRecord(value) &&
    typeof value.accountIndex === "number" &&
    Number.isInteger(value.accountIndex) &&
    value.accountIndex >= 0 &&
    typeof value.apiKeyIndex === "number" &&
    Number.isInteger(value.apiKeyIndex) &&
    value.apiKeyIndex >= 0 &&
    isNonEmptyString(value.privateKey)
  );
}

/**
 * Type guard for a credential envelope arriving over the wire (the engine
 * validates the backend's response before it reaches the client factory).
 * Rejects malformed envelopes instead of letting them reach exchange code.
 */
export function isEngineCredentials(
  value: unknown
): value is EngineCredentials {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.accountRef)) return false;
  if (value.environment !== "testnet" && value.environment !== "mainnet") {
    return false;
  }

  switch (value.exchange) {
    case "kodiak":
      return isKodiakPayload(value.credentials);
    case "lighter":
      return isLighterPayload(value.credentials);
    default:
      return false;
  }
}
