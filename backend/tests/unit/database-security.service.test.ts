/** @format */

import { DatabaseSecurityService } from "../../src/infrastructure/security/database-security.service";
import { query } from "../../src/database/pool";
import { encryptionService } from "../../src/infrastructure/security/encryption.service";
import { redisService } from "../../src/infrastructure/cache";
import {
  securityLogger as logger,
  securityLogger,
} from "../../src/core/logging/context-aware-logger.service";

// Mock dependencies
jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../../src/infrastructure/security/encryption.service", () => ({
  encryptionService: {
    encryptWithVersion: jest.fn(),
  },
}));

jest.mock("../../src/infrastructure/cache", () => ({
  redisService: {
    setex: jest.fn(),
  },
}));

jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
  securityLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  redisLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  cacheLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock @noble/ed25519 module to avoid Jest parse errors
jest.mock("@noble/ed25519", () => ({
  sign: jest.fn(),
  verify: jest.fn(),
  getPublicKey: jest.fn(),
  keygen: jest.fn(),
  etc: jest.fn(),
  getPublicKeyAsync: jest.fn(),
  hash: jest.fn(),
  hashes: jest.fn(),
  keygenAsync: jest.fn(),
  Point: jest.fn(),
  signAsync: jest.fn(),
  utils: jest.fn(),
  verifyAsync: jest.fn(),
}));

