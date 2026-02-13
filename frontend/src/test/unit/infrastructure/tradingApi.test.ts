/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { tradingApi } from "../../../infrastructure/api/trading";
import { httpClient } from "../../../infrastructure/api/client";
import { globalRequestManager } from "../../../infrastructure/request-manager";

// Mock dependencies
vi.mock("../../../infrastructure/api/client", () => ({
    httpClient: {
        getClient: vi.fn(),
    },
}));

vi.mock("../../../infrastructure/request-manager", () => ({
    globalRequestManager: {
        deduplicateRequest: vi.fn(),
    },
}));

describe("tradingApi", () => {
    let mockGet: vi.Mock;
    let mockPost: vi.Mock;
    let mockPut: vi.Mock;
    let mockDelete: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock methods
        mockGet = vi.fn();
        mockPost = vi.fn();
        mockPut = vi.fn();
        mockDelete = vi.fn();

        (httpClient.getClient as vi.Mock).mockReturnValue({
            get: mockGet,
            post: mockPost,
            put: mockPut,
            delete: mockDelete,
        });
    });

    describe("strategy endpoints", () => {
        describe("getStrategies", () => {
            it("should call get strategies endpoint with deduplication", async () => {
                const mockResponse = {
                    success: true,
                    data: [
                        { id: "1", name: "Strategy 1", type: "trend" },
                        { id: "2", name: "Strategy 2", type: "scalping" },
                    ],
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await tradingApi.getStrategies();

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    "strategies:list",
                    expect.any(Function),
                    "tradingApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("createStrategy", () => {
            it("should call create strategy endpoint", async () => {
                const strategyData = {
                    name: "New Strategy",
                    type: "trend",
                    config: { parameter: 10 },
                };
                const mockResponse = {
                    success: true,
                    data: { id: "1", ...strategyData },
                };

                mockPost.mockResolvedValue({ data: mockResponse });

                const result = await tradingApi.createStrategy(strategyData);

                expect(httpClient.getClient).toHaveBeenCalled();
                expect(mockPost).toHaveBeenCalledWith("/api/strategies", strategyData);
                expect(result).toEqual(mockResponse);
            });
        });

        describe("updateStrategy", () => {
            it("should call update strategy endpoint", async () => {
                const strategyId = "1";
                const strategyData = {
                    name: "Updated Strategy",
                    type: "trend",
                    config: { parameter: 20 },
                };
                const mockResponse = {
                    success: true,
                    data: { id: strategyId, ...strategyData },
                };

                mockPut.mockResolvedValue({ data: mockResponse });

                const result = await tradingApi.updateStrategy(strategyId, strategyData);

                expect(httpClient.getClient).toHaveBeenCalled();
                expect(mockPut).toHaveBeenCalledWith(`/api/strategies/${strategyId}`, strategyData);
                expect(result).toEqual(mockResponse);
            });
        });

        describe("deleteStrategy", () => {
            it("should call delete strategy endpoint", async () => {
                const strategyId = "1";
                const mockResponse = {
                    success: true,
                    data: { id: strategyId },
                };

                mockDelete.mockResolvedValue({ data: mockResponse });

                const result = await tradingApi.deleteStrategy(strategyId);

                expect(httpClient.getClient).toHaveBeenCalled();
                expect(mockDelete).toHaveBeenCalledWith(`/api/strategies/${strategyId}`);
                expect(result).toEqual(mockResponse);
            });
        });
    });

    describe("bot endpoints", () => {
        describe("getBotInstances", () => {
            it("should call get bot instances endpoint with deduplication", async () => {
                const mockResponse = {
                    success: true,
                    data: [
                        { id: "1", strategyId: "1", status: "running" },
                        { id: "2", strategyId: "2", status: "stopped" },
                    ],
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await tradingApi.getBotInstances();

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    "bots:instances",
                    expect.any(Function),
                    "tradingApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("getEngineStatus", () => {
            it("should call get engine status endpoint with deduplication", async () => {
                const mockResponse = {
                    success: true,
                    data: { status: "running", botsActive: 2 },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await tradingApi.getEngineStatus();

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    "bots:engine-status",
                    expect.any(Function),
                    "tradingApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("startBot", () => {
            it("should call start bot endpoint", async () => {
                const strategyId = "1";
                const mockResponse = {
                    success: true,
                    data: { botId: "1", status: "running" },
                };

                mockPost.mockResolvedValue({ data: mockResponse });

                const result = await tradingApi.startBot(strategyId);

                expect(httpClient.getClient).toHaveBeenCalled();
                expect(mockPost).toHaveBeenCalledWith("/api/bot/start", { strategyId });
                expect(result).toEqual(mockResponse);
            });
        });

        describe("stopBot", () => {
            it("should call stop bot endpoint", async () => {
                const botId = "1";
                const mockResponse = {
                    success: true,
                    data: { botId, status: "stopped" },
                };

                mockPost.mockResolvedValue({ data: mockResponse });

                const result = await tradingApi.stopBot(botId);

                expect(httpClient.getClient).toHaveBeenCalled();
                expect(mockPost).toHaveBeenCalledWith("/api/bot/stop", { botId });
                expect(result).toEqual(mockResponse);
            });
        });

        describe("emergencyStop", () => {
            it("should call emergency stop endpoint", async () => {
                const botId = "1";
                const mockResponse = {
                    success: true,
                    data: { botId, status: "stopped" },
                };

                mockPost.mockResolvedValue({ data: mockResponse });

                const result = await tradingApi.emergencyStop(botId);

                expect(httpClient.getClient).toHaveBeenCalled();
                expect(mockPost).toHaveBeenCalledWith("/api/bot/emergency-stop", {
                    botId,
                });
                expect(result).toEqual(mockResponse);
            });
        });
    });

    describe("Kodiak integration endpoints", () => {
        describe("getKodiakPositions", () => {
            it("should call get Kodiak positions with deduplication", async () => {
                const mockResponse = {
                    success: true,
                    data: {
                        rows: [
                            { id: "1", symbol: "BTC/USDT", size: 0.1, entryPrice: 50000 },
                            { id: "2", symbol: "ETH/USDT", size: 1.5, entryPrice: 3000 },
                        ],
                    },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await tradingApi.getKodiakPositions();

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    "kodiak:positions",
                    expect.any(Function),
                    "tradingApi"
                );
                expect(result).toEqual(mockResponse);
            });

            it("should handle 403 errors when getting Kodiak positions", async () => {
                const mockError = {
                    response: { status: 403 },
                };

                (globalRequestManager.deduplicateRequest as any).mockImplementation(
                    async (key: string, fn: () => Promise<any>) => {
                        throw mockError;
                    }
                );

                await expect(tradingApi.getKodiakPositions()).rejects.toEqual(mockError);
            });
        });

        describe("getKodiakTrades", () => {
            it("should call get Kodiak trades with deduplication", async () => {
                const limit = 50;
                const mockResponse = {
                    success: true,
                    data: {
                        rows: [
                            { id: "1", symbol: "BTC/USDT", price: 50000, amount: 0.1 },
                            { id: "2", symbol: "ETH/USDT", price: 3000, amount: 1.5 },
                        ],
                    },
                };

                (globalRequestManager.deduplicateRequest as any).mockResolvedValue(
                    mockResponse
                );

                const result = await tradingApi.getKodiakTrades(limit);

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    `kodiak:trades:${limit}`,
                    expect.any(Function),
                    "tradingApi"
                );
                expect(result).toEqual(mockResponse);
            });

            it("should handle 400 errors when getting Kodiak trades", async () => {
                const limit = 50;
                const mockError = {
                    response: { status: 400 },
                };

                (globalRequestManager.deduplicateRequest as any).mockImplementation(
                    async (key: string, fn: () => Promise<any>) => {
                        throw mockError;
                    }
                );

                await expect(tradingApi.getKodiakTrades(limit)).rejects.toEqual(mockError);
            });
        });
    });
});