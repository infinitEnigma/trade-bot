/** @format */

import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authService } from "../services/authService";
import { AuthUser, AuthState, AuthActions } from "../types/auth.types";
import { toast } from "sonner";

interface AuthStore extends AuthState, AuthActions { }

const useAuthStore = create<AuthStore>()(
    persist(
        (set, get) => ({
            user: null,
            isAuthenticated: false,
            isLoading: true,

            login: async ({ email, password }: { email: string; password: string }) => {
                try {
                    set({ isLoading: true });
                    const response = await authService.login(email, password);

                    if (response.success) {
                        // Refresh user profile after login
                        await get().checkAuth();
                        toast.success("Login successful!");
                    } else {
                        throw new Error(response.error || "Login failed");
                    }
                } catch (error) {
                    console.error("Login error:", error);
                    toast.error(error instanceof Error ? error.message : "Login failed");
                    throw error;
                } finally {
                    set({ isLoading: false });
                }
            },

            register: async ({ email, password }: { email: string; password: string }) => {
                try {
                    set({ isLoading: true });
                    const response = await authService.register(email, password);

                    if (response.success) {
                        // Set user directly from register response
                        if (response.user) {
                            set({
                                user: response.user as AuthUser,
                                isAuthenticated: true,
                                isLoading: false,
                            });
                        }
                        toast.success("Account created successfully!");
                    } else {
                        throw new Error(response.error || "Registration failed");
                    }
                } catch (error) {
                    console.error("Registration error:", error);
                    toast.error(error instanceof Error ? error.message : "Registration failed");
                    throw error;
                } finally {
                    set({ isLoading: false });
                }
            },

            logout: async () => {
                try {
                    // Call logout endpoint to clear cookies
                    await fetch("/api/auth/logout", {
                        method: "POST",
                        credentials: "include",
                    });
                } catch (error) {
                    console.error("Logout request failed:", error);
                } finally {
                    // Clear local state
                    set({
                        user: null,
                        isAuthenticated: false,
                        isLoading: false,
                    });
                    toast.success("Logged out successfully");
                }
            },

            refreshUser: async () => {
                await get().checkAuth();
            },

            checkAuth: async () => {
                try {
                    set({ isLoading: true });

                    // Skip check on auth pages unless forced
                    const currentPath = window.location.pathname;
                    const isAuthPage = currentPath === "/login" || currentPath === "/register";

                    if (isAuthPage && !get().user) {
                        set({ isLoading: false });
                        return;
                    }

                    const response = await authService.getProfile();

                    if (response.success && response.data) {
                        set({
                            user: response.data as AuthUser,
                            isAuthenticated: true,
                            isLoading: false,
                        });
                    } else {
                        set({
                            user: null,
                            isAuthenticated: false,
                            isLoading: false,
                        });
                    }
                } catch (error) {
                    console.error("Auth check failed:", error);
                    set({
                        user: null,
                        isAuthenticated: false,
                        isLoading: false,
                    });
                }
            },
        }),
        {
            name: "auth-storage",
            partialize: (state) => ({
                user: state.user,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);

/**
 * Auth hook - provides authentication state and actions
 */
export const useAuth = () => {
    const store = useAuthStore();

    // Auto-check auth on mount
    useEffect(() => {
        if (store.isLoading) {
            store.checkAuth();
        }
    }, []);

    // Periodic refresh for logged-in users
    useEffect(() => {
        if (!store.user) return;

        const refreshInterval = setInterval(() => {
            store.checkAuth();
        }, 5 * 60 * 1000); // 5 minutes

        return () => clearInterval(refreshInterval);
    }, [store.user]);

    // Refresh on page visibility change
    useEffect(() => {
        if (!store.user) return;

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                store.checkAuth();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [store.user]);

    // Refresh on network reconnection
    useEffect(() => {
        if (!store.user) return;

        const handleOnline = () => {
            store.checkAuth();
        };

        window.addEventListener("online", handleOnline);
        return () => window.removeEventListener("online", handleOnline);
    }, [store.user]);

    return store;
};
