/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "../../../features/auth";
import { authApi } from "../../../infrastructure/api/auth";

// Mock the API
vi.mock("../../../infrastructure/api/auth");

describe("AuthService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("singleton instance", () => {
        it("should return the same instance each time", () => {
            const instance1 = authService;
            const instance2 = authService;

            expect(instance1).toBe(instance2);
        });
    });

    describe("login method", () => {
        it("should call authApi.login and return the response", async () => {
            const email = "test@example.com";
            const password = "password123";
            const mockResponse = {
                success: true,
                data: { user: { id: "1", email, userLevel: "VERIFIED" } },
            };

            (authApi.login as vi.Mock).mockResolvedValue(mockResponse);

            const result = await authService.login(email, password);

            expect(authApi.login).toHaveBeenCalledWith(email, password);
            expect(result).toEqual(mockResponse);
        });

        it("should handle login errors", async () => {
            const email = "test@example.com";
            const password = "password123";
            const errorMessage = "Invalid credentials";

            (authApi.login as vi.Mock).mockRejectedValue(new Error(errorMessage));

            await expect(authService.login(email, password)).rejects.toThrow(errorMessage);
        });
    });

    describe("register method", () => {
        it("should call authApi.register and return the response", async () => {
            const email = "test@example.com";
            const password = "password123";
            const mockResponse = {
                success: true,
                data: { user: { id: "1", email, userLevel: "BASIC" } },
            };

            (authApi.register as vi.Mock).mockResolvedValue(mockResponse);

            const result = await authService.register(email, password);

            expect(authApi.register).toHaveBeenCalledWith(email, password);
            expect(result).toEqual(mockResponse);
        });

        it("should handle registration errors", async () => {
            const email = "test@example.com";
            const password = "password123";
            const errorMessage = "Email already exists";

            (authApi.register as vi.Mock).mockRejectedValue(new Error(errorMessage));

            await expect(authService.register(email, password)).rejects.toThrow(errorMessage);
        });
    });

    describe("getProfile method", () => {
        it("should call authApi.getProfile and return the response", async () => {
            const mockResponse = {
                success: true,
                data: {
                    user: { id: "1", email: "test@example.com", userLevel: "VERIFIED" },
                    kodiakStatus: { accountId: "test-account-123", verified: true },
                },
            };
            (authApi.getProfile as vi.Mock).mockResolvedValue(mockResponse);

            const result = await authService.getProfile();

            expect(authApi.getProfile).toHaveBeenCalled();
            expect(result).toEqual(mockResponse);
        });

        it("should handle getProfile errors", async () => {
            const errorMessage = "Failed to get profile";
            (authApi.getProfile as vi.Mock).mockRejectedValue(new Error(errorMessage));

            await expect(authService.getProfile()).rejects.toThrow(errorMessage);
        });
    });

    describe("checkQualification method", () => {
        it("should call authApi.checkQualification and return the response", async () => {
            const mockResponse = {
                success: true,
                data: { isQualified: true, requirements: [], progress: 100 },
            };

            (authApi.checkQualification as vi.Mock).mockResolvedValue(mockResponse);

            const result = await authService.checkQualification();

            expect(authApi.checkQualification).toHaveBeenCalled();
            expect(result).toEqual(mockResponse);
        });

        it("should handle checkQualification errors", async () => {
            const errorMessage = "Failed to check qualification";
            (authApi.checkQualification as vi.Mock).mockRejectedValue(new Error(errorMessage));

            await expect(authService.checkQualification()).rejects.toThrow(errorMessage);
        });
    });

    describe("getQualificationConfig method", () => {
        it("should call authApi.getQualificationConfig and return the response", async () => {
            const mockResponse = {
                success: true,
                data: { requirements: ["email_verified", "profile_completed"] },
            };

            (authApi.getQualificationConfig as vi.Mock).mockResolvedValue(mockResponse);

            const result = await authService.getQualificationConfig();

            expect(authApi.getQualificationConfig).toHaveBeenCalled();
            expect(result).toEqual(mockResponse);
        });

        it("should handle getQualificationConfig errors", async () => {
            const errorMessage = "Failed to get qualification config";
            (authApi.getQualificationConfig as vi.Mock).mockRejectedValue(new Error(errorMessage));

            await expect(authService.getQualificationConfig()).rejects.toThrow(errorMessage);
        });
    });
});
