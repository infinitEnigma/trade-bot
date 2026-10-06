/** @format */

//import { useEffect, useRef } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authService } from "../services/authService";
import { AuthUser, AuthState, AuthActions } from "../types/auth.types";
import { toast } from "sonner";
import { httpClient } from "../../../infrastructure/api/client";
import { clearQueryCache } from "../../../shared/components/WalletProvider";

/**
 * Fix A: drop every trace of the previous session before a new identity
 * takes over. Covers:
 * - the persisted zustand `auth-storage` (rehydrates synchronously, so a
 *   stale VERIFIED user renders until the new profile arrives);
 * - the app-scoped React Query cache (`["user", oldId]`, …);
 * - the wagmi browser-wallet session (per-browser, not per-app-user) via an
 *   `auth:disconnect-wallet` event the wallet layer listens for.
 */
const clearPreviousSession = async (): Promise<void> => {
  try {
    localStorage.removeItem("auth-storage");
  } catch {
    // Storage may be unavailable (private mode) — state reset below still runs.
  }
  try {
    await clearQueryCache();
  } catch {
    // Cache clear is best-effort; fresh fetches overwrite stale entries.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auth:disconnect-wallet"));
  }
};

interface AuthStore extends AuthState, AuthActions {}

const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false, // Start as false to prevent automatic auth checks

      login: async ({
        email,
        password,
      }: {
        email: string;
        password: string;
      }) => {
        try {
          set({ isLoading: true });
          const response = await authService.login(email, password);

          if (response.success && response.data?.user) {
            // Fix A: a new identity takes over — drop the previous session
            // (auth-storage, query cache, wallet) BEFORE fetching the new
            // profile so no stale VERIFIED user/wallet renders or caches.
            await clearPreviousSession();

            // Login successful - now fetch complete user profile for accurate data
            const profileResponse = await authService.getProfile();

            if (profileResponse.success && profileResponse.data) {
              // Check if user is verified and needs admin qualification check
              if (profileResponse.data.user.userLevel === "VERIFIED") {
                try {
                  const adminQualificationResponse =
                    await authService.checkAdminQualification();
                  if (
                    adminQualificationResponse.success &&
                    adminQualificationResponse.data?.isQualified
                  ) {
                    // Add SYSTEM_ADMIN role to user if qualified
                    profileResponse.data.user.roles = [
                      ...(profileResponse.data.user.roles || []),
                      "SYSTEM_ADMIN",
                    ];
                  }
                } catch (adminError) {
                  console.error(
                    "Admin qualification check failed:",
                    adminError
                  );
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

      register: async ({
        username,
        email,
        password,
      }: {
        username?: string;
        email: string;
        password: string;
      }) => {
        try {
          set({ isLoading: true });
          const response = await authService.register(
            email,
            password,
            username
          );

          if (response.success) {
            // Fix A: same as login — purge the previous session before the
            // freshly registered user is written to the store.
            await clearPreviousSession();

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
          toast.error(
            error instanceof Error ? error.message : "Registration failed"
          );
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
          // Fix A: use the shared HTTP client — the old relative-URL fetch
          // never reached the API origin (VITE_API_URL) in dev, so the
          // backend never cleared cookies/refresh-token server-side.
          await httpClient.getClient().post("/api/auth/logout");
        } catch (error) {
          console.error("Logout request failed:", error);
        } finally {
          // Fix A: drop persisted state, query cache and wallet session.
          await clearPreviousSession();
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

          // Skip check on auth pages and landing page to avoid rate limiting
          const currentPath = window.location.pathname;
          const isAuthPage =
            currentPath === "/login" || currentPath === "/register";
          const isLandingPage = currentPath === "/";

          if (isAuthPage || isLandingPage) {
            console.log("🔄 AUTH: Skipping checkAuth on", currentPath);
            set({ isLoading: false });
            return;
          }

          console.log("🔄 AUTH: Making API call to check auth");
          const response = await authService.getProfile();

          if (response.success && response.data) {
            console.log(
              "🔄 AUTH: Auth check successful, user:",
              response.data.user.userLevel
            );

            // Check if user is verified and needs admin qualification check
            if (response.data.user.userLevel === "VERIFIED") {
              try {
                const adminQualificationResponse =
                  await authService.checkAdminQualification();
                if (
                  adminQualificationResponse.success &&
                  adminQualificationResponse.data?.isQualified
                ) {
                  // Add SYSTEM_ADMIN role to user if qualified
                  response.data.user.roles = [
                    ...(response.data.user.roles || []),
                    "SYSTEM_ADMIN",
                  ];
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
      partialize: state => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      // Prevent automatic auth checks during rehydration
      onRehydrateStorage: () => state => {
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

export { useAuthStore };

// Module-level listener: the HTTP client (infrastructure/api/client.ts) fires
// these events when the session is definitively dead (-1002) or a redirect to
// /login is imminent. Registered once at module scope — no component effects.
// Without this, the persisted zustand store rehydrated a stale "authenticated"
// user after redirects (wallet-signing bug: settings still showed BASIC).
if (typeof window !== "undefined") {
  const handleSessionInvalidated = () => {
    console.warn("Auth state invalidated by session-expired event");
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  };
  window.addEventListener("auth:session-expired", handleSessionInvalidated);
  window.addEventListener("auth:logout", handleSessionInvalidated);
}

/**
 * Utility function to update user data in the auth store
 * Used by mutations that change user state without making API calls
 */
export const updateAuthUser = (userData: Partial<AuthUser>) => {
  useAuthStore.setState(state => {
    if (!state.user) return state; // No user to update

    const updatedUser = { ...state.user, ...userData };

    // Only update if something actually changed
    if (JSON.stringify(state.user) !== JSON.stringify(updatedUser)) {
      return { ...state, user: updatedUser };
    }

    return state; // No change needed
  });
};
