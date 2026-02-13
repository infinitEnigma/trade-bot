/** @format */

//import { useEffect, useRef } from "react";
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
            isLoading: false, // Start as false to prevent automatic auth checks

            login: async ({ email, password }: { email: string; password: string }) => {
                try {
                    set({ isLoading: true });
                    const response = await authService.login(email, password);

                    if (response.success && response.data?.user) {
                        // Login successful - now fetch complete user profile for accurate data
                        const profileResponse = await authService.getProfile();

                        if (profileResponse.success && profileResponse.data) {
                            // Check if user is verified and needs admin qualification check
                            if (profileResponse.data.user.userLevel === 'VERIFIED') {
                                try {
                                    const adminQualificationResponse = await authService.checkAdminQualification();
                                    if (adminQualificationResponse.success && adminQualificationResponse.data?.isQualified) {
                                        // Add SYSTEM_ADMIN role to user if qualified
                                        profileResponse.data.user.roles = [...(profileResponse.data.user.roles || []), 'SYSTEM_ADMIN'];
                                    }
                                } catch (adminError) {
                                    console.error("Admin qualification check failed:", adminError);
                                    // Continue login even if admin check fails
                                }
                            }

                            // Use complete user data from /api/auth/me for accurate user level
                            set({
                                user: profileResponse.data.user as AuthUser,
                                isAuthenticated: true,
                                isLoading: false,
                            });
                        } else {
                            // Fallback to login response if profile fetch fails
                            set({
                                user: response.data.user as AuthUser,
                                isAuthenticated: true,
                                isLoading: false,
                            });
                        }
                        toast.success("Login successful!");
                    } else {
                        throw new Error(response.error || "Login failed");
                    }
                } catch (error) {
                    console.error("Login error:", error);
                    toast.error(error instanceof Error ? error.message : "Login failed");
                    set({
                        user: null,
                        isAuthenticated: false,
                    });
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
                        if (response.data?.user) {
                            set({
                                user: response.data.user as AuthUser,
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
                    set({
                        user: null,
                        isAuthenticated: false,
                    });
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
                console.log("🔄 AUTH: checkAuth() called");
                try {
                    set({ isLoading: true });

                    // Skip check on auth pages to avoid rate limiting during login
                    const currentPath = window.location.pathname;
                    const isAuthPage = currentPath === "/login" || currentPath === "/register";

                    if (isAuthPage) {
                        console.log("🔄 AUTH: Skipping checkAuth on auth page:", currentPath);
                        // Completely skip API call on login/register pages
                        set({ isLoading: false });
                        return;
                    }

                    console.log("🔄 AUTH: Making API call to check auth");
                    const response = await authService.getProfile();

                    if (response.success && response.data) {
                        console.log("🔄 AUTH: Auth check successful, user:", response.data.user.userLevel);

                        // Check if user is verified and needs admin qualification check
                        if (response.data.user.userLevel === 'VERIFIED') {
                            try {
                                const adminQualificationResponse = await authService.checkAdminQualification();
                                if (adminQualificationResponse.success && adminQualificationResponse.data?.isQualified) {
                                    // Add SYSTEM_ADMIN role to user if qualified
                                    response.data.user.roles = [...(response.data.user.roles || []), 'SYSTEM_ADMIN'];
                                }
                            } catch (adminError) {
                                console.error("Admin qualification check failed:", adminError);
                                // Continue login even if admin check fails
                            }
                        }

                        set({
                            user: response.data.user as AuthUser,
                            isAuthenticated: true,
                            isLoading: false,
                        });
                    } else {
                        console.log("🔄 AUTH: Auth check failed - no valid user data");
                        set({
                            user: null,
                            isAuthenticated: false,
                            isLoading: false,
                        });
                    }
                } catch (error) {
                    console.error("🔄 AUTH: Auth check failed with error:", error);
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
            // Prevent automatic auth checks during rehydration
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Ensure loading state is false after rehydration
                    state.isLoading = false;
                }
            },
        }
    )
);

/**
 * Auth hook - provides authentication state and actions
 * NOTE: This hook provides state only and does NOT trigger automatic API calls
 * Use React Query hooks (useUser, useKodiakStatus) for data fetching with caching
 *
 * IMPORTANT: No useEffects in this hook to prevent infinite loops and memory leaks
 * Auth state management is handled by the store and React Query hooks
 */
export const useAuth = () => {
    return useAuthStore();
};

/**
 * Utility function to update user data in the auth store
 * Used by mutations that change user state without making API calls
 */
export const updateAuthUser = (userData: Partial<AuthUser>) => {
    useAuthStore.setState((state) => {
        if (!state.user) return state; // No user to update

        const updatedUser = { ...state.user, ...userData };

        // Only update if something actually changed
        if (JSON.stringify(state.user) !== JSON.stringify(updatedUser)) {
            return { ...state, user: updatedUser };
        }

        return state; // No change needed
    });
};
