/** @format */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth, updateAuthUser } from "./useAuth";
import { authService } from "../services/authService";
import { UserLevel } from "../../../shared/types";

// Mock the auth service
vi.mock("../services/authService");

describe("useAuth hook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("initial state", () => {
        it("should initialize with default values", () => {
            const { result } = renderHook(() => useAuth());

            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
            expect(result.current.isLoading).toBe(false);
        });
    });

    describe("login functionality", () => {
        it("should handle login successfully", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.VERIFIED,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            (authService.login as vi.Mock).mockResolvedValue({
                success: true,
                data: { user: mockUser },
            });

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: true,
                data: mockUser,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.login({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            expect(authService.login).toHaveBeenCalledWith(
                "test@example.com",
                "password123"
            );
            expect(authService.getProfile).toHaveBeenCalled();
            expect(result.current.user).toEqual(mockUser);
            expect(result.current.isAuthenticated).toBe(true);
            expect(result.current.isLoading).toBe(false);
        });

        it("should handle login failure", async () => {
            const errorMessage = "Invalid credentials";
            (authService.login as vi.Mock).mockRejectedValue(
                new Error(errorMessage)
            );

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await expect(
                    result.current.login({
                        email: "test@example.com",
                        password: "wrongpassword",
                    })
                ).rejects.toThrow(errorMessage);
            });

            expect(authService.login).toHaveBeenCalled();
            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
            expect(result.current.isLoading).toBe(false);
        });
    });

    describe("register functionality", () => {
        it("should handle registration successfully", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.BASIC,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            (authService.register as vi.Mock).mockResolvedValue({
                success: true,
                data: { user: mockUser },
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.register({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            expect(authService.register).toHaveBeenCalledWith(
                "test@example.com",
                "password123"
            );
            expect(result.current.user).toEqual(mockUser);
            expect(result.current.isAuthenticated).toBe(true);
            expect(result.current.isLoading).toBe(false);
        });
    });

    describe("logout functionality", () => {
        it("should handle logout", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.VERIFIED,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            (authService.login as vi.Mock).mockResolvedValue({
                success: true,
                data: { user: mockUser },
            });

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: true,
                data: mockUser,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.login({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            expect(result.current.isAuthenticated).toBe(true);

            await act(async () => {
                await result.current.logout();
            });

            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
        });
    });

    describe("checkAuth functionality", () => {
        it("should check authentication status", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: "VERIFIED",
                roles: [],
            };

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: true,
                data: mockUser,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.checkAuth();
            });

            expect(authService.getProfile).toHaveBeenCalled();
            expect(result.current.user).toEqual(mockUser);
            expect(result.current.isAuthenticated).toBe(true);
        });
    });

    describe("updateAuthUser utility", () => {
        it("should update user data", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.BASIC,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            (authService.login as vi.Mock).mockResolvedValue({
                success: true,
                data: { user: mockUser },
            });

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: true,
                data: mockUser,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.login({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            act(() => {
                updateAuthUser({ userLevel: UserLevel.VERIFIED });
            });

            expect(result.current.user?.userLevel).toBe("VERIFIED");
        });

        it("should not update user if no user exists", async () => {
            // Create a fresh store instance
            const { result } = renderHook(() => useAuth());

            // Logout first to ensure clean state (in case previous tests left user logged in)
            await act(async () => {
                await result.current.logout();
            });

            act(() => {
                updateAuthUser({ userLevel: UserLevel.VERIFIED });
            });

            expect(result.current.user).toBeNull();
        });
    });

    describe("register functionality", () => {
        it("should handle registration failure", async () => {
            const errorMessage = "Email already exists";
            (authService.register as vi.Mock).mockRejectedValue(
                new Error(errorMessage)
            );

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await expect(
                    result.current.register({
                        email: "test@example.com",
                        password: "password123",
                    })
                ).rejects.toThrow(errorMessage);
            });

            expect(authService.register).toHaveBeenCalled();
            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
            expect(result.current.isLoading).toBe(false);
        });

        it("should handle registration with successful response but no user data", async () => {
            (authService.register as vi.Mock).mockResolvedValue({
                success: true,
                data: null,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.register({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            expect(authService.register).toHaveBeenCalled();
            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
            expect(result.current.isLoading).toBe(false);
        });
    });

    describe("logout functionality", () => {
        it("should handle logout when API call fails", async () => {
            // Mock fetch to reject
            global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.VERIFIED,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            (authService.login as vi.Mock).mockResolvedValue({
                success: true,
                data: { user: mockUser },
            });

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: true,
                data: mockUser,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.login({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            expect(result.current.isAuthenticated).toBe(true);

            await act(async () => {
                await result.current.logout();
            });

            expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.anything());
            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
        });
    });

    describe("checkAuth functionality", () => {
        it("should handle failed auth check", async () => {
            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: false,
                error: "Unauthorized",
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.checkAuth();
            });

            expect(authService.getProfile).toHaveBeenCalled();
            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
            expect(result.current.isLoading).toBe(false);
        });

        it("should handle checkAuth error", async () => {
            const errorMessage = "Network error";
            (authService.getProfile as vi.Mock).mockRejectedValue(
                new Error(errorMessage)
            );

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.checkAuth();
            });

            expect(authService.getProfile).toHaveBeenCalled();
            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
            expect(result.current.isLoading).toBe(false);
        });

        it("should skip auth check on login page", async () => {
            // Mock window.location
            Object.defineProperty(window, 'location', {
                value: { pathname: '/login' },
                writable: true,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.checkAuth();
            });

            expect(authService.getProfile).not.toHaveBeenCalled();
            expect(result.current.isLoading).toBe(false);
        });

        it("should skip auth check on register page", async () => {
            // Mock window.location
            Object.defineProperty(window, 'location', {
                value: { pathname: '/register' },
                writable: true,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.checkAuth();
            });

            expect(authService.getProfile).not.toHaveBeenCalled();
            expect(result.current.isLoading).toBe(false);
        });
    });

    describe("login functionality", () => {
        it("should fall back to login response if profile fetch fails", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.BASIC,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            (authService.login as vi.Mock).mockResolvedValue({
                success: true,
                data: { user: mockUser },
            });

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: false,
                error: "Failed to fetch profile",
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.login({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            expect(authService.login).toHaveBeenCalled();
            expect(authService.getProfile).toHaveBeenCalled();
            expect(result.current.user).toEqual(mockUser);
            expect(result.current.isAuthenticated).toBe(true);
            expect(result.current.isLoading).toBe(false);
        });

        it("should handle login with invalid response", async () => {
            (authService.login as vi.Mock).mockResolvedValue({
                success: false,
                error: "Invalid response",
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await expect(
                    result.current.login({
                        email: "test@example.com",
                        password: "password123",
                    })
                ).rejects.toThrow("Invalid response");
            });

            expect(authService.login).toHaveBeenCalled();
            expect(result.current.user).toBeNull();
            expect(result.current.isAuthenticated).toBe(false);
            expect(result.current.isLoading).toBe(false);
        });
    });

    describe("refreshUser functionality", () => {
        it("should refresh user data", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.VERIFIED,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Mock window.location to not be an auth page
            Object.defineProperty(window, 'location', {
                value: { pathname: '/dashboard' },
                writable: true,
            });

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: true,
                data: mockUser,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.refreshUser();
            });

            expect(authService.getProfile).toHaveBeenCalled();
            expect(result.current.user).toEqual(mockUser);
            expect(result.current.isAuthenticated).toBe(true);
        });
    });

    describe("updateAuthUser utility", () => {
        it("should not update user if no changes are made", async () => {
            const mockUser = {
                id: "1",
                email: "test@example.com",
                userLevel: UserLevel.BASIC,
                roles: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            (authService.login as vi.Mock).mockResolvedValue({
                success: true,
                data: { user: mockUser },
            });

            (authService.getProfile as vi.Mock).mockResolvedValue({
                success: true,
                data: mockUser,
            });

            const { result } = renderHook(() => useAuth());

            await act(async () => {
                await result.current.login({
                    email: "test@example.com",
                    password: "password123",
                });
            });

            const originalUser = { ...result.current.user };

            act(() => {
                updateAuthUser({ ...originalUser });
            });

            expect(result.current.user).toEqual(originalUser);
        });
    });
});