describe("DatabaseSecurityService", () => {
  let databaseSecurityService: DatabaseSecurityService;

  beforeEach(() => {
    databaseSecurityService = new DatabaseSecurityService();
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create an instance with default configuration", () => {
      expect(databaseSecurityService).toBeDefined();
    });

    it("should respect custom configuration", () => {
      const customConfig = {
        enableEncryption: false,
        encryptionKeyRotation: false,
        auditAllQueries: true,
        connectionEncryption: false,
        sensitiveTables: ["custom_table"],
      };

      const customService = new DatabaseSecurityService(customConfig);
      expect(customService).toBeDefined();
    });
  });

  describe("assessDatabaseSecurity", () => {
    it("should assess overall database security", async () => {
      // Mock successful assessments
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ setting: "off" }] }) // data_directory_encrypted
        .mockResolvedValueOnce({
          rows: [
            {
              table_name: "exchange_accounts",
              column_name: "credentials_encrypted",
            },
          ],
        }) // encrypted columns
        .mockResolvedValueOnce({
          rows: [
            { column_name: "credentials_encrypted" },
            { column_name: "account_ref" },
          ],
        }) // exchange-account fields
        .mockResolvedValueOnce({ rows: [{ exists: false }] }) // user_sessions table
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // audit_logs table
        .mockResolvedValueOnce({
          rows: [
            {
              total_logs: 2000,
              oldest_log: new Date(
                Date.now() - 100 * 24 * 60 * 60 * 1000
              ).toISOString(),
              newest_log: new Date().toISOString(),
              unique_users: 15,
            },
          ],
        }) // audit stats
        .mockResolvedValueOnce({ rows: [{ rls_policies: "0" }] }) // RLS policies
        .mockResolvedValueOnce({ rows: [{ setting: "on" }] }); // SSL setting

      const result = await databaseSecurityService.assessDatabaseSecurity();

      expect(redisService.setex).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          databaseEncryption: expect.any(Object),
          sensitiveDataProtection: expect.any(Object),
          auditLogging: expect.any(Object),
          accessControls: expect.any(Object),
        })
      );
    });

    it("should cache assessment results", async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ setting: "off" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ exists: false }] })
        .mockResolvedValueOnce({ rows: [{ exists: false }] })
        .mockResolvedValueOnce({ rows: [{ rls_policies: "0" }] })
        .mockResolvedValueOnce({ rows: [{ setting: "off" }] });

      await databaseSecurityService.assessDatabaseSecurity();

      expect(redisService.setex).toHaveBeenCalledWith(
        "db:security:assessment",
        3600,
        expect.any(String)
      );
    });
  });

  describe("generateEncryptionMigrationPlan", () => {
    it("should generate migration plan for existing tables", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [{ exists: true }] });

      const migrationPlans =
        await databaseSecurityService.generateEncryptionMigrationPlan();

      expect(migrationPlans.length).toBeGreaterThan(0);
      expect(
        migrationPlans.some(plan => plan.table === "exchange_accounts")
      ).toBe(true);
      expect(migrationPlans.some(plan => plan.table === "user_sessions")).toBe(
        true
      );
    });

    it("should only include existing tables in migration plan", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [{ exists: false }] });

      const migrationPlans =
        await databaseSecurityService.generateEncryptionMigrationPlan();

      expect(migrationPlans.length).toBe(1); // Only exchange_accounts is always planned
      expect(migrationPlans.some(plan => plan.table === "user_sessions")).toBe(
        false
      );
    });
  });

  describe("migrateTableEncryption", () => {
    it("should encrypt exchange-account credentials in place", async () => {
      const testRows = [
        { id: 1, credentials: "plain-envelope-1" },
        { id: 2, credentials: "plain-envelope-2" },
      ];

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: testRows })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      (encryptionService.encryptWithVersion as jest.Mock)
        .mockResolvedValue("encrypted-envelope-1")
        .mockResolvedValue("encrypted-envelope-2");

      const result = await databaseSecurityService.migrateTableEncryption(
        "exchange_accounts",
        ["credentials"]
      );

      expect(result.success).toBe(true);
      expect(result.migratedRows).toBe(2);
      expect(result.errors.length).toBe(0);
      expect(query).toHaveBeenCalledWith(
        "UPDATE exchange_accounts SET credentials_encrypted = $1 WHERE id = $2",
        expect.anything()
      );
    });

    it("should handle migration errors", async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: 1, credentials: "plain-envelope" }],
        })
        .mockRejectedValueOnce(new Error("Update failed"));

      (encryptionService.encryptWithVersion as jest.Mock)
        .mockResolvedValue("encrypted-envelope");

      const result = await databaseSecurityService.migrateTableEncryption(
        "exchange_accounts",
        ["credentials"]
      );

      expect(result.success).toBe(false);
      expect(result.migratedRows).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("enableDatabaseEncryption", () => {
    it("should enable database encryption when not already enabled", async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ setting: "off" }] })
        .mockResolvedValueOnce(undefined);

      const result = await databaseSecurityService.enableDatabaseEncryption();

      expect(result.success).toBe(true);
      expect(result.requiresRestart).toBe(true);
      expect(query).toHaveBeenCalledWith(
        "ALTER SYSTEM SET data_directory_encrypted = on"
      );
    });

    it("should return success when encryption is already enabled", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [{ setting: "on" }] });

      const result = await databaseSecurityService.enableDatabaseEncryption();

      expect(result.success).toBe(true);
      expect(result.requiresRestart).toBe(false);
      expect(result.message).toContain("already enabled");
    });

    it("should handle errors when enabling encryption", async () => {
      (query as jest.Mock).mockRejectedValue(new Error("Permission denied"));

      const result = await databaseSecurityService.enableDatabaseEncryption();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Permission denied");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getSecurityMetrics", () => {
    it("should get security metrics", async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // exchange_accounts exists
        .mockResolvedValueOnce({ rows: [{ total: "100", encrypted: "90" }] }) // 100 records, 90 encrypted
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // user_sessions exists
        .mockResolvedValueOnce({ rows: [{ total: "50", encrypted: "25" }] }); // 50 records, 25 encrypted

      const metrics = await databaseSecurityService.getSecurityMetrics();

      expect(metrics).toEqual(
        expect.objectContaining({
          encryptedRecords: 115,
          totalRecords: 150,
          encryptionCoverage: expect.any(Number),
          lastSecurityCheck: expect.any(String),
          securityScore: expect.any(Number),
        })
      );

      expect(metrics.securityScore).toBeGreaterThan(0);
    });

    it("should handle no tables existing", async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [{ exists: false }] });

      const metrics = await databaseSecurityService.getSecurityMetrics();

      expect(metrics.encryptedRecords).toBe(0);
      expect(metrics.totalRecords).toBe(0);
      expect(metrics.encryptionCoverage).toBe(0);
      expect(metrics.securityScore).toBe(20); // Base score when no tables exist
    });
  });

  describe("generateSecurityAuditReport", () => {
    it("should generate a security audit report", async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ setting: "on" }] }) // data_directory_encrypted
        .mockResolvedValueOnce({
          rows: [
            {
              table_name: "exchange_accounts",
              column_name: "credentials_encrypted",
            },
          ],
        }) // encrypted columns
        .mockResolvedValueOnce({
          rows: [{ column_name: "credentials_encrypted" }],
        }) // exchange-account fields
        .mockResolvedValueOnce({ rows: [{ exists: false }] }) // user_sessions table
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // audit_logs table
        .mockResolvedValueOnce({
          rows: [
            {
              total_logs: 5000,
              oldest_log: new Date(
                Date.now() - 100 * 24 * 60 * 60 * 1000
              ).toISOString(),
              newest_log: new Date().toISOString(),
              unique_users: 20,
            },
          ],
        }) // audit stats
        .mockResolvedValueOnce({ rows: [{ rls_policies: "5" }] }) // RLS policies
        .mockResolvedValueOnce({ rows: [{ setting: "on" }] }) // SSL setting
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // exchange_accounts exists
        .mockResolvedValueOnce({ rows: [{ total: "100", encrypted: "95" }] }) // metrics
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // user_sessions exists

      const report =
        await databaseSecurityService.generateSecurityAuditReport();

      expect(typeof report).toBe("string");
      expect(report).toContain("Database Security Audit Report");
      expect(report).toContain("Security Score");
      expect(report).toContain("Encryption Status");
      expect(report).toContain("Sensitive Data Protection");
      expect(report).toContain("Audit Logging");
      expect(report).toContain("Access Controls");
    });
  });
});
