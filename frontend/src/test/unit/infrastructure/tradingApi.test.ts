/** @format */

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
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
    let mockGet: Mock;
    let mockPost: Mock;
    let mockPut: Mock;
    let mockDelete: Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock methods
        mockGet = vi.fn();
        mockPost = vi.fn();
        mockPut = vi.fn();
        mockDelete = vi.fn();

        (httpClient.getClient as Mock).mockReturnValue({
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

                (globalRequestManager.deduplicateRequest as Mock).mockResolvedValue(
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

        const result = await tradingApi.updateStrategy(
          strategyId,
          strategyData
        );

                expect(httpClient.getClient).toHaveBeenCalled();
        expect(mockPut).toHaveBeenCalledWith(
          `/api/strategies/${strategyId}`,
          strategyData
        );
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
        expect(mockDelete).toHaveBeenCalledWith(
          `/api/strategies/${strategyId}`
        );
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

                (globalRequestManager.deduplicateRequest as Mock).mockResolvedValue(
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

                (globalRequestManager.deduplicateRequest as Mock).mockResolvedValue(
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
});