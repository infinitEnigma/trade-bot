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
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      try {
        const response = await api.getProfile();
        setUser(response.data);
      } catch (error) {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        setUser(null);
      }
    }
    setLoading(false);
  };

  // Handle logout events from API client
  useEffect(() => {
    const handleLogout = () => {
      setUser(null);
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    };

    window.addEventListener("auth:logout", handleLogout);

    return () => {
      window.removeEventListener("auth:logout", handleLogout);
    };
  }, []);

  // Token refresh handled by API interceptors when needed
  // No proactive polling to reduce performance overhead

  // Track user activity (single essential event listener)
  useEffect(() => {
    const updateActivity = () => {
      localStorage.setItem("lastActivity", Date.now().toString());
    };

    // Only track clicks - essential for user activity detection
    document.addEventListener("click", updateActivity, { passive: true });

    return () => {
      document.removeEventListener("click", updateActivity);
    };
  }, []);

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    console.log("AuthContext: Starting login for:", email);
    const response = await api.login(email, password);
    console.log("AuthContext: Login response:", response);
    const { tokens, user: userData } = response;
    const { accessToken, refreshToken } = tokens;
    console.log("AuthContext: Storing tokens:");
    console.log(
      "- accessToken:",
      accessToken ? `${accessToken.substring(0, 20)}...` : "null"
    );
    console.log(
      "- refreshToken:",
      refreshToken ? `${refreshToken.substring(0, 20)}...` : "null"
    );
    console.log("- userData:", userData);
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    setUser(userData);
    console.log("AuthContext: User set to:", userData);
    toast.success("Login successful!");
  };

  const register = async (email: string, password: string) => {
    const response = await api.register(email, password);
    const { tokens, user: userData } = response;
    const { accessToken, refreshToken } = tokens;
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    setUser(userData);
    toast.success("Account created successfully!");
  };

  const logout = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setUser(null);
    toast.success("Logged out successfully");
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
