/** @format */

/**
 * ExchangeAccountRepositoryAdapter (C2) — generic venue/environment accounts.
 *
 * The adapter never touches plaintext or decrypts: envelopes are stored and
 * returned verbatim (backfilled `kodiak-legacy` wrappers included).
 */

import {
  BotBoundAccountDeps,
  ExchangeAccountRepositoryAdapter,
  exchangeAccountRepositoryAdapter,
  getBotBoundAccountSecrets,
} from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";
import { query } from "../../src/database/pool";

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
}));

const mockQuery = query as jest.Mock;

const accountRow = (overrides: Record<string, unknown> = {}) => ({
  id: "account-1",
  user_id: "test-user-id",
  exchange: "kodiak",
  environment: "mainnet",
  account_ref: "kodiak-account-id",
  status: "ACTIVE",
  verified_at: "2026-01-01T00:00:00.000Z",
  last_verified_at: "2026-01-02T00:00:00.000Z",
  meta: { backfilled: true },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

describe("ExchangeAccountRepositoryAdapter", () => {
  let adapter: ExchangeAccountRepositoryAdapter;

  beforeEach(() => {
    adapter = new ExchangeAccountRepositoryAdapter();
    mockQuery.mockReset();
  });

  describe("Initialization", () => {
    it("should create an adapter instance", () => {
      expect(adapter).toBeInstanceOf(ExchangeAccountRepositoryAdapter);
    });

    it("should export a singleton instance", () => {
      expect(exchangeAccountRepositoryAdapter).toBeInstanceOf(
        ExchangeAccountRepositoryAdapter
      );
    });
  });

  describe("listAccounts", () => {
    it("should list every account of the user without secrets", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          accountRow(),
          accountRow({ id: "account-2", status: "PENDING" }),
        ],
      });

      const accounts = await adapter.listAccounts("test-user-id");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("FROM exchange_accounts WHERE user_id = $1"),
        ["test-user-id"]
      );
      expect(accounts).toHaveLength(2);
      expect(accounts[0]).toMatchObject({
        id: "account-1",
        exchange: "kodiak",
        environment: "mainnet",
        accountRef: "kodiak-account-id",
        status: "ACTIVE",
      });
      expect(accounts[0].verifiedAt).toBeInstanceOf(Date);
      // The list query must never select the envelope column.
      expect(mockQuery.mock.calls[0][0]).not.toContain("credentials_encrypted");
    });

    it("should parse a stringified meta payload", async () => {
      mockQuery.mockResolvedValue({
        rows: [accountRow({ meta: '{"backfilled":true}' })],
      });

      const accounts = await adapter.listAccounts("test-user-id");

      expect(accounts[0].meta).toEqual({ backfilled: true });
    });

    it("should fall back to an empty meta object", async () => {
      mockQuery.mockResolvedValue({ rows: [accountRow({ meta: "not-json" })] });

      const accounts = await adapter.listAccounts("test-user-id");

      expect(accounts[0].meta).toEqual({});
    });
  });

  describe("getAccountWithSecret", () => {
    it("should return the envelope verbatim with its key version", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          accountRow({
            credentials_encrypted: '{"kind":"kodiak-legacy"}',
            encryption_version: 2,
          }),
        ],
      });

      const stored = await adapter.getAccountWithSecret(
        "test-user-id",
        "account-1"
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $1 AND user_id = $2"),
        ["account-1", "test-user-id"]
      );
      expect(stored?.credentialsEncrypted).toBe('{"kind":"kodiak-legacy"}');
      expect(stored?.encryptionVersion).toBe(2);
    });

    it("should return null when the account is not owned by the user", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        adapter.getAccountWithSecret("test-user-id", "account-1")
      ).resolves.toBeNull();
    });
  });

  describe("createPending", () => {
    it("should insert a kodiak account in PENDING state", async () => {
      mockQuery.mockResolvedValue({
        rows: [accountRow({ status: "PENDING" })],
      });

      const account = await adapter.createPending({
        userId: "test-user-id",
        request: {
          exchange: "kodiak",
          environment: "testnet",
          accountId: "kodiak-account-id",
          apiKey: "ed25519:key",
          secretKey: "secret",
        },
        credentialsEncrypted: "ciphertext",
        encryptionVersion: 2,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO exchange_accounts"),
        [
          "test-user-id",
          "kodiak",
          "testnet",
          "kodiak-account-id",
          "ciphertext",
          2,
        ]
      );
      expect(account.status).toBe("PENDING");
    });

    it("should use the account index as account_ref for lighter", async () => {
      mockQuery.mockResolvedValue({
        rows: [accountRow({ exchange: "lighter", account_ref: "42" })],
      });

      await adapter.createPending({
        userId: "test-user-id",
        request: {
          exchange: "lighter",
          environment: "mainnet",
          accountIndex: 42,
          apiKeyIndex: 7,
          privateKey: "0xprivate",
        },
        credentialsEncrypted: "ciphertext",
        encryptionVersion: null,
      });

      expect(mockQuery.mock.calls[0][1]).toEqual([
        "test-user-id",
        "lighter",
        "mainnet",
        "42",
        "ciphertext",
        null,
      ]);
    });

    it("should throw when no row is returned", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        adapter.createPending({
          userId: "test-user-id",
          request: {
            exchange: "kodiak",
            environment: "mainnet",
            accountId: "kodiak-account-id",
            apiKey: "ed25519:key",
            secretKey: "secret",
          },
          credentialsEncrypted: "ciphertext",
          encryptionVersion: 2,
        })
      ).rejects.toThrow("Account creation failed");
    });
  });

  describe("setStatus", () => {
    it("should stamp verified_at only on the first successful verify", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const ok = await adapter.setStatus(
        "test-user-id",
        "account-1",
        "ACTIVE",
        true
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("verified_at = CASE WHEN $4"),
        ["account-1", "test-user-id", "ACTIVE", true]
      );
      expect(ok).toBe(true);
    });

    it("should return false when the account does not exist", async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      await expect(
        adapter.setStatus("test-user-id", "account-1", "INVALID", false)
      ).resolves.toBe(false);
    });
  });

  describe("rewriteEnvelope", () => {
    it("should graduate an envelope and its key version", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const ok = await adapter.rewriteEnvelope(
        "test-user-id",
        "account-1",
        "new-ciphertext",
        3
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET credentials_encrypted = $3"),
        ["account-1", "test-user-id", "new-ciphertext", 3]
      );
      expect(ok).toBe(true);
    });
  });

  describe("deleteAccount", () => {
    it("should hard-delete one account scoped to the user", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const ok = await adapter.deleteAccount("test-user-id", "account-1");

      expect(mockQuery).toHaveBeenCalledWith(
        "DELETE FROM exchange_accounts WHERE id = $1 AND user_id = $2",
        ["account-1", "test-user-id"]
      );
      expect(ok).toBe(true);
    });

    it("should return false when nothing was deleted", async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      await expect(
        adapter.deleteAccount("test-user-id", "account-1")
      ).resolves.toBe(false);
    });
  });

  describe("countActive", () => {
    it("should count only ACTIVE accounts", async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: "3" }] });

      const count = await adapter.countActive("test-user-id");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'ACTIVE'"),
        ["test-user-id"]
      );
      expect(count).toBe(3);
    });

    it("should return 0 when the count row is missing", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(adapter.countActive("test-user-id")).resolves.toBe(0);
    });
  });

  describe("getBotBoundAccountSecrets (C3a)", () => {
    const storedAccount = (overrides: Record<string, unknown> = {}) => ({
      id: "account-1",
      userId: "test-user-id",
      exchange: "kodiak",
      environment: "mainnet",
      accountRef: "kodiak-account-id",
      status: "ACTIVE",
      verifiedAt: null,
      lastVerifiedAt: null,
      meta: {},
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      credentialsEncrypted: "sealed-ciphertext",
      encryptionVersion: 3,
      ...overrides,
    });

    const sealedKodiak = JSON.stringify({
      v: 3,
      kind: "kodiak",
      accountId: "kodiak-account-id",
      apiKey: "api-key",
      secretKey: "secret-key",
    });

    const makeDeps = (
      overrides: Partial<BotBoundAccountDeps> = {}
    ): BotBoundAccountDeps => ({
      findBot: jest.fn().mockResolvedValue({
        user_id: "test-user-id",
        exchange_account_id: "account-1",
      }),
      getAccountWithSecret: jest.fn().mockResolvedValue(storedAccount()),
      decryptEnvelope: jest.fn().mockResolvedValue(sealedKodiak),
      decryptFieldBlob: jest.fn(),
      ...overrides,
    });

    it("should resolve the bot's bound ACTIVE account and decrypt its sealed envelope", async () => {
      const deps = makeDeps();

      const bound = await getBotBoundAccountSecrets("bot-1", deps);

      expect(deps.findBot).toHaveBeenCalledWith("bot-1");
      // Ownership is enforced on the account lookup (bot.user_id).
      expect(deps.getAccountWithSecret).toHaveBeenCalledWith(
        "test-user-id",
        "account-1"
      );
      expect(bound?.request).toEqual({
        exchange: "kodiak",
        environment: "mainnet",
        accountId: "kodiak-account-id",
        apiKey: "api-key",
        secretKey: "secret-key",
      });
      expect(bound?.account.status).toBe("ACTIVE");
    });

    it("should treat an unbound legacy bot as unbound without a lookup", async () => {
      const deps = makeDeps({
        findBot: jest.fn().mockResolvedValue({
          user_id: "test-user-id",
          exchange_account_id: null,
        }),
      });

      await expect(
        getBotBoundAccountSecrets("bot-1", deps)
      ).resolves.toBeNull();
      expect(deps.getAccountWithSecret).not.toHaveBeenCalled();
    });

    it("should return null when the bot does not exist", async () => {
      const deps = makeDeps({ findBot: jest.fn().mockResolvedValue(null) });

      await expect(
        getBotBoundAccountSecrets("bot-1", deps)
      ).resolves.toBeNull();
      expect(deps.decryptEnvelope).not.toHaveBeenCalled();
    });

    it("should refuse an account that is not ACTIVE", async () => {
      const deps = makeDeps({
        getAccountWithSecret: jest
          .fn()
          .mockResolvedValue(storedAccount({ status: "PENDING" })),
      });

      await expect(
        getBotBoundAccountSecrets("bot-1", deps)
      ).resolves.toBeNull();
      expect(deps.decryptEnvelope).not.toHaveBeenCalled();
    });

    it("should map a lighter envelope to its connect-shaped request", async () => {
      const deps = makeDeps({
        getAccountWithSecret: jest.fn().mockResolvedValue(
          storedAccount({
            exchange: "lighter",
            accountRef: "7",
          })
        ),
        decryptEnvelope: jest.fn().mockResolvedValue(
          JSON.stringify({
            v: 3,
            kind: "lighter",
            accountIndex: 7,
            apiKeyIndex: 3,
            privateKey: "0xdeadbeef",
          })
        ),
      });

      const bound = await getBotBoundAccountSecrets("bot-1", deps);

      expect(bound?.request).toEqual({
        exchange: "lighter",
        environment: "mainnet",
        accountIndex: 7,
        apiKeyIndex: 3,
        privateKey: "0xdeadbeef",
      });
    });

    it("should read a backfilled kodiak-legacy wrapper through the field blobs", async () => {
      const wrapper = JSON.stringify({
        v: 2,
        kind: "kodiak-legacy",
        accountId: "kodiak-account-id",
        apiKeyCipher: "api-key-cipher",
        secretKeyCipher: "secret-key-cipher",
      });
      const decryptFieldBlob = jest
        .fn()
        .mockImplementation((blob: string) =>
          Promise.resolve(blob === "api-key-cipher" ? "api-key" : "secret-key")
        );
      const deps = makeDeps({
        getAccountWithSecret: jest
          .fn()
          .mockResolvedValue(storedAccount({ credentialsEncrypted: wrapper })),
        decryptEnvelope: jest
          .fn()
          .mockRejectedValue(new Error("not versioned")),
        decryptFieldBlob,
      });

      const bound = await getBotBoundAccountSecrets("bot-1", deps);

      expect(decryptFieldBlob).toHaveBeenCalledWith("api-key-cipher");
      expect(decryptFieldBlob).toHaveBeenCalledWith("secret-key-cipher");
      expect(bound?.request).toEqual({
        exchange: "kodiak",
        environment: "mainnet",
        accountId: "kodiak-account-id",
        apiKey: "api-key",
        secretKey: "secret-key",
      });
    });

    it("should return null when nothing can be decrypted", async () => {
      const deps = makeDeps({
        getAccountWithSecret: jest
          .fn()
          .mockResolvedValue(
            storedAccount({ credentialsEncrypted: "not-json" })
          ),
        decryptEnvelope: jest.fn().mockRejectedValue(new Error("bad key")),
      });

      await expect(
        getBotBoundAccountSecrets("bot-1", deps)
      ).resolves.toBeNull();
    });
  });
});
