/** @format */

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { walletApi } from "../../../infrastructure/api/wallet";
import { httpClient } from "../../../infrastructure/api/client";

// Mock the HTTP client
vi.mock("../../../infrastructure/api/client", () => ({
  httpClient: {
    getClient: vi.fn(),
  },
}));

describe("walletApi", () => {
  let mockGet: Mock;
  let mockPost: Mock;
  let mockPatch: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock methods
    mockGet = vi.fn();
    mockPost = vi.fn();
    mockPatch = vi.fn();

    (httpClient.getClient as Mock).mockReturnValue({
      get: mockGet,
      post: mockPost,
      patch: mockPatch,
    });
  });

  describe("listWallets", () => {
    it("should GET the wallet list endpoint", async () => {
      const wallets = [
        {
          id: "wallet-1",
          chain: "evm",
          address: "0x1234567890123456789012345678901234567890",
          isPrimary: true,
        },
      ];
      const mockResponse = { success: true, data: { wallets } };
      mockGet.mockResolvedValue({ data: mockResponse });

      const result = await walletApi.listWallets();

      expect(mockGet).toHaveBeenCalledWith("/api/wallets");
      expect(result).toEqual(mockResponse);
    });
  });

  describe("verifyWallet", () => {
    it("should call verify wallet endpoint with correct data", async () => {
      const walletData = {
        chain: "evm" as const,
        address: "0x1234567890123456789012345678901234567890",
        signature: "0xabc123def456",
        message: "Sign this message to verify ownership",
      };
      const mockResponse = {
        success: true,
        data: {
          verified: true,
          address: walletData.address,
          message: "Wallet verified successfully",
        },
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const result = await walletApi.verifyWallet(walletData);

      expect(httpClient.getClient).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith("/api/wallets/verify", walletData);
      expect(result).toEqual(mockResponse);
    });

    it("should handle verify wallet errors", async () => {
      const walletData = {
        address: "0x1234567890123456789012345678901234567890",
        signature: "0xinvalid",
        message: "Sign this message to verify ownership",
      };
      const errorMessage = "Invalid signature";

      mockPost.mockRejectedValue(new Error(errorMessage));

      await expect(walletApi.verifyWallet(walletData)).rejects.toThrow(
        errorMessage
      );
    });

    it("should handle invalid wallet address format", async () => {
      const walletData = {
        address: "invalid-address",
        signature: "0xabc123def456",
        message: "Sign this message to verify ownership",
      };
      const errorMessage = "Invalid wallet address format";

      mockPost.mockRejectedValue(new Error(errorMessage));

      await expect(walletApi.verifyWallet(walletData)).rejects.toThrow(
        errorMessage
      );
    });
  });

  describe("unlinkWallet", () => {
    it("should call the per-wallet unlink endpoint with the wallet id", async () => {
      const mockResponse = {
        success: true,
        message: "Wallet unlinked from your account.",
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const result = await walletApi.unlinkWallet("wallet-1");

      expect(httpClient.getClient).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith("/api/wallets/wallet-1/unlink");
      expect(result).toEqual(mockResponse);
    });

    it("should handle unlink wallet errors", async () => {
      mockPost.mockRejectedValue(new Error("No linked wallet found"));

      await expect(walletApi.unlinkWallet("wallet-1")).rejects.toThrow(
        "No linked wallet found"
      );
    });
  });

  describe("setPrimaryWallet", () => {
    it("should PATCH the primary-wallet endpoint with the wallet id", async () => {
      const mockResponse = { success: true };
      mockPatch.mockResolvedValue({ data: mockResponse });

      const result = await walletApi.setPrimaryWallet("wallet-2");

      expect(mockPatch).toHaveBeenCalledWith("/api/wallets/wallet-2/primary");
      expect(result).toEqual(mockResponse);
    });
  });

  describe("createChallenge (X4)", () => {
    it("should POST the action to the challenge endpoint", async () => {
      const mockResponse = {
        success: true,
        data: {
          nonce: "nonce-1",
          message: "Trade Bot wallet proof …",
          expiresAt: "2026-01-01T00:05:00.000Z",
        },
      };
      mockPost.mockResolvedValue({ data: mockResponse });

      const result = await walletApi.createChallenge("bot:start");

      expect(mockPost).toHaveBeenCalledWith("/api/wallets/challenge", {
        action: "bot:start",
      });
      expect(result).toEqual(mockResponse);
    });
  });
});
