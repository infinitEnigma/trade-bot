/** @format */

/**
 * WalletRepositoryAdapter (C2) — chain-aware multi-wallet storage.
 *
 * Covers the rules the migration 012 schema encodes: closed chain set,
 * one primary per user, same address allowed on different chains, and the
 * verification stamp that drives REGISTERED.
 */

import {
  WalletRepositoryAdapter,
  walletRepositoryAdapter,
} from "../../src/infrastructure/adapters/repositories/wallet-repository.adapter";
import { query } from "../../src/database/pool";

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
}));

const mockQuery = query as jest.Mock;

const walletRow = (overrides: Record<string, unknown> = {}) => ({
  id: "wallet-1",
  user_id: "test-user-id",
  chain: "evm",
  address: "0x1234567890123456789012345678901234567890",
  label: null,
  is_primary: true,
  verified_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("WalletRepositoryAdapter", () => {
  let adapter: WalletRepositoryAdapter;

  beforeEach(() => {
    adapter = new WalletRepositoryAdapter();
    mockQuery.mockReset();
  });

  describe("Initialization", () => {
    it("should create a WalletRepositoryAdapter instance", () => {
      expect(adapter).toBeInstanceOf(WalletRepositoryAdapter);
    });

    it("should export a singleton instance", () => {
      expect(walletRepositoryAdapter).toBeInstanceOf(WalletRepositoryAdapter);
    });
  });

  describe("listWallets", () => {
    it("should list wallets with the primary first", async () => {
      mockQuery.mockResolvedValue({ rows: [walletRow()] });

      const wallets = await adapter.listWallets("test-user-id");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("FROM wallets"),
        ["test-user-id"]
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY is_primary DESC"),
        ["test-user-id"]
      );
      expect(wallets).toHaveLength(1);
      expect(wallets[0]).toMatchObject({
        id: "wallet-1",
        userId: "test-user-id",
        chain: "evm",
        isPrimary: true,
      });
      expect(wallets[0].verifiedAt).toBeInstanceOf(Date);
    });

    it("should return an empty list when the user has no wallets", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(adapter.listWallets("test-user-id")).resolves.toEqual([]);
    });
  });

  describe("getPrimaryWallet", () => {
    it("should return the primary wallet", async () => {
      mockQuery.mockResolvedValue({ rows: [walletRow()] });

      const wallet = await adapter.getPrimaryWallet("test-user-id");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("is_primary = true"),
        ["test-user-id"]
      );
      expect(wallet?.id).toBe("wallet-1");
    });

    it("should return null when no primary wallet exists", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        adapter.getPrimaryWallet("test-user-id")
      ).resolves.toBeNull();
    });
  });

  describe("upsertVerified", () => {
    it("should insert a verified wallet and let the first one become primary", async () => {
      mockQuery.mockResolvedValue({ rows: [walletRow({ is_primary: false })] });

      const wallet = await adapter.upsertVerified("test-user-id", {
        chain: "evm",
        address: "0x1234567890123456789012345678901234567890",
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO wallets"),
        [
          "test-user-id",
          "evm",
          "0x1234567890123456789012345678901234567890",
          null,
          null,
        ]
      );
      // First-wallet-wins primary rule lives in the SQL (NOT EXISTS …).
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("NOT EXISTS (SELECT 1 FROM wallets"),
        expect.anything()
      );
      expect(wallet.isPrimary).toBe(false);
    });

    it("should demote other wallets when the upserted one is primary", async () => {
      mockQuery.mockResolvedValue({ rows: [walletRow({ is_primary: true })] });

      await adapter.upsertVerified("test-user-id", {
        chain: "solana",
        address: "So11111111111111111111111111111111111111112",
        label: "trading",
        makePrimary: true,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE wallets SET is_primary = false"),
        ["test-user-id", "wallet-1"]
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT (user_id, chain, address)"),
        expect.anything()
      );
    });

    it("should throw when the upsert returns no row", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        adapter.upsertVerified("test-user-id", {
          chain: "evm",
          address: "0xabc",
        })
      ).rejects.toThrow("Wallet upsert failed");
    });
  });

  describe("setPrimary", () => {
    it("should re-home the primary flag on an owned wallet", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "wallet-2" }] }) // ownership check
        .mockResolvedValueOnce({ rowCount: 1 }) // clear flag
        .mockResolvedValueOnce({ rowCount: 1 }); // set flag

      const ok = await adapter.setPrimary("test-user-id", "wallet-2");

      expect(ok).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id FROM wallets WHERE id = $1"),
        ["wallet-2", "test-user-id"]
      );
    });

    it("should return false when the wallet belongs to another user", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const ok = await adapter.setPrimary("test-user-id", "wallet-other");

      expect(ok).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("remove", () => {
    it("should delete one wallet scoped to the user", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const ok = await adapter.remove("test-user-id", "wallet-1");

      expect(mockQuery).toHaveBeenCalledWith(
        "DELETE FROM wallets WHERE id = $1 AND user_id = $2",
        ["wallet-1", "test-user-id"]
      );
      expect(ok).toBe(true);
    });

    it("should return false when nothing was deleted", async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      await expect(adapter.remove("test-user-id", "wallet-1")).resolves.toBe(
        false
      );
    });
  });

  describe("countVerified", () => {
    it("should count only verified wallets", async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: "2" }] });

      const count = await adapter.countVerified("test-user-id");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("verified_at IS NOT NULL"),
        ["test-user-id"]
      );
      expect(count).toBe(2);
    });

    it("should return 0 when the count row is missing", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(adapter.countVerified("test-user-id")).resolves.toBe(0);
    });
  });
});
