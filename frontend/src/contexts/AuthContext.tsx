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

  const checkAuth = async () => {
    try {
      setLoading(true);
      console.log('AuthContext: Checking authentication...');
      // Check authentication by making a request that requires auth
      // Cookies are automatically included with credentials: 'include'
      const response = await fetch('/api/user/profile', {
        credentials: 'include',
      });

      console.log('AuthContext: Profile response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('AuthContext: Profile response data:', data);
        if (data.success) {
          console.log('AuthContext: Setting user:', data.data);
          setUser(data.data);
        } else {
          console.log('AuthContext: Profile request failed');
          setUser(null);
        }
      } else {
        console.log('AuthContext: Profile request not ok, status:', response.status);
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
      // Make login request - backend sets httpOnly cookies
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies in request
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (data.success) {
        // After successful login, check auth to get user data
        await checkAuth();
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
      // Make register request - backend sets httpOnly cookies
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      if (data.success) {
        // After successful registration, check auth to get user data
        await checkAuth();
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
      // Call logout endpoint to clear cookies
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
    await checkAuth();
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
