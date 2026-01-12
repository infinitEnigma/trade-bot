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

  // Proactive token refresh for active users
  useEffect(() => {
    if (!user) return;

    const refreshInterval = setInterval(async () => {
      try {
        const refreshToken = localStorage.getItem("refreshToken");
        if (refreshToken) {
          // Only refresh if user has been active (has made API calls recently)
          const lastActivity = localStorage.getItem("lastActivity");
          const now = Date.now();

          if (lastActivity && now - parseInt(lastActivity) < 30 * 60 * 1000) {
            // 30 minutes
            // Import axios directly to avoid interceptors
            const { default: axios } = await import("axios");
            const response = await axios.post(
              "http://localhost:3000/api/auth/refresh",
              {
                refreshToken,
              }
            );

            const { accessToken, refreshToken: newRefreshToken } =
              response.data.tokens;
            localStorage.setItem("accessToken", accessToken);
            if (newRefreshToken) {
              localStorage.setItem("refreshToken", newRefreshToken);
            }
          }
        }
      } catch (error) {
        console.error("Proactive token refresh failed:", error);
      }
    }, 45 * 60 * 1000); // Refresh every 45 minutes

    return () => clearInterval(refreshInterval);
  }, [user]);

  // Track user activity
  useEffect(() => {
    const updateActivity = () => {
      localStorage.setItem("lastActivity", Date.now().toString());
    };

    // Track various user activities
    const events = [
      "mousedown",
      "mousemove",
      "keypress",
      "scroll",
      "touchstart",
      "click",
    ];
    events.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, updateActivity);
      });
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
