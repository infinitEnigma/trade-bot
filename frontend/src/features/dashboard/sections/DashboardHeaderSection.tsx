/** @format */

import React from "react";
import { Link } from "react-router-dom";
import { Key, OctagonAlert, Target, Wallet } from "lucide-react";
import { useAuth } from "../../auth";
import type { DashboardAccess } from "../utils/dashboardAccess";

interface DashboardHeaderSectionProps {
  access: DashboardAccess;
  /**
   * Live needs-attention bot count (same cache `BotStatusPanel` reads —
   * passed down so the header stays pure). VERIFIED-only: when > 0 the
   * primary CTA becomes "Resolve alert" linking into /strategies.
   */
  needsAttentionCount?: number;
}

/**
 * Dashboard header — welcome message, tier chip and the single primary CTA
 * derived from `dashboardAccess`. Section CTAs elsewhere on the page must
 * stay consistent with this one (onboarding continuity).
 *
 * There is deliberately no "market status" element: crypto perps trade 24/7
 * and no such data source exists. Connection state lives in System Status
 * (TradingActivitySection), not here.
 */
export const DashboardHeaderSection: React.FC<DashboardHeaderSectionProps> = ({
  access,
  needsAttentionCount = 0,
}) => {
  const { user } = useAuth();
  const showResolveAlert =
    access.tier === "VERIFIED" && needsAttentionCount > 0;

  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-text">
          Welcome back{user?.username ? `, ${user.username}` : ""}
        </h1>
        <p className="text-sm text-textMuted mt-1">
          Your trading dashboard — market first, then your account.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium">
          {access.tier === "VERIFIED"
            ? "Verified"
            : access.tier === "REGISTERED"
              ? "Registered"
              : "Basic"}
        </span>
        {showResolveAlert ? (
          <Link
            to="/strategies"
            className="bg-danger/20 text-danger border border-danger/30 px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-danger/30 active:scale-95 inline-flex items-center gap-2"
          >
            <OctagonAlert className="w-5 h-5" />
            Resolve alert
            {needsAttentionCount > 1 ? ` (${needsAttentionCount})` : ""}
          </Link>
        ) : access.primaryAction === "connect-wallet" ? (
          <button
            onClick={() =>
              document
                .getElementById("wallet-widget")
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
            className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 inline-flex items-center gap-2"
          >
            <Wallet className="w-5 h-5" />
            Connect Wallet
          </button>
        ) : access.primaryAction === "verify-exchange" ? (
          <Link
            to="/settings"
            className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 inline-flex items-center gap-2"
          >
            <Key className="w-5 h-5" />
            Connect Exchange Account
          </Link>
        ) : (
          <Link
            to="/strategies"
            className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 inline-flex items-center gap-2"
          >
            <Target className="w-5 h-5" />
            Open Strategies
          </Link>
        )}
      </div>
    </div>
  );
};
