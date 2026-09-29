/** @format */

/**
 * ExchangeAccountService (C2) — per-account connect / verify / revoke.
 *
 * Focus areas:
 * - validation happens before any storage or encryption;
 * - the state machine PENDING → ACTIVE | INVALID and the level recompute;
 * - backfilled `kodiak-legacy` wrappers decrypt per field and graduate to a
 *   single-envelope row instead of being marked INVALID.
 */

import type {
  ConnectExchangeAccountRequest,
  ExchangeAccount,
} from "@trade-bot/shared";
import {
  ExchangeAccountService,
  ExchangeAccountServiceDeps,
  EXCHANGE_ENVELOPE_VERSION,
} from "../../src/core/user/exchange-account.service";

const kodiakRequest: ConnectExchangeAccountRequest = {
  exchange: "kodiak",
  environment: "mainnet",
  accountId: "kodiak-account-id",
  apiKey: "ed25519:public-key",
  secretKey: "s".repeat(32),
};

const activeAccount: ExchangeAccount = {
  id: "account-1",
  userId: "test-user-id",
  exchange: "kodiak",
  environment: "mainnet",
  accountRef: "kodiak-account-id",
  status: "ACTIVE",
  verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastVerifiedAt: new Date("2026-01-02T00:00:00.000Z"),
  meta: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

function createDeps(
  overrides: Partial<ExchangeAccountServiceDeps> = {}
): ExchangeAccountServiceDeps {
  return {
    exchangeAccountRepository: {
      listAccounts: jest.fn().mockResolvedValue([activeAccount]),
      getAccountWithSecret: jest.fn().mockResolvedValue(null),
      createPending: jest.fn().mockResolvedValue({
        ...activeAccount,
        status: "PENDING",
      }),
      setStatus: jest.fn().mockResolvedValue(true),
      rewriteEnvelope: jest.fn().mockResolvedValue(true),
      deleteAccount: jest.fn().mockResolvedValue(true),
    },
    encryption: {
      encryptWithVersion: jest.fn().mockResolvedValue("ciphertext"),
      decryptWithVersion: jest.fn().mockResolvedValue("{}"),
      decryptApiKey: jest.fn().mockReturnValue("decrypted-api-key"),
      decryptSecretKey: jest.fn().mockReturnValue("decrypted-secret-key"),
      currentVersion: jest.fn().mockReturnValue(2),
    },
    verifyConnectivity: jest.fn().mockResolvedValue({ verified: true }),
    userLevel: { recompute: jest.fn().mockResolvedValue("VERIFIED") },
    auditLogRepository: { logEvent: jest.fn().mockResolvedValue(undefined) },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...overrides,
  };
}

describe("ExchangeAccountService", () => {
  describe("listAccounts", () => {
    it("should delegate to the repository", async () => {
      const deps = createDeps();
      const service = new ExchangeAccountService(deps);

      const accounts = await service.listAccounts("test-user-id");

      expect(deps.exchangeAccountRepository.listAccounts).toHaveBeenCalledWith(
        "test-user-id"
      );
      expect(accounts).toEqual([activeAccount]);
    });
  });

  describe("connectAccount", () => {
    it("should reject an unknown venue without touching storage", async () => {
      const deps = createDeps();
      const service = new ExchangeAccountService(deps);

      const result = await service.connectAccount("test-user-id", {
        exchange: "not-a-venue",
      } as unknown as ConnectExchangeAccountRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unsupported exchange");
      expect(
        deps.exchangeAccountRepository.createPending
      ).not.toHaveBeenCalled();
      expect(deps.encryption.encryptWithVersion).not.toHaveBeenCalled();
    });

    it("should reject structurally invalid credentials", async () => {
      const deps = createDeps();
      const service = new ExchangeAccountService(deps);

      const result = await service.connectAccount("test-user-id", {
        ...kodiakRequest,
        apiKey: "not-an-ed25519-key",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid API key format");
      expect(
        deps.exchangeAccountRepository.createPending
      ).not.toHaveBeenCalled();
    });

    it("should store a versioned envelope and activate a verified account", async () => {
      const deps = createDeps();
      const service = new ExchangeAccountService(deps);

      const result = await service.connectAccount(
        "test-user-id",
        kodiakRequest
      );

      // Envelope carries the version + venue discriminator plus the payload.
      const envelope = JSON.parse(
        (deps.encryption.encryptWithVersion as jest.Mock).mock.calls[0][0]
      );
      expect(envelope).toMatchObject({
        v: EXCHANGE_ENVELOPE_VERSION,
        kind: "kodiak",
        accountId: "kodiak-account-id",
        apiKey: "ed25519:public-key",
      });

      expect(deps.exchangeAccountRepository.createPending).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test-user-id",
          credentialsEncrypted: "ciphertext",
          encryptionVersion: 2,
        })
      );
      expect(deps.exchangeAccountRepository.setStatus).toHaveBeenCalledWith(
        "test-user-id",
        "account-1",
        "ACTIVE",
        true
      );
      expect(deps.userLevel.recompute).toHaveBeenCalledWith("test-user-id");
      expect(deps.auditLogRepository?.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "EXCHANGE_ACCOUNT_CONNECTED" })
      );
      expect(result.success).toBe(true);
      expect(result.account?.status).toBe("ACTIVE");

      // L5: the connect path names the venue, the environment and the outcome.
      expect(deps.logger?.info).toHaveBeenCalledWith(
        "Exchange account verification started",
        expect.objectContaining({
          userId: "test-user-id",
          exchange: "kodiak",
          environment: "mainnet",
        })
      );
      expect(deps.logger?.info).toHaveBeenCalledWith(
        "Exchange account verification completed",
        expect.objectContaining({
          exchange: "kodiak",
          environment: "mainnet",
          verified: true,
          durationMs: expect.any(Number),
        })
      );
      expect(deps.logger?.info).toHaveBeenCalledWith(
        "Exchange account connected",
        expect.objectContaining({
          exchange: "kodiak",
          environment: "mainnet",
          verificationMs: expect.any(Number),
        })
      );
      expect(deps.logger?.warn).not.toHaveBeenCalled();
    });

    it("never logs credential material on the connect path (L5)", async () => {
      const deps = createDeps();
      const service = new ExchangeAccountService(deps);

      await service.connectAccount("test-user-id", kodiakRequest);

      const logged = JSON.stringify([
        ...(deps.logger?.info as jest.Mock).mock.calls,
        ...(deps.logger?.warn as jest.Mock).mock.calls,
        ...(deps.logger?.error as jest.Mock).mock.calls,
      ]);
      expect(logged).not.toContain(kodiakRequest.secretKey);
      expect(logged).not.toContain(kodiakRequest.apiKey);
    });

    it("should mark the account INVALID when live verification fails", async () => {
      const deps = createDeps({
        verifyConnectivity: jest
          .fn()
          .mockResolvedValue({ verified: false, error: "Bad credentials" }),
      });
      const service = new ExchangeAccountService(deps);

      const result = await service.connectAccount(
        "test-user-id",
        kodiakRequest
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Bad credentials");
      expect(deps.exchangeAccountRepository.setStatus).toHaveBeenCalledWith(
        "test-user-id",
        "account-1",
        "INVALID",
        false
      );
      expect(deps.userLevel.recompute).toHaveBeenCalledWith("test-user-id");
      expect(deps.auditLogRepository?.logEvent).not.toHaveBeenCalled();

      // L5: a failed verify is a warn that names the venue and the reason.
      expect(deps.logger?.warn).toHaveBeenCalledWith(
        "Exchange account verification failed",
        expect.objectContaining({
          exchange: "kodiak",
          environment: "mainnet",
          reason: "Bad credentials",
          durationMs: expect.any(Number),
        })
      );
      expect(deps.logger?.info).not.toHaveBeenCalledWith(
        "Exchange account verification completed",
        expect.anything()
      );
    });

    it("should refuse a duplicate account", async () => {
      const deps = createDeps();
      (
        deps.exchangeAccountRepository.createPending as jest.Mock
      ).mockRejectedValue(
        new Error('duplicate key value violates unique constraint "uq"')
      );
      const service = new ExchangeAccountService(deps);

      const result = await service.connectAccount(
        "test-user-id",
        kodiakRequest
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Account already connected");
    });

    it("should fail cleanly when the envelope cannot be encrypted", async () => {
      const deps = createDeps();
      (deps.encryption.encryptWithVersion as jest.Mock).mockRejectedValue(
        new Error("kms unavailable")
      );
      const service = new ExchangeAccountService(deps);

      const result = await service.connectAccount(
        "test-user-id",
        kodiakRequest
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Encryption failed");
      expect(
        deps.exchangeAccountRepository.createPending
      ).not.toHaveBeenCalled();
    });
  });

  describe("verifyAccount", () => {
    it("should return not-found without touching state", async () => {
      const deps = createDeps();
      const service = new ExchangeAccountService(deps);

      const result = await service.verifyAccount("test-user-id", "account-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Account not found");
      expect(deps.exchangeAccountRepository.setStatus).not.toHaveBeenCalled();
    });

    it("should mark an unreadable envelope INVALID", async () => {
      const deps = createDeps();
      (
        deps.exchangeAccountRepository.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...activeAccount,
        credentialsEncrypted: "not-json-and-not-decryptable",
        encryptionVersion: 2,
      });
      (deps.encryption.decryptWithVersion as jest.Mock).mockRejectedValue(
        new Error("bad ciphertext")
      );
      const service = new ExchangeAccountService(deps);

      const result = await service.verifyAccount("test-user-id", "account-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Decryption failed");
      expect(deps.exchangeAccountRepository.setStatus).toHaveBeenCalledWith(
        "test-user-id",
        "account-1",
        "INVALID",
        false
      );
      expect(deps.userLevel.recompute).toHaveBeenCalledWith("test-user-id");
    });

    it("should verify a current envelope without rewriting it", async () => {
      const deps = createDeps();
      (
        deps.exchangeAccountRepository.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...activeAccount,
        credentialsEncrypted: "versioned-ciphertext",
        encryptionVersion: 2,
      });
      (deps.encryption.decryptWithVersion as jest.Mock).mockResolvedValue(
        JSON.stringify({
          v: EXCHANGE_ENVELOPE_VERSION,
          kind: "kodiak",
          accountId: "kodiak-account-id",
          apiKey: "ed25519:public-key",
          secretKey: "s".repeat(32),
        })
      );
      const service = new ExchangeAccountService(deps);

      const result = await service.verifyAccount("test-user-id", "account-1");

      expect(result.success).toBe(true);
      expect(deps.verifyConnectivity).toHaveBeenCalledWith(
        expect.objectContaining({
          exchange: "kodiak",
          environment: "mainnet",
          accountId: "kodiak-account-id",
        })
      );
      expect(
        deps.exchangeAccountRepository.rewriteEnvelope
      ).not.toHaveBeenCalled();
      expect(deps.exchangeAccountRepository.setStatus).toHaveBeenCalledWith(
        "test-user-id",
        "account-1",
        "ACTIVE",
        true
      );
      // L5: a successful re-verify is logged with the venue it was checked against.
      expect(deps.logger?.info).toHaveBeenCalledWith(
        "Exchange account verified",
        expect.objectContaining({
          accountId: "account-1",
          exchange: "kodiak",
          environment: "mainnet",
          durationMs: expect.any(Number),
        })
      );
    });

    it("should graduate a backfilled kodiak-legacy wrapper on verify", async () => {
      const deps = createDeps();
      (
        deps.exchangeAccountRepository.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...activeAccount,
        status: "PENDING",
        credentialsEncrypted: JSON.stringify({
          v: 1,
          kind: "kodiak-legacy",
          accountId: "kodiak-account-id",
          apiKeyCipher: "legacy-api-key-cipher",
          secretKeyCipher: "legacy-secret-key-cipher",
        }),
        encryptionVersion: 2,
      });
      // The wrapper column is plaintext JSON — the versioned decrypt fails.
      (deps.encryption.decryptWithVersion as jest.Mock).mockRejectedValue(
        new Error("not a versioned envelope")
      );
      (deps.encryption.decryptApiKey as jest.Mock).mockImplementation(
        (blob: string) => {
          if (blob === "legacy-api-key-cipher") return "ed25519:public-key";
          throw new Error("not an api-key blob");
        }
      );
      (deps.encryption.decryptSecretKey as jest.Mock).mockImplementation(
        (blob: string) => {
          if (blob === "legacy-secret-key-cipher") return "s".repeat(32);
          throw new Error("not a secret-key blob");
        }
      );
      const service = new ExchangeAccountService(deps);

      const result = await service.verifyAccount("test-user-id", "account-1");

      expect(result.success).toBe(true);
      expect(deps.verifyConnectivity).toHaveBeenCalledWith(
        expect.objectContaining({
          exchange: "kodiak",
          accountId: "kodiak-account-id",
          apiKey: "ed25519:public-key",
          secretKey: "s".repeat(32),
        })
      );
      // Graduation rewrites the row as one versioned envelope.
      const graduated = JSON.parse(
        (deps.encryption.encryptWithVersion as jest.Mock).mock.calls[0][0]
      );
      expect(graduated).toMatchObject({
        v: EXCHANGE_ENVELOPE_VERSION,
        kind: "kodiak",
        apiKey: "ed25519:public-key",
      });
      expect(
        deps.exchangeAccountRepository.rewriteEnvelope
      ).toHaveBeenCalledWith("test-user-id", "account-1", "ciphertext", 2);
      expect(deps.exchangeAccountRepository.setStatus).toHaveBeenCalledWith(
        "test-user-id",
        "account-1",
        "ACTIVE",
        true
      );
    });

    it("should mark the account INVALID when the venue rejects it", async () => {
      const deps = createDeps({
        verifyConnectivity: jest
          .fn()
          .mockResolvedValue({ verified: false, error: "revoked key" }),
      });
      (
        deps.exchangeAccountRepository.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...activeAccount,
        credentialsEncrypted: "versioned-ciphertext",
        encryptionVersion: 2,
      });
      (deps.encryption.decryptWithVersion as jest.Mock).mockResolvedValue(
        JSON.stringify({
          v: EXCHANGE_ENVELOPE_VERSION,
          kind: "kodiak",
          accountId: "kodiak-account-id",
          apiKey: "ed25519:public-key",
          secretKey: "s".repeat(32),
        })
      );
      const service = new ExchangeAccountService(deps);

      const result = await service.verifyAccount("test-user-id", "account-1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("revoked key");
      expect(deps.exchangeAccountRepository.setStatus).toHaveBeenCalledWith(
        "test-user-id",
        "account-1",
        "INVALID",
        false
      );
    });
  });

  describe("revokeAccount", () => {
    it("should delete the account, recompute the level and audit", async () => {
      const deps = createDeps();
      const service = new ExchangeAccountService(deps);

      const result = await service.revokeAccount("test-user-id", "account-1");

      expect(deps.exchangeAccountRepository.deleteAccount).toHaveBeenCalledWith(
        "test-user-id",
        "account-1"
      );
      expect(deps.userLevel.recompute).toHaveBeenCalledWith("test-user-id");
      expect(deps.auditLogRepository?.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "EXCHANGE_ACCOUNT_REVOKED" })
      );
      expect(result.success).toBe(true);
    });

    it("should report not found and skip the recompute", async () => {
      const deps = createDeps();
      (
        deps.exchangeAccountRepository.deleteAccount as jest.Mock
      ).mockResolvedValue(false);
      const service = new ExchangeAccountService(deps);

      const result = await service.revokeAccount("test-user-id", "account-1");

      expect(result.success).toBe(false);
      expect(result.message).toBe("Account not found");
      expect(deps.userLevel.recompute).not.toHaveBeenCalled();
    });

    it("should block the revoke while live bots are bound (FK RESTRICT, C3a)", async () => {
      const deps = createDeps({
        boundBots: {
          countBoundBots: jest.fn().mockResolvedValue(2),
          clearTerminalBots: jest.fn(),
        },
      });
      const service = new ExchangeAccountService(deps);

      const result = await service.revokeAccount("test-user-id", "account-1");

      expect(result.success).toBe(false);
      expect(result.boundBots).toBe(2);
      expect(result.message).toContain("2 active bots bound");
      // Nothing is cleared or deleted and the level is untouched: the
      // account still holds live bots.
      expect(deps.boundBots?.clearTerminalBots).not.toHaveBeenCalled();
      expect(
        deps.exchangeAccountRepository.deleteAccount
      ).not.toHaveBeenCalled();
      expect(deps.userLevel.recompute).not.toHaveBeenCalled();
    });

    it("should clear terminal history and revoke when no live bot is bound", async () => {
      const deps = createDeps({
        boundBots: {
          countBoundBots: jest.fn().mockResolvedValue(0),
          clearTerminalBots: jest.fn().mockResolvedValue(11),
        },
      });
      const service = new ExchangeAccountService(deps);

      const result = await service.revokeAccount("test-user-id", "account-1");

      expect(result.success).toBe(true);
      expect(deps.boundBots?.countBoundBots).toHaveBeenCalledWith(
        "test-user-id",
        "account-1"
      );
      expect(deps.boundBots?.clearTerminalBots).toHaveBeenCalledWith(
        "test-user-id",
        "account-1"
      );
      expect(deps.exchangeAccountRepository.deleteAccount).toHaveBeenCalledWith(
        "test-user-id",
        "account-1"
      );
      expect(result.clearedBots).toBe(11);
      expect(result.message).toContain("11 stopped bots cleared");
      expect(deps.auditLogRepository?.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "EXCHANGE_ACCOUNT_REVOKED",
          details: expect.objectContaining({
            accountId: "account-1",
            clearedBots: 11,
          }),
        })
      );
    });

    it("should revoke normally when no bot is bound", async () => {
      const deps = createDeps({
        boundBots: {
          countBoundBots: jest.fn().mockResolvedValue(0),
          clearTerminalBots: jest.fn().mockResolvedValue(0),
        },
      });
      const service = new ExchangeAccountService(deps);

      const result = await service.revokeAccount("test-user-id", "account-1");

      expect(result.success).toBe(true);
      expect(deps.boundBots?.countBoundBots).toHaveBeenCalledWith(
        "test-user-id",
        "account-1"
      );
      expect(deps.exchangeAccountRepository.deleteAccount).toHaveBeenCalledWith(
        "test-user-id",
        "account-1"
      );
    });
  });
});
