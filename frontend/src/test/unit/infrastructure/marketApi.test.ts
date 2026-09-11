/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { marketApi } from "../../../infrastructure/api/market";
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

describe("marketApi", () => {
    let mockGet: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock methods
        mockGet = vi.fn();
        (httpClient.getClient as vi.Mock).mockReturnValue({
            get: mockGet,
        });
    });

    describe("market data endpoints", () => {
        describe("getTicker", () => {
            it("should call get ticker endpoint with symbol", async () => {
                const symbol = "BTC/USDT";
                const mockResponse = {
                    success: true,
                    data: { symbol, price: 50000, change: 2.5 },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getTicker(symbol);

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    `market:ticker:${symbol}`,
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });

            it("should call get all tickers endpoint when no symbol provided", async () => {
                const mockResponse = {
                    success: true,
                    data: [
                        { symbol: "BTC/USDT", price: 50000, change: 2.5 },
                        { symbol: "ETH/USDT", price: 3000, change: -1.2 },
                    ],
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getTicker();

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    "market:tickers:all",
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("getFuturesPrice", () => {
            it("should call get futures price endpoint", async () => {
                const symbol = "BTC/USDT";
                const mockResponse = {
                    success: true,
                    data: { symbol, price: 50100, fundingRate: 0.01 },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getFuturesPrice(symbol);

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    `market:futures:${symbol}`,
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("getMarkPrice", () => {
            it("should call get mark price endpoint", async () => {
                const symbol = "BTC/USDT";
                const mockResponse = {
                    success: true,
                    data: { symbol, markPrice: 50050, indexPrice: 50025 },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getMarkPrice(symbol);

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    `market:markprice:${symbol}`,
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("getKlines", () => {
            it("should call get klines endpoint with parameters", async () => {
                const params = {
                    symbol: "BTC/USDT",
                    interval: "1h",
                    limit: 100,
                };
                const mockResponse = {
                    success: true,
                    data: {
                        symbol: params.symbol,
                        interval: params.interval,
                        candles: [
                            { time: Date.now() - 3600000, open: 49800, high: 50200, low: 49500, close: 50000 },
                        ],
                    },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getKlines(params);

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    `market:klines:${params.symbol}:${params.interval}:${params.limit}`,
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("getKlineHistory", () => {
            it("should call get kline history endpoint", async () => {
                const params = {
                    symbol: "BTC/USDT",
                    resolution: "1D",
                    from: Date.now() - 7 * 24 * 60 * 60 * 1000,
                    to: Date.now(),
                    limit: 100,
                };
                const mockResponse = {
                    success: true,
                    data: {
                        symbol: params.symbol,
                        resolution: params.resolution,
                        candles: [
                            { time: Date.now() - 86400000, open: 48000, high: 50000, low: 47500, close: 49000 },
                        ],
                    },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getKlineHistory(params);

                expect(result).toEqual(mockResponse);
            });
        });

        describe("getPositions", () => {
            it("should call get positions endpoint", async () => {
                const mockResponse = {
                    success: true,
                    data: [
                        { symbol: "BTC/USDT", size: 0.1, entryPrice: 50000 },
                        { symbol: "ETH/USDT", size: 1.5, entryPrice: 3000 },
                    ],
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getPositions();

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    "market:positions",
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });
    });

    describe("TradingView endpoints", () => {
        describe("getTvConfig", () => {
            it("should call get TradingView config endpoint", async () => {
                const mockResponse = {
                    success: true,
                    data: {
                        supportedResolutions: ["1", "5", "15", "60", "D", "W"],
                        exchanges: ["BINANCE", "KUCOIN"],
                    },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getTvConfig();

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    "market:tv:config",
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("getTvSymbols", () => {
            it("should call get TradingView symbols endpoint", async () => {
                const symbol = "BTC/USDT";
                const mockResponse = {
                    success: true,
                    data: [
                        { symbol, exchange: "BINANCE", description: "BTC/USDT" },
                        { symbol: "ETH/USDT", exchange: "BINANCE", description: "ETH/USDT" },
                    ],
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getTvSymbols({ symbol });

                expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
                    `market:tv:symbols:${symbol}`,
                    expect.any(Function),
                    "marketApi"
                );
                expect(result).toEqual(mockResponse);
            });
        });

        describe("getTvHistory", () => {
            it("should call get TradingView history endpoint", async () => {
                const params = {
                    symbol: "BTC/USDT",
                    resolution: "1D",
                    from: Date.now() - 7 * 24 * 60 * 60 * 1000,
                    to: Date.now(),
                };
                const mockResponse = {
                    success: true,
                    data: {
                        symbol: params.symbol,
                        resolution: params.resolution,
                        candles: [
                            { time: Date.now() - 86400000, open: 48000, high: 50000, low: 47500, close: 49000 },
                        ],
                    },
                };

                (globalRequestManager.deduplicateRequest as vi.Mock).mockResolvedValue(
                    mockResponse
                );

                const result = await marketApi.getTvHistory(params);

                expect(result).toEqual(mockResponse);
            });
        });
    });
});