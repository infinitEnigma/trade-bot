/** @format */

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { balanceApi } from "../../../infrastructure/api/balance";
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

describe("balanceApi", () => {
  let mockGet: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock methods
    mockGet = vi.fn();
    (httpClient.getClient as Mock).mockReturnValue({
      get: mockGet,
      post: vi.fn(),
    });
  });

  describe("getCurrentBalance", () => {
    it("should call get current balance endpoint with deduplication", async () => {
      const mockResponse = {
        success: true,
        data: { balance: 1000, currency: "USD" },
      };

      (globalRequestManager.deduplicateRequest as Mock).mockResolvedValue(
        mockResponse
      );

      const result = await balanceApi.getCurrentBalance();

      expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
        "balance:current",
        expect.any(Function),
        "balanceApi"
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle errors when getting current balance", async () => {
      const errorMessage = "Failed to fetch balance";
      (globalRequestManager.deduplicateRequest as Mock).mockRejectedValue(
        new Error(errorMessage)
      );

      await expect(balanceApi.getCurrentBalance()).rejects.toThrow(
        errorMessage
      );
    });
  });

  describe("refreshBalance", () => {
    it("should call refresh balance endpoint with deduplication", async () => {
      const mockResponse = {
        success: true,
        data: { balance: 1500, currency: "USD" },
      };

      (globalRequestManager.deduplicateRequest as Mock).mockResolvedValue(
        mockResponse
      );

      const result = await balanceApi.refreshBalance();

      expect(globalRequestManager.deduplicateRequest).toHaveBeenCalledWith(
        "balance:refresh",
        expect.any(Function),
        "balanceApi"
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle errors when refreshing balance", async () => {
      const errorMessage = "Refresh failed";
      (globalRequestManager.deduplicateRequest as Mock).mockRejectedValue(
        new Error(errorMessage)
      );

      await expect(balanceApi.refreshBalance()).rejects.toThrow(errorMessage);
    });
  });
});
