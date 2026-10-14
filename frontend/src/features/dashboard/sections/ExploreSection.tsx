/** @format */

import React from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  Key,
  RefreshCw,
  Settings,
  Target,
  Wallet,
} from "lucide-react";
import { Card } from "../../../shared/components/ui/Card";
import { SectionHeader } from "../../../shared/components/ui/SectionHeader";
import type { DashboardAccess } from "../utils/dashboardAccess";

interface ExploreSectionProps {
  access: DashboardAccess;
  /** Refresh the portfolio figures (same `refresh` the account strip uses). */
  onRefresh: () => void;
  refreshing: boolean;
}

/**
 * Explore — always last, every tier. Tier-aware next steps with no dead
 * ends: links resolve only to routes the tier can actually open (Strategies
 * VERIFIED, Analytics VERIFIED + QUALIFIED_ALPHA via `canViewAnalytics`).
 * There is deliberately no help link — no help surface exists in the app.
 */
export const ExploreSection: React.FC<ExploreSectionProps> = ({
  access,
  onRefresh,
  refreshing,
}) => {
  const scrollToWallet = () =>
    document
      .getElementById("wallet-widget")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <Card>
      <SectionHeader title="Explore" subtitle="Next steps for your account" />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {access.tier === "BASIC" && (
          <button
            onClick={scrollToWallet}
            className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4"
          >
            <Wallet className="w-4 h-4" />
            Connect wallet
          </button>
        )}
        {access.tier !== "VERIFIED" && (
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4"
          >
            {access.tier === "BASIC" ? (
              <Key className="w-4 h-4" />
            ) : (
              <Settings className="w-4 h-4" />
            )}
            {access.tier === "BASIC"
              ? "How verification works"
              : "Connect exchange account"}
          </Link>
        )}
        {access.tier === "VERIFIED" && (
          <>
            <Link
              to="/strategies"
              className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4"
            >
              <Target className="w-4 h-4" />
              Manage Strategies
            </Link>
            {access.canViewAnalytics && (
              <Link
                to="/analytics"
                className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4"
              >
                <BarChart3 className="w-4 h-4" />
                View Analytics
              </Link>
            )}
          </>
        )}
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4"
        >
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4 disabled:opacity-50"
        >
          <RefreshCw
            className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh figures
        </button>
      </div>
    </Card>
  );
};
