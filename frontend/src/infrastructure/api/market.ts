/** @format */

import { httpClient } from "./client";

/**
 * Market data API endpoints
 * Handles market prices, trading data, and TradingView integration
 */
export const marketApi = {
    // Market data endpoints
    async getTicker(symbol?: string) {
        const params = symbol ? { symbol } : {};
        const response = await httpClient.getClient().get("/api/market/ticker", { params });
        return response.data;
    },

    async getFuturesPrice(symbol: string) {
        const response = await httpClient.getClient().get(`/api/market/futures/${symbol}`);
        return response.data;
    },

    async getMarkPrice(symbol: string) {
        const response = await httpClient.getClient().get(`/api/market/markprice/${symbol}`);
        return response.data;
    },

    async getKlines(params: {
        symbol?: string;
        interval?: string;
        limit?: number;
    }) {
        const response = await httpClient.getClient().get("/api/market/klines", { params });
        return response.data;
    },

    async getKlineHistory(params: {
        symbol?: string;
        resolution?: string;
        from?: number;
        to?: number;
        limit?: number;
    }) {
        const response = await httpClient.getClient().get("/api/market/kline-history", {
            params,
        });
        return response.data;
    },

    async getPositions() {
        const response = await httpClient.getClient().get("/api/market/positions");
        return response.data;
    },

    // TradingView endpoints
    async getTvConfig() {
        const response = await httpClient.getClient().get("/api/market/tv/config");
        return response.data;
    },

    async getTvSymbols(params: { symbol?: string }) {
        const response = await httpClient.getClient().get("/api/market/tv/symbols", {
            params,
        });
        return response.data;
    },

    async getTvHistory(params: {
        symbol?: string;
        resolution?: string;
        from?: number;
        to?: number;
    }) {
        const response = await httpClient.getClient().get("/api/market/tv/history", {
            params,
        });
        return response.data;
    },
};
