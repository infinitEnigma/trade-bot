/** @format */

/**
 * Lighter signing-sidecar HTTP client (workstream B2).
 *
 * Thin adapter of the `TransactionSigner` domain contract onto
 * `sidecar/lighter-signer` (`GET /health`, `POST /v1/create-order`,
 * `POST /v1/cancel-order`, `POST /v1/auth-token`).
 *
 * This is the ONLY engine module (besides `exchanges/lighter/`, landing in
 * B3) that may name Lighter specifics — endpoint paths, snake_case bodies,
 * `LIGHTER_SIDECAR_URL` / `SIDECAR_AUTH_TOKEN` (EXCHANGE_INTEGRATION_PLAN.md
 * §0). Everything upstream speaks `TransactionSigner` only.
 *
 * Security model (mirrors the sidecar README):
 * - Credentials travel per request and are held in memory only.
 * - They are NEVER logged — error paths and log metadata carry indices and
 *   market/order identifiers, never the private key.
 * - The service is expected on loopback; an optional bearer token
 *   (`SIDECAR_AUTH_TOKEN`) is sent when configured.
 * - Unreachable sidecar ⇒ `SignerUnreachableError` ⇒ the caller freezes the
 *   affected slots instead of re-placing orders.
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import { DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS } from "../../domain/exchange";
import {
  SignCancelRequest,
  SignerCredentials,
  SignerError,
  SignerUnreachableError,
  SignOrderRequest,
  TransactionSigner,
} from "../../domain/signer";
import { logger } from "../../utils/logger";

export interface LighterSidecarConfig {
  /** Sidecar base URL, e.g. `http://127.0.0.1:8790`. */
  baseUrl: string;
  /** Optional shared secret sent as `Authorization: Bearer <token>`. */
  authToken?: string;
  /** Per-request HTTP timeout (ms). Defaults to the shared exchange bound. */
  timeoutMs?: number;
}

export interface SidecarOk {
  ok: true;
  tx_hash?: unknown;
  client_order_index?: unknown;
  order_index?: unknown;
  token?: unknown;
}

export interface SidecarFail {
  ok: false;
  error?: unknown;
}

export type SidecarResponse = SidecarOk | SidecarFail;

/**
 * Resolve sidecar config from the environment. `LIGHTER_SIDECAR_URL` and
 * `SIDECAR_AUTH_TOKEN` are documented in `.env.example`.
 */
export function lighterSidecarConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LighterSidecarConfig {
  const baseUrl = (env.LIGHTER_SIDECAR_URL ?? "").trim();
  if (!baseUrl) {
    throw new SignerError(
      "LIGHTER_SIDECAR_URL is not set (sidecar/lighter-signer, default http://127.0.0.1:8790)"
    );
  }
  const authToken = (env.SIDECAR_AUTH_TOKEN ?? "").trim();
  return { baseUrl, ...(authToken ? { authToken } : {}) };
}

/** Map the sidecar's snake_case credential body from domain credentials. */
function toCredentialBody(credentials: SignerCredentials) {
  return {
    account_index: credentials.accountIndex,
    api_key_index: credentials.apiKeyIndex,
    private_key: credentials.privateKey,
    env: credentials.env,
  };
}

/** Describe a call for logs without ever including the private key. */
function describeCall(
  credentials: SignerCredentials,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    accountIndex: credentials.accountIndex,
    apiKeyIndex: credentials.apiKeyIndex,
    env: credentials.env,
    ...extra,
  };
}

export class LighterSidecarSigner implements TransactionSigner {
  private readonly client: AxiosInstance;
  private readonly bearer?: string;

