/** @format */

/**
 * Venue-asserted account ownership (X4).
 *
 * Resolves the wallet address the venue itself says owns an account, from
 * public endpoints only — no credentials touch this module:
 * - Kodiak:  `GET /v1/public/account?account_id=` → `data.address`
 * - Lighter: `GET /api/v1/account?by=index&value=` → `accounts[0].l1_address`
 *   (public on testnet; on environments where the endpoint requires auth the
 *   lookup fails closed → `null`, and connect/verify rejects with a clear
 *   reason rather than guessing).
 *
 * Returns a normalized (lowercase, trimmed) EVM address, or `null` whenever
 * the lookup fails or the payload is malformed — callers treat `null` as
 * "cannot prove ownership" and fail closed. The resolved owner is cached on
 * the account row (`meta.walletBinding`) at connect/verify and is NOT
 * re-checked per bot start (documented limit in the X4 findings entry).
 */

import axios, { isAxiosError } from "axios";
import { integrationLogger } from "../../../core/logging";

/** Same env/default resolution as `kodiak/market-data.ts`. */
export const KODIAK_DEFAULT_API_URL = "https://api.orderly.org";

/** Live checks are user-facing actions; keep the bound short. */
export const DEFAULT_VENUE_OWNER_TIMEOUT_MS = 5000;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export interface VenueOwnerLookup {
  exchange: "kodiak" | "lighter";
  environment: string;
  /** Kodiak account id (`account_ref` for kodiak rows). */
  accountId?: string;
  /** Lighter account index (`account_ref` for lighter rows). */
  accountIndex?: number;
  /** Base-URL overrides (tests / env-specific gateways). */
  kodiakBaseUrl?: string;
  lighterBaseUrl?: string;
}

export function normalizeEvmAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!EVM_ADDRESS_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function lighterUrlFor(environment: string, override?: string): string {
  if (override) return override.replace(/\/$/, "");
  return environment === "mainnet"
    ? "https://mainnet.zklighter.elliot.ai"
    : "https://testnet.zklighter.elliot.ai";
}

function kodiakUrlFor(override?: string): string {
  const base = override ?? process.env.KODIAK_API_URL ?? KODIAK_DEFAULT_API_URL;
  return base.replace(/\/$/, "");
}

/** Kodiak: `data.address` (or a bare `address` at the top level). */
export async function resolveKodiakOwner(
  lookup: VenueOwnerLookup,
  timeoutMs: number = DEFAULT_VENUE_OWNER_TIMEOUT_MS
): Promise<string | null> {
  if (!lookup.accountId) return null;
  const url = `${kodiakUrlFor(lookup.kodiakBaseUrl)}/v1/public/account`;
  try {
    const response = await axios.get(url, {
      params: { account_id: lookup.accountId },
      timeout: timeoutMs,
    });
    const data = (response.data as { data?: Record<string, unknown> })?.data;
    const address =
      (data?.address as unknown) ??
      (response.data as { address?: unknown })?.address;
    return normalizeEvmAddress(address);
  } catch (error) {
    if (isAxiosError(error)) {
      integrationLogger.warn("Kodiak venue-owner lookup failed", {
        status: error.response?.status,
        environment: lookup.environment,
      });
      return null;
    }
    integrationLogger.warn("Kodiak venue-owner lookup errored", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Lighter: `accounts[0].l1_address` of the public account endpoint. */
export async function resolveLighterOwner(
  lookup: VenueOwnerLookup,
  timeoutMs: number = DEFAULT_VENUE_OWNER_TIMEOUT_MS
): Promise<string | null> {
  if (typeof lookup.accountIndex !== "number") return null;
  const url = `${lighterUrlFor(lookup.environment, lookup.lighterBaseUrl)}/api/v1/account`;
  try {
    const response = await axios.get(url, {
      params: { by: "index", value: String(lookup.accountIndex) },
      timeout: timeoutMs,
    });
    const accounts = (response.data as { accounts?: unknown })?.accounts;
    const account = Array.isArray(accounts) ? accounts[0] : undefined;
    if (!account || typeof account !== "object") return null;
    return normalizeEvmAddress((account as Record<string, unknown>).l1_address);
  } catch (error) {
    if (isAxiosError(error)) {
      integrationLogger.warn("Lighter venue-owner lookup failed", {
        status: error.response?.status,
        environment: lookup.environment,
      });
      return null;
    }
    integrationLogger.warn("Lighter venue-owner lookup errored", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Venue dispatch. `null` on any failure — the caller decides the user-facing
 * message, but the decision is always fail-closed (no owner → no binding).
 */
export async function resolveVenueOwner(
  lookup: VenueOwnerLookup
): Promise<string | null> {
  if (lookup.exchange === "kodiak") return resolveKodiakOwner(lookup);
  if (lookup.exchange === "lighter") return resolveLighterOwner(lookup);
  return null;
}
