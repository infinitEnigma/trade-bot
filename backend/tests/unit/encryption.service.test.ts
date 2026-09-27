/** @format */

import {
  EncryptionService,
  SecureCredentials,
  withCredentials,
} from "../../src/infrastructure/security/encryption.service";
import { query } from "../../src/database/pool";

// Mock dependencies
jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../../src/core/logging", () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

describe("EncryptionService", () => {
  // Save original environment variable
  const originalMasterKey = process.env.ENCRYPTION_MASTER_KEY;

  beforeAll(() => {
    // Set test encryption key
    process.env.ENCRYPTION_MASTER_KEY = "test-encryption-key-32-chars-long";
  });

  afterAll(() => {
    // Restore original environment variable
    process.env.ENCRYPTION_MASTER_KEY = originalMasterKey;
  });

  describe("SecureCredentials", () => {
    describe("basic functionality", () => {
      it("should create SecureCredentials instance", () => {
        const creds = { apiKey: "test-api-key", secretKey: "test-secret-key" };
        const secureCreds = SecureCredentials.create(creds);
        expect(secureCreds).toBeInstanceOf(SecureCredentials);
        expect(secureCreds.isDestroyed()).toBe(false);
      });

      it("should get credential values", () => {
        const creds = { apiKey: "test-api-key", secretKey: "test-secret-key" };
        const secureCreds = SecureCredentials.create(creds);
        expect(secureCreds.get("apiKey")).toBe("test-api-key");
        expect(secureCreds.get("secretKey")).toBe("test-secret-key");
      });

      it("should throw error when getting credential from destroyed credentials", () => {
        const creds = { apiKey: "test-api-key" };
        const secureCreds = SecureCredentials.create(creds);
        secureCreds.destroy();
        expect(() => secureCreds.get("apiKey")).toThrow(
          "SecureCredentials: Credentials have been destroyed and cannot be accessed"
        );
      });

      it("should check if credentials are destroyed", () => {
        const creds = { apiKey: "test-api-key" };
        const secureCreds = SecureCredentials.create(creds);
        expect(secureCreds.isDestroyed()).toBe(false);
        secureCreds.destroy();
        expect(secureCreds.isDestroyed()).toBe(true);
      });
    });

    describe("use patterns", () => {
      it("should execute callback with credentials using use()", async () => {
        const creds = { apiKey: "test-api-key", secretKey: "test-secret-key" };
        const secureCreds = SecureCredentials.create(creds);
        const result = await secureCreds.use(async credentials => {
          expect(credentials.apiKey).toBe("test-api-key");
          expect(credentials.secretKey).toBe("test-secret-key");
          return "success";
        });
        expect(result).toBe("success");
        expect(secureCreds.isDestroyed()).toBe(true);
      });

      it("should execute callback with credentials using useSync()", () => {
        const creds = { apiKey: "test-api-key", secretKey: "test-secret-key" };
        const secureCreds = SecureCredentials.create(creds);
        const result = secureCreds.useSync(credentials => {
          expect(credentials.apiKey).toBe("test-api-key");
          expect(credentials.secretKey).toBe("test-secret-key");
          return "success";
        });
        expect(result).toBe("success");
        expect(secureCreds.isDestroyed()).toBe(true);
      });

      it("should destroy credentials after callback error using use()", async () => {
        const creds = { apiKey: "test-api-key" };
        const secureCreds = SecureCredentials.create(creds);
        await expect(
          secureCreds.use(async () => {
            throw new Error("Callback error");
          })
        ).rejects.toThrow("Callback error");
        expect(secureCreds.isDestroyed()).toBe(true);
      });

      it("should destroy credentials after callback error using useSync()", () => {
        const creds = { apiKey: "test-api-key" };
        const secureCreds = SecureCredentials.create(creds);
        expect(() =>
          secureCreds.useSync(() => {
            throw new Error("Callback error");
          })
        ).toThrow("Callback error");
        expect(secureCreds.isDestroyed()).toBe(true);
      });
    });
  });

  describe("EncryptionService", () => {
    describe("constructor", () => {
      it("should throw error when ENCRYPTION_MASTER_KEY is not set", () => {
        delete process.env.ENCRYPTION_MASTER_KEY;
        expect(() => new EncryptionService()).toThrow(
          "ENCRYPTION_MASTER_KEY environment variable required"
        );
        process.env.ENCRYPTION_MASTER_KEY = "test-encryption-key-32-chars-long"; // Restore for other tests
      });

      it("should throw error for weak key in production", () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        process.env.ENCRYPTION_MASTER_KEY = "weak-key";

        expect(() => new EncryptionService()).toThrow(
          "ENCRYPTION_MASTER_KEY must be 32+ characters in production"
        );

        process.env.NODE_ENV = originalEnv;
        process.env.ENCRYPTION_MASTER_KEY = "test-encryption-key-32-chars-long"; // Restore for other tests
      });
    });

    describe("basic encryption/decryption", () => {
      let encryptionService: EncryptionService;

      beforeEach(() => {
        encryptionService = new EncryptionService();
      });

      it("should encrypt and decrypt text correctly", () => {
        const plaintext = "test plaintext";
        const ciphertext = encryptionService.encrypt(plaintext);
        expect(ciphertext).not.toBe(plaintext);
        expect(typeof ciphertext).toBe("string");

        const decrypted = encryptionService.decrypt(ciphertext);
        expect(decrypted).toBe(plaintext);
      });

      it("should encrypt and decrypt API keys", () => {
        const apiKey = "test-api-key-123";
        const encrypted = encryptionService.encryptApiKey(apiKey);
        expect(encrypted).not.toBe(apiKey);

        const decrypted = encryptionService.decryptApiKey(encrypted);
        expect(decrypted).toBe(apiKey);
      });

      it("should encrypt and decrypt secret keys", () => {
        const secretKey = "test-secret-key-456";
        const encrypted = encryptionService.encryptSecretKey(secretKey);
        expect(encrypted).not.toBe(secretKey);

        const decrypted = encryptionService.decryptSecretKey(encrypted);
        expect(decrypted).toBe(secretKey);
      });

      it("should handle different input texts", () => {
        const texts = [
          "short",
          "a".repeat(1000),
          "with special chars: !@#$%^&*()_+",
          "with unicode: 你好世界 🌍",
        ];

        texts.forEach(text => {
          const encrypted = encryptionService.encrypt(text);
          const decrypted = encryptionService.decrypt(encrypted);
          expect(decrypted).toBe(text);
        });
      });
    });

    describe("versioned encryption", () => {
      let encryptionService: EncryptionService;

      beforeEach(() => {
        encryptionService = new EncryptionService();
      });

      it("should encrypt and decrypt with version", async () => {
        const plaintext = "test versioned text";
        const encrypted = await encryptionService.encryptWithVersion(plaintext);
        expect(typeof encrypted).toBe("string");

        const decrypted = await encryptionService.decryptWithVersion(encrypted);
        expect(decrypted).toBe(plaintext);
      });

      it("should encrypt and decrypt with specific version", async () => {
        const plaintext = "test specific version";
        const encrypted = await encryptionService.encryptWithVersion(
          plaintext,
          1
        );
        const decrypted = await encryptionService.decryptWithVersion(encrypted);
        expect(decrypted).toBe(plaintext);
      });

      it("should throw error for unsupported version", async () => {
        await expect(
          encryptionService.encryptWithVersion("text", 99)
        ).rejects.toThrow("No encryption key found for version 99");
      });
    });

    describe("key rotation", () => {
      let encryptionService: EncryptionService;
      const mockQuery = jest.fn();

      beforeEach(() => {
        encryptionService = new EncryptionService(mockQuery);
        mockQuery.mockReset();
      });

      it("should check if key rotation is needed", async () => {
        // No keys in database
        mockQuery.mockResolvedValue({ rows: [] });
        const result = await encryptionService.isKeyRotationNeeded();
        expect(result).toBe(true);
      });

      it("should check if key rotation is needed based on time", async () => {
        // Key created less than 3 months ago
        const recentDate = new Date(Date.now() - 2 * 30 * 24 * 60 * 60 * 1000); // 2 months ago
        mockQuery.mockResolvedValue({ rows: [{ created_at: recentDate }] });
        const result = await encryptionService.isKeyRotationNeeded();
        expect(result).toBe(false);
      });

      it("should indicate key rotation needed when time elapsed", async () => {
        // Key created more than 3 months ago
        const oldDate = new Date(Date.now() - 4 * 30 * 24 * 60 * 60 * 1000); // 4 months ago
        mockQuery.mockResolvedValue({ rows: [{ created_at: oldDate }] });
        const result = await encryptionService.isKeyRotationNeeded();
        expect(result).toBe(true);
      });

      it("should rotate encryption keys", async () => {
        // Mock to return no existing keys first, then success
        mockQuery.mockResolvedValue({});
        await encryptionService.rotateEncryptionKeys();
        expect(mockQuery).toHaveBeenCalled();
      });
    });

    describe("data migration", () => {
      let encryptionService: EncryptionService;
      const mockQuery = jest.fn();

      beforeEach(() => {
        encryptionService = new EncryptionService(mockQuery);
        mockQuery.mockReset();
      });

      it("should migrate existing credentials to versioned encryption", async () => {
        // C2: rows live in `exchange_accounts` with a single versioned
        // envelope — one SELECT plus one UPDATE per stale row.
        const envelope = (apiKey: string, secretKey: string) =>
          JSON.stringify({
            v: 1,
            kind: "kodiak",
            accountId: `account-${apiKey}`,
            apiKey,
            secretKey,
          });
        const mockCredentials = [
          {
            id: "1",
            credentials_encrypted: await encryptionService.encryptWithVersion(
              envelope("api-key-1", "secret-key-1")
            ),
            encryption_version: 1,
          },
          {
            id: "2",
            credentials_encrypted: await encryptionService.encryptWithVersion(
              envelope("api-key-2", "secret-key-2")
            ),
            encryption_version: 1,
          },
        ];

        mockQuery
          .mockResolvedValueOnce({ rows: mockCredentials }) // Get accounts to migrate
          .mockResolvedValueOnce({}) // Update account 1
          .mockResolvedValueOnce({}); // Update account 2

        await encryptionService.migrateToVersionedEncryption();

        expect(mockQuery).toHaveBeenCalledTimes(3); // 1 for select, 2 for updates
      });

      it("should handle errors during migration", async () => {
        const mockCredentials = [
          {
            id: "1",
            credentials_encrypted: "invalid-encrypted-data",
            encryption_version: null,
          },
        ];

        mockQuery.mockResolvedValueOnce({ rows: mockCredentials });

        await encryptionService.migrateToVersionedEncryption();

        expect(mockQuery).toHaveBeenCalled();
      });
    });
  });

  describe("withCredentials", () => {
    beforeEach(() => {
      (query as jest.Mock).mockReset();
    });

    it("should decrypt and use user credentials", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440000"; // Valid UUID
      const mockQuery = jest.fn();
      const encryptionService = new EncryptionService(mockQuery);
      const accountId = "account-456";
      const apiKey = "test-api-key";
      const secretKey = "test-secret-key";

      // C2: the exchange-account row carries the versioned envelope.
      // The same row answers both listAccounts and getAccountWithSecret.
      const envelope = await encryptionService.encryptWithVersion(
        JSON.stringify({
          v: 1,
          kind: "kodiak",
          accountId,
          apiKey,
          secretKey,
        })
      );
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: accountId,
            user_id: userId,
            exchange: "kodiak",
            environment: "testnet",
            account_ref: accountId,
            status: "ACTIVE",
            verified_at: "2024-01-01T00:00:00.000Z",
            last_verified_at: "2024-01-01T00:00:00.000Z",
            meta: {},
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            credentials_encrypted: envelope,
            encryption_version: 2,
          },
        ],
      });

      const result = await withCredentials(
        userId,
        async creds => {
          expect(creds.get("accountId")).toBe(accountId);
          expect(creds.get("apiKey")).toBe(apiKey);
          expect(creds.get("secretKey")).toBe(secretKey);
          return "success";
        },
        mockQuery
      );

      expect(result).toBe("success");
      expect(mockQuery).toHaveBeenCalled();
    });

    it("should throw error when no credentials found", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440001"; // Valid UUID
      // Inject explicitly: test-setup.ts loads encryption.service before this
      // file's jest.mock(pool) registers, so the module-level default still
      // resolves to the real pool query in this suite.
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

      await expect(
        withCredentials(
          userId,
          async () => {
            return "success";
          },
          mockQuery
        )
      ).rejects.toThrow("No verified exchange account found");
      expect(mockQuery).toHaveBeenCalled();
    });
  });
});
