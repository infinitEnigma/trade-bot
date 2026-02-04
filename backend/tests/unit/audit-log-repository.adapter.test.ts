/** @format */

import { AuditLogRepositoryAdapter, auditLogRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/audit-log-repository.adapter";
import { query } from "../../src/database/pool";
import { logger } from "../../src/core/logging";

// Mock dependencies
jest.mock("../../src/database/pool", () => ({
    query: jest.fn()
}));

jest.mock("../../src/core/logging", () => ({
    logger: {
        error: jest.fn()
    }
}));

describe("AuditLogRepositoryAdapter", () => {
    describe("Initialization", () => {
        it("should create an AuditLogRepositoryAdapter instance", () => {
            const adapter = new AuditLogRepositoryAdapter();
            expect(adapter).toBeInstanceOf(AuditLogRepositoryAdapter);
        });

        it("should export a singleton instance", () => {
            expect(auditLogRepositoryAdapter).toBeInstanceOf(AuditLogRepositoryAdapter);
        });
    });

    describe("logEvent", () => {
        it("should log an audit event", async () => {
            const adapter = new AuditLogRepositoryAdapter();
            const mockEvent = {
                userId: "test-user-id",
                action: "test-action",
                details: { key: "value" },
                ipAddress: "127.0.0.1"
            };

            (query as jest.Mock).mockResolvedValueOnce({});

            await adapter.logEvent(mockEvent);

            expect(query).toHaveBeenCalledWith(
                'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES ($1, $2, $3, $4, NOW())',
                [mockEvent.userId, mockEvent.action, JSON.stringify(mockEvent.details), mockEvent.ipAddress]
            );
        });

        it("should handle errors when logging events without throwing", async () => {
            const adapter = new AuditLogRepositoryAdapter();
            const mockEvent = {
                userId: "test-user-id",
                action: "test-action",
                details: { key: "value" },
                ipAddress: "127.0.0.1"
            };
            const testError = new Error("Database connection error");

            (query as jest.Mock).mockRejectedValueOnce(testError);

            await expect(adapter.logEvent(mockEvent)).resolves.not.toThrow();

            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to log audit event"));
        });
    });

    describe("getUserLogs", () => {
        it("should retrieve audit logs for a user", async () => {
            const adapter = new AuditLogRepositoryAdapter();
            const userId = "test-user-id";
            const limit = 50;
            const mockRows = [
                {
                    id: "log-1",
                    user_id: userId,
                    action: "action-1",
                    details: JSON.stringify({ key: "value1" }),
                    ip_address: "127.0.0.1",
                    user_agent: "Test Agent",
                    created_at: "2026-02-04T11:52:00Z"
                },
                {
                    id: "log-2",
                    user_id: userId,
                    action: "action-2",
                    details: JSON.stringify({ key: "value2" }),
                    ip_address: "127.0.0.1",
                    user_agent: "Test Agent",
                    created_at: "2026-02-04T11:53:00Z"
                }
            ];

            (query as jest.Mock).mockResolvedValueOnce({ rows: mockRows });

            const logs = await adapter.getUserLogs(userId, limit);

            expect(query).toHaveBeenCalledWith(
                'SELECT id, user_id, action, details, ip_address, user_agent, created_at FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
                [userId, limit]
            );
            expect(logs).toEqual([
                {
                    id: "log-1",
                    userId: userId,
                    action: "action-1",
                    details: { key: "value1" },
                    ipAddress: "127.0.0.1",
                    userAgent: "Test Agent",
                    timestamp: new Date("2026-02-04T11:52:00Z")
                },
                {
                    id: "log-2",
                    userId: userId,
                    action: "action-2",
                    details: { key: "value2" },
                    ipAddress: "127.0.0.1",
                    userAgent: "Test Agent",
                    timestamp: new Date("2026-02-04T11:53:00Z")
                }
            ]);
        });

        it("should throw error when query fails", async () => {
            const adapter = new AuditLogRepositoryAdapter();
            const userId = "test-user-id";
            const testError = new Error("Database query error");

            (query as jest.Mock).mockRejectedValueOnce(testError);

            await expect(adapter.getUserLogs(userId)).rejects.toThrow(
                "Failed to get audit logs: Database query error"
            );
        });

        it("should handle limit parameter correctly", async () => {
            const adapter = new AuditLogRepositoryAdapter();
            const userId = "test-user-id";
            const limit = 10;

            (query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            await adapter.getUserLogs(userId, limit);

            expect(query).toHaveBeenCalledWith(
                expect.anything(),
                [userId, limit]
            );
        });
    });

    describe("Legacy Methods", () => {
        describe("logAuthEvent", () => {
            it("should log authentication events using logEvent", async () => {
                const adapter = new AuditLogRepositoryAdapter();
                const spy = jest.spyOn(adapter, "logEvent").mockResolvedValueOnce();

                await adapter.logAuthEvent("test-user-id", "login", "127.0.0.1", "Test Agent");

                expect(spy).toHaveBeenCalledWith({
                    userId: "test-user-id",
                    action: "auth",
                    details: { event: "login" },
                    ipAddress: "127.0.0.1"
                });
            });
        });

        describe("logApiAccess", () => {
            it("should log API access events using logEvent", async () => {
                const adapter = new AuditLogRepositoryAdapter();
                const spy = jest.spyOn(adapter, "logEvent").mockResolvedValueOnce();

                await adapter.logApiAccess("test-user-id", "/api/test", "GET", 200, "127.0.0.1");

                expect(spy).toHaveBeenCalledWith({
                    userId: "test-user-id",
                    action: "api_access",
                    details: { endpoint: "/api/test", method: "GET", statusCode: 200 },
                    ipAddress: "127.0.0.1"
                });
            });
        });

        describe("logSecurityEvent", () => {
            it("should log security events using logEvent", async () => {
                const adapter = new AuditLogRepositoryAdapter();
                const spy = jest.spyOn(adapter, "logEvent").mockResolvedValueOnce();

                await adapter.logSecurityEvent("test-user-id", "suspicious_login", { severity: "high", attempts: 5 }, "127.0.0.1");

                expect(spy).toHaveBeenCalledWith({
                    userId: "test-user-id",
                    action: "security",
                    details: { event: "suspicious_login", severity: "high", attempts: 5 },
                    ipAddress: "127.0.0.1"
                });
            });
        });

        describe("getUserAuditLogs", () => {
            it("should retrieve user audit logs in legacy format", async () => {
                const adapter = new AuditLogRepositoryAdapter();
                const spy = jest.spyOn(adapter, "getUserLogs").mockResolvedValueOnce([
                    {
                        id: "log-1",
                        userId: "test-user-id",
                        action: "auth",
                        details: { event: "login" },
                        ipAddress: "127.0.0.1",
                        userAgent: "Test Agent",
                        timestamp: new Date("2026-02-04T11:52:00Z")
                    }
                ]);

                const logs = await adapter.getUserAuditLogs("test-user-id", 100);

                expect(spy).toHaveBeenCalledWith("test-user-id", 100);
                expect(logs).toEqual([
                    {
                        id: "log-1",
                        userId: "test-user-id",
                        eventType: "auth",
                        eventData: { event: "login" },
                        ipAddress: "127.0.0.1",
                        userAgent: "Test Agent",
                        createdAt: new Date("2026-02-04T11:52:00Z")
                    }
                ]);
            });
        });

        describe("getSecurityEvents", () => {
            it("should retrieve security events in legacy format", async () => {
                const adapter = new AuditLogRepositoryAdapter();
                const startDate = new Date("2026-02-04T00:00:00Z");
                const endDate = new Date("2026-02-04T23:59:59Z");
                const mockRows = [
                    {
                        id: "log-1",
                        user_id: "test-user-id",
                        action: "security",
                        details: JSON.stringify({ event: "suspicious_login", severity: "high" }),
                        ip_address: "127.0.0.1",
                        created_at: "2026-02-04T11:52:00Z"
                    }
                ];

                (query as jest.Mock).mockResolvedValueOnce({ rows: mockRows });

                const events = await adapter.getSecurityEvents(startDate, endDate, 1000);

                expect(query).toHaveBeenCalledWith(
                    'SELECT id, user_id, action, details, ip_address, created_at FROM audit_logs WHERE action = $1 AND created_at BETWEEN $2 AND $3 ORDER BY created_at DESC LIMIT $4',
                    ["security", startDate, endDate, 1000]
                );
                expect(events).toEqual([
                    {
                        id: "log-1",
                        userId: "test-user-id",
                        eventType: "security",
                        eventData: { event: "suspicious_login", severity: "high" },
                        ipAddress: "127.0.0.1",
                        createdAt: new Date("2026-02-04T11:52:00Z")
                    }
                ]);
            });

            it("should throw error when security events query fails", async () => {
                const adapter = new AuditLogRepositoryAdapter();
                const startDate = new Date("2026-02-04T00:00:00Z");
                const endDate = new Date("2026-02-04T23:59:59Z");
                const testError = new Error("Database query error");

                (query as jest.Mock).mockRejectedValueOnce(testError);

                await expect(adapter.getSecurityEvents(startDate, endDate)).rejects.toThrow(
                    "Failed to get security events: Database query error"
                );
            });
        });
    });
});