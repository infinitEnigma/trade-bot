/** @format */

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import {
  kodiakApi,
  type KodiakCredentials,
} from "../../../infrastructure/api/kodiak";
import { httpClient } from "../../../infrastructure/api/client";
import { globalRequestManager } from "../../../infrastructure/request-manager";

// Mock the HTTP client
vi.mock("../../../infrastructure/api/client", () => ({
  httpClient: {
    getClient: vi.fn(),
  },
}));

describe("kodiakApi", () => {
  let mockPost: Mock;
  let mockGet: Mock;
  let mockDelete: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock methods
    mockPost = vi.fn();
    mockGet = vi.fn();
    mockDelete = vi.fn();

    (httpClient.getClient as Mock).mockReturnValue({
      post: mockPost,
      get: mockGet,
      delete: mockDelete,
    });
  });

  describe("connectKodiak", () => {
    it("should call connect endpoint with correct credentials", async () => {
      const mockCredentials: KodiakCredentials = {
        accountId: "123456",
        apiKey: "test-api-key",
        secretKey: "test-secret-key",
      };
      // C2 backend shape: { success, message, data: account DTO }
      const mockBackendResponse = {
        success: true,
        message: "Kodiak connected",
        data: {
          id: "acct-1",
          accountRef: mockCredentials.accountId,
          status: "ACTIVE",
        },
      };
      const expectedMapped = {
        success: true,
        message: "Kodiak connected",
        error: undefined,
        data: {
          accountId: mockCredentials.accountId,
          connected: true,
          verified: true,
        },
      };

      mockPost.mockResolvedValue({ data: mockBackendResponse });

      const result = await kodiakApi.connectKodiak(mockCredentials);

      expect(httpClient.getClient).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith("/api/accounts/connect", {
        exchange: "kodiak",
        environment: "mainnet",
        accountId: mockCredentials.accountId,
        apiKey: mockCredentials.apiKey,
        secretKey: mockCredentials.secretKey,
      });
      expect(result).toEqual(expectedMapped);
    });

    it("should handle connect errors", async () => {
      const mockCredentials: KodiakCredentials = {
        accountId: "123456",
        apiKey: "test-api-key",
        secretKey: "test-secret-key",
      };
      const errorMessage = "Invalid credentials";

      mockPost.mockRejectedValue(new Error(errorMessage));

      await expect(kodiakApi.connectKodiak(mockCredentials)).rejects.toThrow(
        errorMessage
      );
    });
  });

  describe("disconnectKodiak", () => {
    it("should list accounts then revoke the active Kodiak account", async () => {
      mockGet.mockResolvedValue({
        data: {
          success: true,
          data: {
            accounts: [{ id: "acct-1", exchange: "kodiak", status: "ACTIVE" }],
          },
        },
      });
      const mockResponse = {
        success: true,
        message: "Kodiak disconnected successfully",
      };

      mockDelete.mockResolvedValue({ data: mockResponse });

      const result = await kodiakApi.disconnectKodiak();

      expect(httpClient.getClient).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith("/api/accounts");
      expect(mockDelete).toHaveBeenCalledWith("/api/accounts/acct-1");
      expect(result).toEqual(mockResponse);
    });

    it("should report when no Kodiak account exists", async () => {
      mockGet.mockResolvedValue({
        data: { success: true, data: { accounts: [] } },
      });

      const result = await kodiakApi.disconnectKodiak();

      expect(mockDelete).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: "No Kodiak account connected",
      });
    });

    it("should handle disconnect errors", async () => {
      const errorMessage = "Failed to disconnect";
      mockGet.mockRejectedValue(new Error(errorMessage));

      await expect(kodiakApi.disconnectKodiak()).rejects.toThrow(errorMessage);
    });
  });

  describe("getKodiakStatus", () => {
    it("should derive status from the accounts list", async () => {
      // C2: GET /api/accounts -> mapped onto the legacy KodiakStatus shape.
      mockGet.mockResolvedValue({
        data: {
          success: true,
          data: {
            accounts: [
              {
                id: "acct-1",
                exchange: "kodiak",
                status: "ACTIVE",
                accountRef: "123456",
                verifiedAt: "2024-01-01T00:00:00Z",
                createdAt: "2024-01-01T00:00:00Z",
              },
            ],
          },
        },
      });

      const result = await kodiakApi.getKodiakStatus();

      expect(httpClient.getClient).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith("/api/accounts");
      expect(result).toEqual({
        success: true,
        data: {
          connected: true,
          accountId: "123456",
          connectedAt: "2024-01-01T00:00:00Z",
          verified: true,
        },
      });
    });

    it("should report disconnected when no live Kodiak account exists", async () => {
      mockGet.mockResolvedValue({
        data: { success: true, data: { accounts: [] } },
      });

      const result = await kodiakApi.getKodiakStatus();

      expect(result).toEqual({
        success: true,
        data: { connected: false },
      });
    });
  });

  describe("getKodiakBalance", () => {
    it("should call balance endpoint with deduplication", async () => {
      const mockResponse = {
        success: true,
        data: {
          totalBalance: "1000.00",
          availableBalance: "800.00",
          lockedBalance: "200.00",
          currency: "USD",
          assets: [
            { asset: "BTC", free: "0.5", locked: "0.1" },
            { asset: "ETH", free: "2.0", locked: "0.5" },
          ],
        },
      };

      const spy = vi
        .spyOn(globalRequestManager, "deduplicateRequest")
        .mockResolvedValue(mockResponse);

      const result = await kodiakApi.getKodiakBalance();

      expect(spy).toHaveBeenCalledWith(
        "kodiak:balance",
        expect.any(Function),
        "tradingApi"
      );
      expect(result).toEqual(mockResponse);
      spy.mockRestore();
    });
  });

  describe("validateCredentialsFormat", () => {
    it("should validate valid credentials", () => {
      const validCredentials: KodiakCredentials = {
        accountId: "123456",
        apiKey: "valid-api-key-12345",
        secretKey: "valid-secret-key-12345",
      };

      const result = kodiakApi.validateCredentialsFormat(validCredentials);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should validate missing required fields", () => {
      const invalidCredentials: KodiakCredentials = {
        accountId: "",
        apiKey: "",
        secretKey: "",
      };

      const result = kodiakApi.validateCredentialsFormat(invalidCredentials);

      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual([
        "Account ID is required",
        "API Key is required",
        "Secret Key is required",
      ]);
    });

    it("should validate invalid format", () => {
      const invalidCredentials: KodiakCredentials = {
        accountId: "invalid@account",
        apiKey: "too-short",
        secretKey: "too-short",
      };

      const result = kodiakApi.validateCredentialsFormat(invalidCredentials);

      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual([
        "Account ID contains invalid characters",
        "API Key appears to be too short",
        "Secret Key appears to be too short",
      ]);
    });

    it("should validate with whitespace", () => {
      const credentials: KodiakCredentials = {
        accountId: "   ",
        apiKey: "   ",
        secretKey: "   ",
      };

      const result = kodiakApi.validateCredentialsFormat(credentials);

      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual([
        "Account ID is required",
        "API Key is required",
        "Secret Key is required",
        "Account ID contains invalid characters",
        "API Key appears to be too short",
        "Secret Key appears to be too short",
      ]);
    });
  });

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

      const spy = vi
        .spyOn(globalRequestManager, "deduplicateRequest")
        .mockResolvedValue(mockResponse);

      const result = await kodiakApi.getKodiakPositions();

      expect(spy).toHaveBeenCalledWith(
        "kodiak:positions",
        expect.any(Function),
        "tradingApi"
      );
      expect(result).toEqual(mockResponse);
      spy.mockRestore();
    });

    it("should handle 403 errors when getting Kodiak positions", async () => {
      const mockError = {
        response: { status: 403 },
      };

      const spy = vi
        .spyOn(globalRequestManager, "deduplicateRequest")
        .mockImplementation(async () => {
          throw mockError;
        });

      await expect(kodiakApi.getKodiakPositions()).rejects.toEqual(mockError);
      spy.mockRestore();
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

      const spy = vi
        .spyOn(globalRequestManager, "deduplicateRequest")
        .mockResolvedValue(mockResponse);

      const result = await kodiakApi.getKodiakTrades(limit);

      expect(spy).toHaveBeenCalledWith(
        `kodiak:trades:${limit}`,
        expect.any(Function),
        "tradingApi"
      );
      expect(result).toEqual(mockResponse);
      spy.mockRestore();
    });

    it("should handle 400 errors when getting Kodiak trades", async () => {
      const limit = 50;
      const mockError = {
        response: { status: 400 },
      };

      const spy = vi
        .spyOn(globalRequestManager, "deduplicateRequest")
        .mockImplementation(async () => {
          throw mockError;
        });

      await expect(kodiakApi.getKodiakTrades(limit)).rejects.toEqual(mockError);
      spy.mockRestore();
    });
  });
});
