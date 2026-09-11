/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { authApi } from "../../../infrastructure/api";
import { httpClient } from "../../../infrastructure/api/client";

// Mock the HTTP client
vi.mock("../../../infrastructure/api/client", () => ({
    httpClient: {
        getClient: vi.fn(),
    },
}));

describe("authApi", () => {
    let mockPost: vi.Mock;
    let mockGet: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock methods
        mockPost = vi.fn();
        mockGet = vi.fn();

        (httpClient.getClient as vi.Mock).mockReturnValue({
            post: mockPost,
            get: mockGet,
        });
    });

    describe("register", () => {
        it("should call register endpoint with correct data", async () => {
            const email = "test@example.com";
            const password = "password123";
            const mockResponse = {
                success: true,
                data: { user: { id: "1", email, userLevel: "BASIC" } },
            };

            mockPost.mockResolvedValue({ data: mockResponse });

            const result = await authApi.register(email, password);

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockPost).toHaveBeenCalledWith("/api/auth/register", {
                email,
                password,
            });
            expect(result).toEqual(mockResponse);
        });

        it("should handle register errors", async () => {
            const email = "test@example.com";
            const password = "password123";
            const errorMessage = "Email already exists";

            mockPost.mockRejectedValue(new Error(errorMessage));

            await expect(authApi.register(email, password)).rejects.toThrow(errorMessage);
        });
    });

    describe("login", () => {
        it("should call login endpoint with correct data", async () => {
            const email = "test@example.com";
            const password = "password123";
            const mockResponse = {
                success: true,
                data: { user: { id: "1", email, userLevel: "VERIFIED" } },
            };

            mockPost.mockResolvedValue({ data: mockResponse });

            const result = await authApi.login(email, password);

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockPost).toHaveBeenCalledWith("/api/auth/login", {
                email,
                password,
            });
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getMe", () => {
        it("should call get me endpoint", async () => {
            const mockResponse = {
                success: true,
                data: { id: "1", email: "test@example.com", userLevel: "VERIFIED" },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await authApi.getMe();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/auth/me");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("checkQualification", () => {
        it("should call check qualification endpoint", async () => {
            const mockResponse = {
                success: true,
                data: { isQualified: true, requirements: [], progress: 100 },
            };

            mockPost.mockResolvedValue({ data: mockResponse });

            const result = await authApi.checkQualification();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockPost).toHaveBeenCalledWith("/api/auth/check-qualification");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getQualificationConfig", () => {
        it("should call get qualification config endpoint", async () => {
            const mockResponse = {
                success: true,
                data: { requirements: ["email_verified", "profile_completed"] },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await authApi.getQualificationConfig();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/auth/qualification-config");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getProfile", () => {
        it("should call get profile endpoint", async () => {
            const mockResponse = {
                success: true,
                data: { user: { id: "1", email: "test@example.com" } },
            };

            mockGet.mockResolvedValue({ data: mockResponse });

            const result = await authApi.getProfile();

            expect(httpClient.getClient).toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledWith("/api/user/profile");
            expect(result).toEqual(mockResponse);
        });
    });
});