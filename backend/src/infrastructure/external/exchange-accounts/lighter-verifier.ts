/**
 * Lighter credential verification (C2).
 *
 * "Verified" means two things:
 *  1. the account index exists on the target environment, and
 *  2. the private key really is the one Lighter registered for
 *     `(accountIndex, apiKeyIndex)`.
 *
 * Step 2 is delegated to the signer sidecar (`POST /v1/verify-credentials`),
 * which asks the official Lighter SDK to compare the public key derived from the
 * supplied private key with the one the venue returns. The backend therefore
 * never touches Lighter's signing/wire format, and the sidecar runs the check in
 * a throwaway child process so it cannot disturb the keys it signs with.
 *
 * Fail-closed (approved C2 decision): anything other than a positive verdict
 * from both steps yields `{verified:false}` with a reason — including a missing
 * or unreachable sidecar — so nobody ends up with an ACTIVE Lighter account
 * whose key was never proven.
 *
 * Secrets: the private key travels in the request body, is never logged, and
 * never appears in a returned error.
 *
 * @format
 */

import axios, { AxiosInstance, isAxiosError } from "axios";

/** Venue REST defaults, mirroring the engine's `lighterBaseUrl`. */
export const LIGHTER_MAINNET_URL = "https://mainnet.zklighter.elliot.ai";
export const LIGHTER_TESTNET_URL = "https://testnet.zklighter.elliot.ai";

/** Live checks are a user-facing action; keep the bound short. */
export const DEFAULT_LIGHTER_VERIFY_TIMEOUT_MS = 5000;

/** Longest reason kept from the venue/sidecar (bounded UI + audit text). */
const MAX_REASON_LENGTH = 300;

export interface LighterVerifierConfig {
  /** `LIGHTER_SIDECAR_URL` — its absence fails verification closed. */
  sidecarUrl?: string;
  /** `SIDECAR_AUTH_TOKEN` when the sidecar enforces it. */
  sidecarAuthToken?: string;
  /** `LIGHTER_BASE_URL` override; otherwise derived from the environment. */
  baseUrl?: string;
  timeoutMs?: number;
}

export interface LighterCredentials {
  accountIndex: number;
  apiKeyIndex: number;
  privateKey: string;
  environment: string;
}

export interface LighterVerifierClients {
  venue: AxiosInstance;
  sidecar: AxiosInstance;
}

export interface LighterVerifyResult {
  verified: boolean;
  error?: string;
}

