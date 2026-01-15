/** @format */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  userLevel: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User) => void;
  clearAuth: () => void;
  updateUser: (user: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, _get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,

      setAuth: (user) =>
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        }),

      clearAuth: () =>
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setLoading: (loading) => set({ isLoading: loading }),

      checkAuth: async () => {
        try {
          set({ isLoading: true });
          // Check if user is authenticated by making a request that requires auth
          const response = await fetch('/api/user/profile', {
            credentials: 'include', // Include httpOnly cookies
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
              set({
                user: {
                  id: data.data.id,
                  email: data.data.email,
                  userLevel: data.data.userLevel,
                },
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
          } else {
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
            });
          }
        } catch (error) {
          console.error('Auth check failed:', error);
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },

      logout: async () => {
        try {
          // Call logout endpoint to clear cookies
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
          });
        } catch (error) {
          console.error('Logout request failed:', error);
        } finally {
          // Clear local state regardless of API call success
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

export const useAuth = () => {
  const store = useAuthStore();
  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    setAuth: store.setAuth,
    clearAuth: store.clearAuth,
    updateUser: store.updateUser,
    checkAuth: store.checkAuth,
    logout: store.logout,
  };
};
