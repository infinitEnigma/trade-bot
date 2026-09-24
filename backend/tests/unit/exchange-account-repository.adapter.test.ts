/** @format */

/**
 * ExchangeAccountRepositoryAdapter (C2) — generic venue/environment accounts.
 *
 * The adapter never touches plaintext or decrypts: envelopes are stored and
 * returned verbatim (backfilled `kodiak-legacy` wrappers included).
 */

import {
  ExchangeAccountRepositoryAdapter,
  exchangeAccountRepositoryAdapter,
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
        rows: [accountRow(), accountRow({ id: "account-2", status: "PENDING" })],
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
      expect(mockQuery.mock.calls[0][0]).not.toContain(
        "credentials_encrypted"
      );
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
});
