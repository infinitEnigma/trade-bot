/**
 * ExchangeAccountService (C2) — per-account connect / verify / revoke.
 *
 * Replaces KodiakConnectionService + UserKodiakService internals.
 * Connect: venue-adapter validation → JSON payload → single-envelope
 * `encryptWithVersion` (Q1) → PENDING row → live verify → ACTIVE/INVALID
 * + lazy envelope graduation for backfilled `kodiak-legacy` wrappers.
 * Every transition recomputes the user level (UserLevelService).
 *
 * @format
 */

import type {
  ConnectExchangeAccountRequest,
  ExchangeAccount,
  ExchangeAccountStatus,
} from "@trade-bot/shared";
import { getCredentialAdapter } from "../../infrastructure/external/exchange-accounts/credential-adapters";

export interface ExchangeAccountServiceDeps {
  exchangeAccountRepository: {
    listAccounts(userId: string): Promise<ExchangeAccount[]>;
    getAccountWithSecret(
      userId: string,
      accountId: string
    ): Promise<
      | (ExchangeAccount & {
          credentialsEncrypted: string;
          encryptionVersion: number | null;
        })
      | null
    >;
    createPending(input: {
      userId: string;
      request: ConnectExchangeAccountRequest;
      credentialsEncrypted: string;
      encryptionVersion: number | null;
    }): Promise<ExchangeAccount>;
    setStatus(
      userId: string,
      accountId: string,
      status: ExchangeAccountStatus,
      verified: boolean
    ): Promise<boolean>;
    rewriteEnvelope(
      userId: string,
      accountId: string,
      credentialsEncrypted: string,
      encryptionVersion: number | null
    ): Promise<boolean>;
    deleteAccount(userId: string, accountId: string): Promise<boolean>;
  };
  encryption: {
    encryptWithVersion(plaintext: string): Promise<string>;
    decryptWithVersion(ciphertext: string): Promise<string>;
    decryptApiKey(ciphertext: string): string;
    decryptSecretKey(ciphertext: string): string;
    currentVersion(): number;
  };
  verifyConnectivity: (
    request: ConnectExchangeAccountRequest
  ) => Promise<{ verified: boolean; error?: string }>;
  userLevel: { recompute(userId: string): Promise<unknown> };
  /**
   * Profile-cache invalidation hook (Fix B). The user profile
   * (`user:profile:{userId}`, TTL 300s) caches `userLevel`; every account
   * transition that recomputes the level must also clear it, otherwise
   * `GET /api/user/profile` serves a stale REGISTERED until TTL expiry.
   * Optional so unit tests can omit it; routes wire the real service.
   */
  onLevelChanged?: (userId: string) => Promise<unknown>;
  /**
   * C3a: bots bound to the account. `countBoundBots` returns how many
   * *live* `bot_instances` rows reference it (`actual_state` in
   * STARTING/RUNNING/STOPPING — the only states that may still trade on the
   * engine). Terminal history (STOPPED/ERROR/UNKNOWN) never blocks a revoke:
   * it cannot trade, so `revokeAccount` clears it first and the FK
   * (ON DELETE RESTRICT, migration 013) only ever guards live bots.
   */
  boundBots?: {
    countBoundBots(userId: string, accountId: string): Promise<number>;
    clearTerminalBots(userId: string, accountId: string): Promise<number>;
  };
  auditLogRepository?: {
    logEvent(event: {
      userId: string | null;
      action: string;
      details: Record<string, unknown>;
    }): Promise<void>;
  };
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface ConnectResult {
  success: boolean;
  message: string;
  account?: ExchangeAccount;
  error?: string;
}

export const EXCHANGE_ENVELOPE_VERSION = 1;

export class ExchangeAccountService {
  constructor(private deps: ExchangeAccountServiceDeps) {}

  async listAccounts(userId: string): Promise<ExchangeAccount[]> {
    return this.deps.exchangeAccountRepository.listAccounts(userId);
  }

