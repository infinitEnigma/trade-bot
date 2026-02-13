/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { walletApi } from "../../../infrastructure/api/wallet";
import { httpClient } from "../../../infrastructure/api/client";

// Mock the HTTP client
vi.mock("../../../infrastructure/api/client", () => ({
    httpClient: {
        getClient: vi.fn(),
    },
}));

describe("walletApi", () => {
    let mockPost: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock methods
        mockPost = vi.fn();

        (httpClient.getClient as vi.Mock).mockReturnValue({
            post: mockPost,
        });
    });

    describe("verifyWallet", () => {
        it("should call verify wallet endpoint with correct data", async () => {
            const walletData = {
                walletAddress: "0x1234567890123456789012345678901234567890",
                signature: "0xabc123def456",
                message: "Sign this message to verify ownership",
            };
            const mockResponse = {
                success: true,
                data: {
                    verified: true,
                    walletAddress: walletData.walletAddress,
                    message: "Wallet verified successfully",
                },
            };

            mockPost.mockResolvedValue({ data: mockResponse });

            const result = await walletApi.verifyWallet(walletData);

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockPost).toHaveBeenCalledWith("/api/user/verify-wallet", walletData);
            expect(result).toEqual(mockResponse);
        });

        it("should handle verify wallet errors", async () => {
            const walletData = {
                walletAddress: "0x1234567890123456789012345678901234567890",
                signature: "0xinvalid",
                message: "Sign this message to verify ownership",
            };
            const errorMessage = "Invalid signature";

            mockPost.mockRejectedValue(new Error(errorMessage));

            await expect(walletApi.verifyWallet(walletData)).rejects.toThrow(errorMessage);
        });

        it("should handle invalid wallet address format", async () => {
            const walletData = {
                walletAddress: "invalid-address",
                signature: "0xabc123def456",
                message: "Sign this message to verify ownership",
            };
            const errorMessage = "Invalid wallet address format";

            mockPost.mockRejectedValue(new Error(errorMessage));

            await expect(walletApi.verifyWallet(walletData)).rejects.toThrow(errorMessage);
        });
    });
});