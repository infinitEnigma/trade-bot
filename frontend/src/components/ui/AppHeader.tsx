/** @format */

import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  Settings as SettingsIcon,
  LogOut,
  User,
  CreditCard,
  Zap,
  ChevronDown,
} from "lucide-react";

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  showNavigation?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title = "Trade Bot",
  subtitle = "Automated Trading Platform",
  showNavigation = true,
}) => {
  const { user, logout } = useAuth();

  return (
    <header className="glass-card border-b border-white/5 sticky top-0 z-50">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-linear-to-br from-primary to-accent flex items-center justify-center shadow-lg">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-bg-surface animate-pulse"></div>
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-linear-to-r from-primary via-accent to-purple-500 bg-clip-text text-transparent">
                {title}
              </h1>
              <p className="text-xs text-text-tertiary">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {showNavigation && (
              <div className="hidden md:flex items-center gap-4">
                <Link
                  to="/strategies"
                  className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200 flex items-center gap-2"
                >
                  Strategies
                </Link>
                <Link
                  to="/analytics"
                  className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200 flex items-center gap-2"
                >
                  Analytics
                </Link>
                <Link
                  to="/settings"
                  className="px-4 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all duration-200 flex items-center gap-2"
                >
                  <SettingsIcon className="w-4 h-4" />
                  Settings
                </Link>
              </div>
            )}

            {/* User Profile with dropdown */}
            <div className="relative group">
              <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-linear-to-r from-bg-surface to-bg-surface-light border border-white/5 cursor-pointer hover:border-white/10 transition-all">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-linear-to-br from-primary to-accent flex items-center justify-center">
                    <span className="text-sm font-bold text-white">
                      {user?.email?.[0]?.toUpperCase() || "U"}
                    </span>
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-bg-surface bg-green-500"></div>
                </div>
                <div className="hidden md:block">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {user?.email?.split("@")[0] || "User"}
                    </span>
                    <span
                      className={`px-2 py-1 text-xs rounded-full font-medium ${
                        user?.userLevel === "VERIFIED"
                          ? "bg-green-500/20 text-green-400"
                          : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {user?.userLevel || "BASIC"}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Last login: Just now
                  </p>
                </div>
                <ChevronDown className="w-4 h-4 text-text-tertiary" />
              </div>

              {/* Dropdown Menu */}
              <div className="absolute right-0 top-full mt-2 w-64 glass-card opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform translate-y-2 group-hover:translate-y-0">
                <div className="p-4 border-b border-white/5">
                  <p className="text-sm font-medium text-text-primary">
                    {user?.email}
                  </p>
                  <p className="text-xs text-text-tertiary mt-1">
                    Trading Account
                  </p>
                </div>
                <div className="p-2">
                  <Link
                    to="/profile"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <User className="w-4 h-4" />
                    <span className="text-sm">Profile Settings</span>
                  </Link>
                  <Link
                    to="/billing"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span className="text-sm">Billing</span>
                  </Link>
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="text-sm">Logout</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
