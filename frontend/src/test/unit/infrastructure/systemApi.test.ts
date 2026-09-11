/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { systemApi } from "../../../infrastructure/api/system";
import { httpClient } from "../../../infrastructure/api/client";

// Mock the HTTP client
vi.mock("../../../infrastructure/api/client", () => ({
    httpClient: {
        getClient: vi.fn(),
    },
}));

describe("systemApi", () => {
    let mockGet: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock methods
        mockGet = vi.fn();

        (httpClient.getClient as vi.Mock).mockReturnValue({
            get: mockGet,
        });
    });

    describe("getSystemHealth", () => {
        it("should call system health endpoint", async () => {
            const mockResponse = {
                success: true,
                data: {
                    status: "healthy",
                    uptime: 3600,
                    services: {
                        database: "healthy",
                        api: "healthy",
                        cache: "healthy",
                    },
                },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await systemApi.getSystemHealth();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/system/health/detailed");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getSystemMetrics", () => {
        it("should call system metrics endpoint", async () => {
            const mockResponse = {
                success: true,
                data: {
                    cpu: 0.15,
                    memory: 0.4,
                    disk: 0.3,
                },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await systemApi.getSystemMetrics();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/system/metrics");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getServiceStatus", () => {
        it("should call service status endpoint", async () => {
            const mockResponse = {
                success: true,
                data: {
                    services: [
                        { name: "auth", status: "running" },
                        { name: "trading", status: "running" },
                        { name: "market", status: "running" },
                    ],
                    migrations: { completed: 10, pending: 0 },
                },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await systemApi.getServiceStatus();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/system/health/services");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getDatabaseMetrics", () => {
        it("should call database metrics endpoint", async () => {
            const mockResponse = {
                success: true,
                data: {
                    connections: 50,
                    queriesPerSecond: 100,
                    cacheHitRate: 0.85,
                },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await systemApi.getDatabaseMetrics();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/system/metrics/database");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getRateLimitStats", () => {
        it("should call rate limit stats endpoint", async () => {
            const mockResponse = {
                success: true,
                data: {
                    limit: 100,
                    remaining: 85,
                    reset: Date.now() + 60000,
                },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await systemApi.getRateLimitStats();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/system/ratelimit");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getSecurityStatus", () => {
        it("should call security status endpoint", async () => {
            const mockResponse = {
                success: true,
                data: {
                    encryption: "enabled",
                    ssl: "valid",
                    vulnerabilities: [],
                },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await systemApi.getSecurityStatus();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/system/health/encryption");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getExternalApiHealth", () => {
        it("should call external API health endpoint", async () => {
            const mockResponse = {
                success: true,
                data: {
                    kodiak: "healthy",
                    exchange: "healthy",
                    blockchain: "healthy",
                },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await systemApi.getExternalApiHealth();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/system/health/external");
            expect(result).toEqual(mockResponse);
        });
    });
});