  async connectAccount(
    userId: string,
    request: ConnectExchangeAccountRequest
  ): Promise<ConnectResult> {
    const adapter = getCredentialAdapter(request.exchange);
    if (!adapter) {
      return {
        success: false,
        message: "Unsupported exchange",
        error: "Unsupported exchange",
      };
    }
    const validation = adapter.validate(request);
    if (!validation.valid) {
      return {
        success: false,
        message: validation.error ?? "Invalid connection data",
        error: validation.error,
      };
    }

    const plaintext = adapter.toPlaintext(request);
    const envelope = JSON.stringify({
      v: EXCHANGE_ENVELOPE_VERSION,
      kind: request.exchange,
      ...plaintext,
    });
    let credentialsEncrypted: string;
    let encryptionVersion: number | null;
    try {
      credentialsEncrypted =
        await this.deps.encryption.encryptWithVersion(envelope);
      encryptionVersion = this.deps.encryption.currentVersion();
    } catch (error) {
      this.deps.logger?.error("Account envelope encryption failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: "Failed to store credentials",
        error: "Encryption failed",
      };
    }

    let account: ExchangeAccount;
    try {
      account = await this.deps.exchangeAccountRepository.createPending({
        userId,
        request,
        credentialsEncrypted,
        encryptionVersion,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate key|unique constraint/i.test(message)) {
        // Fix B: a stranded INVALID/PENDING row for the same
        // (user, exchange, environment, account_ref) must not block a retry
        // with corrected credentials — Lighter rotations reuse the account
        // index, so the unique key is identical. An ACTIVE row stays blocked
        // (genuine duplicate); a dead row is replaced with the new envelope.
        const replaced = await this.replaceDeadDuplicate(
          userId,
          request,
          credentialsEncrypted,
          encryptionVersion
        );
        if (replaced) return replaced;
        return {
          success: false,
          message: "This account is already connected",
          error: "Account already connected",
        };
      }
      throw error;
    }

    const verificationStartedAt = Date.now();
    this.deps.logger?.info("Exchange account verification started", {
      userId,
      accountId: account.id,
      exchange: request.exchange,
      environment: request.environment,
    });
    const live = await this.deps.verifyConnectivity(request);
    const verificationMs = Date.now() - verificationStartedAt;
    if (!live.verified) {
      this.deps.logger?.warn("Exchange account verification failed", {
        userId,
        accountId: account.id,
        exchange: request.exchange,
        environment: request.environment,
        durationMs: verificationMs,
        reason: live.error,
      });
      await this.deps.exchangeAccountRepository.setStatus(
        userId,
        account.id,
        "INVALID",
        false
      );
      await this.deps.userLevel.recompute(userId);
      await this.notifyLevelChanged(userId);
      return {
        success: false,
        message: live.error ?? "Credential verification failed",
        error: live.error,
      };
    }
    this.deps.logger?.info("Exchange account verification completed", {
      userId,
      accountId: account.id,
      exchange: request.exchange,
      environment: request.environment,
      verified: true,
      durationMs: verificationMs,
    });

    await this.deps.exchangeAccountRepository.setStatus(
      userId,
      account.id,
      "ACTIVE",
      true
    );
    const level = await this.deps.userLevel.recompute(userId);
    await this.notifyLevelChanged(userId);
    try {
      await this.deps.auditLogRepository?.logEvent({
        userId,
        action: "EXCHANGE_ACCOUNT_CONNECTED",
        details: {
          accountId: account.id,
          exchange: request.exchange,
          environment: request.environment,
        },
      });
    } catch {
      this.deps.logger?.warn("Failed to audit account connect", { userId });
    }
    const accounts =
      await this.deps.exchangeAccountRepository.listAccounts(userId);
    const connected = accounts.find(a => a.id === account.id) ?? {
      ...account,
      status: "ACTIVE" as const,
    };
    this.deps.logger?.info("Exchange account connected", {
      userId,
      accountId: account.id,
      exchange: request.exchange,
      environment: request.environment,
      verificationMs,
      userLevel: level,
    });
    return {
      success: true,
      message: "Exchange account connected",
      account: connected,
    };
  }

  async verifyAccount(
    userId: string,
    accountId: string
  ): Promise<ConnectResult> {
    const stored =
      await this.deps.exchangeAccountRepository.getAccountWithSecret(
        userId,
        accountId
      );
    if (!stored) {
      return {
        success: false,
        message: "Account not found",
        error: "Account not found",
      };
    }
    const request = await this.decodeForVerify(stored);
    if (!request) {
      await this.deps.exchangeAccountRepository.setStatus(
        userId,
        accountId,
        "INVALID",
        false
      );
      await this.deps.userLevel.recompute(userId);
      await this.notifyLevelChanged(userId);
      return {
        success: false,
        message: "Stored credentials are unreadable",
        error: "Decryption failed",
      };
    }
    const verificationStartedAt = Date.now();
    this.deps.logger?.info("Exchange account verification started", {
      userId,
      accountId,
      exchange: request.exchange,
      environment: request.environment,
    });
    const live = await this.deps.verifyConnectivity(request);
    const verificationMs = Date.now() - verificationStartedAt;
    if (!live.verified) {
      this.deps.logger?.warn("Exchange account verification failed", {
        userId,
        accountId,
        exchange: request.exchange,
        environment: request.environment,
        durationMs: verificationMs,
        reason: live.error,
      });
      await this.deps.exchangeAccountRepository.setStatus(
        userId,
        accountId,
        "INVALID",
        false
      );
      await this.deps.userLevel.recompute(userId);
      await this.notifyLevelChanged(userId);
      return {
        success: false,
        message: live.error ?? "Verification failed",
        error: live.error,
      };
    }
    await this.graduateEnvelopeIfLegacy(
      userId,
      accountId,
      stored.credentialsEncrypted,
      request
    );
    await this.deps.exchangeAccountRepository.setStatus(
      userId,
      accountId,
      "ACTIVE",
      true
    );
    await this.deps.userLevel.recompute(userId);
    await this.notifyLevelChanged(userId);
    const accounts =
      await this.deps.exchangeAccountRepository.listAccounts(userId);
    const verified = accounts.find(a => a.id === accountId) ?? {
      ...stored,
      status: "ACTIVE" as const,
    };
    this.deps.logger?.info("Exchange account verified", {
      userId,
      accountId,
      exchange: request.exchange,
      environment: request.environment,
      durationMs: verificationMs,
    });
    return { success: true, message: "Account verified", account: verified };
  }

  async revokeAccount(
    userId: string,
    accountId: string
  ): Promise<{
    success: boolean;
    message: string;
    boundBots?: number;
    clearedBots?: number;
  }> {
    // C3a: the FK is ON DELETE RESTRICT — an account with *live* bots bound
    // cannot be hard-deleted. Block with a clear message instead of leaking
    // the FK violation. Terminal history (STOPPED/ERROR/UNKNOWN) cannot
    // trade, so it is cleared first and never blocks the revoke — otherwise
    // a venue-side wipe (e.g. Lighter testnet reset) deadlocks the user:
    // they can neither disconnect nor re-connect the replacement.
    let clearedBots = 0;
    if (this.deps.boundBots) {
      const bound = await this.deps.boundBots.countBoundBots(userId, accountId);
      if (bound > 0) {
        return {
          success: false,
          message: `Account has ${bound} active bot${bound === 1 ? "" : "s"} bound to it. Stop or delete the bots first.`,
          boundBots: bound,
        };
      }
      clearedBots = await this.deps.boundBots.clearTerminalBots(
        userId,
        accountId
      );
    }
    const deleted = await this.deps.exchangeAccountRepository.deleteAccount(
      userId,
      accountId
    );
    if (!deleted) return { success: false, message: "Account not found" };
    await this.deps.userLevel.recompute(userId);
    await this.notifyLevelChanged(userId);
    try {
      await this.deps.auditLogRepository?.logEvent({
        userId,
        action: "EXCHANGE_ACCOUNT_REVOKED",
        details: { accountId, clearedBots },
      });
    } catch {
      this.deps.logger?.warn("Failed to audit account revoke", { userId });
    }
    return {
      success: true,
      message:
        clearedBots > 0
          ? `Exchange account disconnected (${clearedBots} stopped bot${clearedBots === 1 ? "" : "s"} cleared)`
          : "Exchange account disconnected",
      clearedBots,
    };
  }

  /**
   * Replace a dead duplicate row (INVALID/PENDING) with fresh credentials.
   *
   * Returns the full connect result when a dead row was found and replaced,
   * or null when the duplicate is a live row that must stay blocked. The
   * replacement deletes the dead row and re-runs the normal connect path so
   * verification + level recompute stay in one place.
   */
  private async replaceDeadDuplicate(
    userId: string,
    request: ConnectExchangeAccountRequest,
    credentialsEncrypted: string,
    encryptionVersion: number | null
  ): Promise<ConnectResult | null> {
    const adapter = getCredentialAdapter(request.exchange);
    const accountRef = adapter ? adapter.accountRef(request) : null;
    if (!accountRef) return null;
    const accounts =
      await this.deps.exchangeAccountRepository.listAccounts(userId);
    const dead = accounts.find(
      a =>
        a.exchange === request.exchange &&
        a.environment === request.environment &&
        a.accountRef === accountRef &&
        (a.status === "INVALID" || a.status === "PENDING")
    );
    if (!dead) return null;
    this.deps.logger?.info("Replacing dead duplicate account on retry", {
      userId,
      accountId: dead.id,
      exchange: request.exchange,
      environment: request.environment,
      previousStatus: dead.status,
    });
    await this.deps.exchangeAccountRepository.deleteAccount(userId, dead.id);
    // Re-run the normal path with the fresh envelope (recursion depth 1:
    // the dead row is gone, so a second duplicate means a live row won the
    // race and the recursive call returns the blocked-duplicate result).
    void credentialsEncrypted;
    void encryptionVersion;
    return this.connectAccount(userId, request);
  }

  /**
   * Best-effort profile-cache invalidation after any level recompute.
   * Failures only warn — the level write already landed; the cache TTL
   * (300s) bounds the staleness.
   */
  private async notifyLevelChanged(userId: string): Promise<void> {
    try {
      await this.deps.onLevelChanged?.(userId);
    } catch (error) {
      this.deps.logger?.warn("Profile cache invalidation failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Decode a stored envelope back into a connect request for live verify.
   *
   * Two on-disk shapes must be understood (migration 012):
   * - current rows: one versioned decrypt → plaintext JSON `{v, kind, …}`;
   * - backfilled `kodiak-legacy` wrappers: plaintext JSON whose
   *   `apiKeyCipher`/`secretKeyCipher` are the untouched legacy per-field
   *   ciphertext blobs. Without this branch a backfilled row could never
   *   graduate — verify would mark it INVALID before graduation ran.
   */
  private async decodeForVerify(
    stored: ExchangeAccount & { credentialsEncrypted: string }
  ): Promise<ConnectExchangeAccountRequest | null> {
    // Current rows: versioned single envelope → plaintext JSON.
    try {
      const plaintext = await this.deps.encryption.decryptWithVersion(
        stored.credentialsEncrypted
      );
      const parsed = JSON.parse(plaintext) as Record<string, unknown>;
      const request = this.envelopeToRequest(parsed, stored);
      if (request) return request;
    } catch {
      // Not a versioned envelope — fall through to the legacy wrapper path.
    }

    // Backfilled legacy wrapper: per-field blobs, decrypt field by field.
    try {
      const wrapper = JSON.parse(stored.credentialsEncrypted) as {
        kind?: unknown;
        accountId?: unknown;
        apiKeyCipher?: unknown;
        secretKeyCipher?: unknown;
      };
      if (wrapper.kind !== "kodiak-legacy") return null;
      if (
        typeof wrapper.accountId !== "string" ||
        typeof wrapper.apiKeyCipher !== "string" ||
        typeof wrapper.secretKeyCipher !== "string"
      ) {
        return null;
      }
      const [apiKey, secretKey] = await Promise.all([
        this.decryptFieldBlob(wrapper.apiKeyCipher),
        this.decryptFieldBlob(wrapper.secretKeyCipher),
      ]);
      return {
        exchange: "kodiak",
        environment: stored.environment,
        accountId: wrapper.accountId,
        apiKey,
        secretKey,
      };
    } catch {
      return null;
    }
  }

  /**
   * Decrypt one legacy per-field blob, mirroring the credentials provider:
   * the legacy helpers first (api-key then secret-key — the column name was
   * not always truthful), then the versioned path for blobs rewritten by a
   * key rotation.
   */
  private async decryptFieldBlob(blob: string): Promise<string> {
    try {
      return this.deps.encryption.decryptApiKey(blob);
    } catch {
      // Not an api-key blob — try the other legacy helper.
    }
    try {
      return this.deps.encryption.decryptSecretKey(blob);
    } catch {
      // Not a secret-key blob either — try the versioned path.
    }
    return this.deps.encryption.decryptWithVersion(blob);
  }

  /** Structural guard: a decrypted envelope must be a usable request. */
  private envelopeToRequest(
    parsed: Record<string, unknown>,
    stored: ExchangeAccount
  ): ConnectExchangeAccountRequest | null {
    if (parsed.kind === "kodiak" || parsed.kind === undefined) {
      if (
        typeof parsed.accountId === "string" &&
        typeof parsed.apiKey === "string" &&
        typeof parsed.secretKey === "string"
      ) {
        return {
          exchange: "kodiak",
          environment: stored.environment,
          accountId: parsed.accountId,
          apiKey: parsed.apiKey,
          secretKey: parsed.secretKey,
        };
      }
      return null;
    }
    if (parsed.kind === "lighter") {
      if (
        typeof parsed.accountIndex === "number" &&
        typeof parsed.apiKeyIndex === "number" &&
        typeof parsed.privateKey === "string"
      ) {
        return {
          exchange: "lighter",
          environment: stored.environment,
          accountIndex: parsed.accountIndex,
          apiKeyIndex: parsed.apiKeyIndex,
          privateKey: parsed.privateKey,
        };
      }
    }
    return null;
  }

  private async graduateEnvelopeIfLegacy(
    userId: string,
    accountId: string,
    envelope: string,
    request: ConnectExchangeAccountRequest
  ): Promise<void> {
    try {
      const parsed = JSON.parse(envelope) as Record<string, unknown>;
      if (parsed.kind !== "kodiak-legacy") return;
      const adapter = getCredentialAdapter(request.exchange);
      if (!adapter) return;
      const fresh = JSON.stringify({
        v: EXCHANGE_ENVELOPE_VERSION,
        kind: request.exchange,
        ...adapter.toPlaintext(request),
      });
      const encrypted = await this.deps.encryption.encryptWithVersion(fresh);
      await this.deps.exchangeAccountRepository.rewriteEnvelope(
        userId,
        accountId,
        encrypted,
        this.deps.encryption.currentVersion()
      );
    } catch {
      this.deps.logger?.warn("Envelope graduation failed", {
        userId,
        accountId,
      });
    }
  }
}