export interface LighterVerifierLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** Environment-shaped config; fields stay absent when unset. */
export function lighterVerifierConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LighterVerifierConfig {
  const sidecarUrl = (env.LIGHTER_SIDECAR_URL ?? "").trim();
  const sidecarAuthToken = (env.SIDECAR_AUTH_TOKEN ?? "").trim();
  const baseUrl = (env.LIGHTER_BASE_URL ?? "").trim();
  return {
    ...(sidecarUrl ? { sidecarUrl } : {}),
    ...(sidecarAuthToken ? { sidecarAuthToken } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function lighterBaseUrl(environment: string): string {
  return environment === "mainnet" ? LIGHTER_MAINNET_URL : LIGHTER_TESTNET_URL;
}

/** Verifier configured from the process environment (see `.env.example`). */
export function lighterVerifierFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LighterAccountVerifier {
  return new LighterAccountVerifier(lighterVerifierConfigFromEnv(env));
}

function trimReason(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  return text.length > MAX_REASON_LENGTH
    ? `${text.slice(0, MAX_REASON_LENGTH)}…`
    : text;
}

export class LighterAccountVerifier {
  private readonly sidecar?: AxiosInstance;
  private readonly venue?: AxiosInstance;
  private readonly venueUrl: string;

  constructor(
    private readonly config: LighterVerifierConfig,
    deps: { clients?: LighterVerifierClients } = {}
  ) {
    const timeout = config.timeoutMs ?? DEFAULT_LIGHTER_VERIFY_TIMEOUT_MS;
    this.venueUrl = (config.baseUrl ?? "").trim().replace(/\/+$/, "");
    this.sidecar =
      deps.clients?.sidecar ??
      this.createClient(config.sidecarUrl, timeout, config.sidecarAuthToken);
    this.venue =
      deps.clients?.venue ?? this.createClient(this.venueUrl, timeout);
  }

  private get timeout(): number {
    return this.config.timeoutMs ?? DEFAULT_LIGHTER_VERIFY_TIMEOUT_MS;
  }

  private createClient(
    baseURL: string | undefined,
    timeout: number,
    bearer?: string
  ): AxiosInstance | undefined {
    const url = (baseURL ?? "").trim().replace(/\/+$/, "");
    if (!url) return undefined;
    return axios.create({
      baseURL: url,
      timeout,
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });
  }

  /** Full live check: the account exists AND the key belongs to it. */
  async verify(credentials: LighterCredentials): Promise<LighterVerifyResult> {
    if (!this.sidecar) {
      return {
        verified: false,
        error:
          "Lighter signer sidecar is not configured (LIGHTER_SIDECAR_URL); credentials cannot be verified",
      };
    }
    const account = await this.accountExists(credentials);
    if (!account.verified) return account;
    return this.verifyOwnership(credentials);
  }

  /** `GET /api/v1/account` — public, so a wrong index gets its own reason. */
  private async accountExists(
    credentials: LighterCredentials
  ): Promise<LighterVerifyResult> {
    const { accountIndex, environment } = credentials;
    const notFound = {
      verified: false,
      error: `Lighter account ${accountIndex} was not found on ${environment}`,
    };
    const client =
      this.venue ??
      this.createClient(lighterBaseUrl(environment), this.timeout);
    if (!client) {
      return {
        verified: false,
        error: "Lighter venue URL could not be resolved",
      };
    }
    try {
      const response = await client.get("/api/v1/account", {
        params: { by: "index", value: String(accountIndex) },
      });
      const accounts = (response.data as { accounts?: unknown })?.accounts;
      return Array.isArray(accounts) && accounts.length > 0
        ? { verified: true }
        : notFound;
    } catch (error) {
      if (isAxiosError(error)) {
        const status = error.response?.status;
        if (status && status >= 400 && status < 500) return notFound;
      }
      return {
        verified: false,
        error: `Lighter venue unreachable (${this.venueUrlOf(environment)})`,
      };
    }
  }

  private venueUrlOf(environment: string): string {
    return this.venueUrl || lighterBaseUrl(environment);
  }

  /** Ask the sidecar (and through it the venue) to prove key ownership. */
  private async verifyOwnership(
    credentials: LighterCredentials
  ): Promise<LighterVerifyResult> {
    const { accountIndex, apiKeyIndex, privateKey, environment } = credentials;
    const rejected = (reason: string): LighterVerifyResult => ({
      verified: false,
      error: reason
        ? `Lighter rejected the API key for account ${accountIndex}: ${reason}`
        : `Lighter rejected the API key for account ${accountIndex}`,
    });
    if (!this.sidecar) {
      return {
        verified: false,
        error:
          "Lighter signer sidecar is not configured (LIGHTER_SIDECAR_URL); credentials cannot be verified",
      };
    }
    try {
      const response = await this.sidecar.post("/v1/verify-credentials", {
        account_index: accountIndex,
        api_key_index: apiKeyIndex,
        private_key: privateKey,
        env: environment,
      });
      const body = response.data as { ok?: unknown; error?: unknown };
      return body?.ok === true
        ? { verified: true }
        : rejected(trimReason(body?.error));
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        const detail = trimReason(
          (error.response.data as { detail?: unknown })?.detail
        );
        return {
          verified: false,
          error: detail
            ? `Lighter signer sidecar error: ${detail}`
            : `Lighter signer sidecar error (HTTP ${error.response.status})`,
        };
      }
      return {
        verified: false,
        error: `Lighter signer sidecar unreachable at ${
          this.config.sidecarUrl ?? "the configured sidecar URL"
        }`,
      };
    }
  }
}