  constructor(config: LighterSidecarConfig) {
    const baseUrl = config.baseUrl.replace(/\/+$/, "");
    if (!baseUrl) {
      throw new SignerError("LighterSidecarSigner requires a baseUrl");
    }
    this.bearer = config.authToken?.trim() || undefined;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: config.timeoutMs ?? DEFAULT_EXCHANGE_HTTP_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
    });
  }

  async isReachable(): Promise<boolean> {
    try {
      const response = await this.client.get("/health", {
        headers: this.authHeaders(),
      });
      return response.data?.status === "ok";
    } catch {
      return false;
    }
  }

  async createOrder(
    credentials: SignerCredentials,
    request: SignOrderRequest
  ): Promise<{ txHash: string; clientOrderIndex: number }> {
    const body = {
      ...toCredentialBody(credentials),
      market_index: request.marketIndex,
      client_order_index: request.clientOrderIndex,
      base_amount: request.baseAmount,
      price: request.price,
      is_ask: request.isAsk,
      order_type: request.orderType ?? 0,
      time_in_force: request.timeInForce ?? 0,
      reduce_only: request.reduceOnly ?? false,
      trigger_price: request.triggerPrice ?? 0,
      order_expiry: request.orderExpiry ?? -1,
    };
    const data = await this.post<SidecarResponse>(
      "/v1/create-order",
      body,
      describeCall(credentials, {
        marketIndex: request.marketIndex,
        clientOrderIndex: request.clientOrderIndex,
      })
    );
    if (data.ok !== true) {
      throw new SignerError(
        `sidecar refused create-order: ${sidecarErrorOf(data)}`
      );
    }
    if (typeof data.tx_hash !== "string" || !data.tx_hash) {
      throw new SignerError("sidecar create-order response missing tx_hash");
    }
    return { txHash: data.tx_hash, clientOrderIndex: request.clientOrderIndex };
  }

  async cancelOrder(
    credentials: SignerCredentials,
    request: SignCancelRequest
  ): Promise<{ txHash: string; orderIndex: number }> {
    const body = {
      ...toCredentialBody(credentials),
      market_index: request.marketIndex,
      order_index: request.orderIndex,
    };
    const data = await this.post<SidecarResponse>(
      "/v1/cancel-order",
      body,
      describeCall(credentials, {
        marketIndex: request.marketIndex,
        orderIndex: request.orderIndex,
      })
    );
    if (data.ok !== true) {
      throw new SignerError(
        `sidecar refused cancel-order: ${sidecarErrorOf(data)}`
      );
    }
    if (typeof data.tx_hash !== "string" || !data.tx_hash) {
      throw new SignerError("sidecar cancel-order response missing tx_hash");
    }
    return { txHash: data.tx_hash, orderIndex: request.orderIndex };
  }

  async authToken(
    credentials: SignerCredentials,
    deadlineSeconds = 600
  ): Promise<string> {
    const body = {
      ...toCredentialBody(credentials),
      deadline_seconds: deadlineSeconds,
    };
    const data = await this.post<SidecarResponse>(
      "/v1/auth-token",
      body,
      describeCall(credentials, { deadlineSeconds })
    );
    if (data.ok !== true) {
      throw new SignerError(
        `sidecar refused auth-token: ${sidecarErrorOf(data)}`
      );
    }
    if (typeof data.token !== "string" || !data.token) {
      throw new SignerError("sidecar auth-token response missing token");
    }
    return data.token;
  }

  private authHeaders(): Record<string, string> {
    return this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {};
  }

  private async post<T>(
    path: string,
    body: unknown,
    describe: object
  ): Promise<T> {
    try {
      const response = await this.client.post(path, body, {
        headers: this.authHeaders(),
      });
      return response.data as T;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const err = error as AxiosError<{ detail?: unknown }>;
        if (isUnreachable(err)) {
          logger.warn("Lighter sidecar unreachable", describe);
          throw new SignerUnreachableError(
            `lighter sidecar unreachable: ${unreachableDetail(err)}`
          );
        }
        throw new SignerError(
          `lighter sidecar request failed: ${sidecarDetailOf(err)}`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SignerError(`lighter sidecar request failed: ${message}`);
    }
  }
}

function sidecarErrorOf(data: SidecarResponse): string {
  if (data.ok === false) {
    const fail = data as SidecarFail;
    return typeof fail.error === "string" && fail.error
      ? fail.error
      : "unknown sidecar error";
  }
  return "unknown sidecar error";
}

function isUnreachable(err: AxiosError): boolean {
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") return true;
  if (err.response === undefined) return true;
  return (err.response?.status ?? 0) >= 500;
}

function unreachableDetail(err: AxiosError): string {
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
    return `request timed out: ${err.message}`;
  }
  const status = err.response?.status;
  if (status !== undefined) return `responded ${status}`;
  return err.message;
}

function sidecarDetailOf(err: AxiosError<{ detail?: unknown }>): string {
  const status = err.response?.status;
  const detail = err.response?.data?.detail;
  const detailStr = typeof detail === "string" && detail ? `: ${detail}` : "";
  return status !== undefined ? `status ${status}${detailStr}` : err.message;
}
