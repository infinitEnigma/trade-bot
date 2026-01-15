/** @format */

import React, { createContext, useContext, useEffect, useState } from "react";
import { User } from "@trade-bot/shared";
import { api } from "../lib/api";
import { toast } from "sonner";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async (forceCheck = false) => {
    try {
      setLoading(true);
      console.log('AuthContext: Checking authentication...', { forceCheck });

      // Check if we're on login/register pages to avoid unnecessary API calls
      // But allow forced checks (like after login)
      const currentPath = window.location.pathname;
      if (!forceCheck && (currentPath === '/login' || currentPath === '/register')) {
        console.log('AuthContext: On auth page, skipping check (not forced)');
        setUser(null);
        setLoading(false);
        return;
      }

      // Use API client which handles cookie-based authentication properly
      const data = await api.getProfile();
      console.log('AuthContext: Profile response data:', data);
      if (data.success) {
        console.log('AuthContext: Setting user:', data.data);
        setUser(data.data);
      } else {
        console.log('AuthContext: Profile request failed');
        setUser(null);
      }
    } catch (error) {
      console.error('AuthContext: Auth check failed:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    console.log("AuthContext: Starting login for:", email);

    try {
      // Use API client for consistent cookie handling
      const data = await api.login(email, password);

      if (data.success) {
        // After successful login, refresh user data to get complete profile including Kodiak status
        console.log('AuthContext: Login successful, refreshing user profile');
        await refreshUser();

        toast.success("Login successful!");
      } else {
        throw new Error(data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error(error instanceof Error ? error.message : 'Login failed');
      throw error;
    }
  };

  const register = async (email: string, password: string) => {
    try {
      // Use API client for consistent cookie handling
      const data = await api.register(email, password);

      if (data.success) {
        // Set user data directly from register response
        console.log('AuthContext: Registration successful, setting user:', data.user);
        setUser(data.user);
        toast.success("Account created successfully!");
      } else {
        throw new Error(data.error || 'Registration failed');
      }
    } catch (error) {
      console.error('Registration error:', error);
      toast.error(error instanceof Error ? error.message : 'Registration failed');
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Call logout endpoint to clear cookies - using direct fetch since logout is special
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      // Clear local state regardless of API call success
      setUser(null);
      toast.success("Logged out successfully");
    }
  };

  const refreshUser = async () => {
    await checkAuth(true); // Force check even on auth pages
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
