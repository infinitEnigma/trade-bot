/** @format */

import React, { Suspense } from "react";
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { WalletConnectDialog } from "../../../components/WalletConnectDialog";
import { Loader2 } from "lucide-react";

interface QuickActionsProps {
  hasKodiakAccess: boolean;
  userLevel?: string;
}

/**
 * QuickActions component - sidebar with action buttons and status
 */
export const QuickActions: React.FC<QuickActionsProps> = ({
  hasKodiakAccess,
  userLevel
}) => {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-text mb-4">
        Quick Actions
      </h2>
      <div className="space-y-3">
        <Link
          to="/strategies"
          className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          <Activity className="w-4 h-4" />
          Manage Strategies
        </Link>
      </div>

      {/* Wallet Status Widget - only for registered users */}
      {hasKodiakAccess && (
        <div className="mt-6 pt-6 border-t border-white/5">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            }
          >
            <WalletConnectDialog />
          </Suspense>
        </div>
      )}

      {/* System Status */}
      <div className="mt-6 pt-6 border-t border-white/5">
        <h3 className="text-sm font-medium text-textMuted mb-3">
          System Status
        </h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text">API Connection</span>
            <span className="flex items-center gap-2 text-sm text-success">
              <span className="w-2 h-2 rounded-full bg-success" />
              Connected
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text">Bot Engine</span>
            <span className="flex items-center gap-2 text-sm text-warning">
              <span className="w-2 h-2 rounded-full bg-warning" />
              Idle
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text">Last Sync</span>
            <span className="text-sm text-textMuted">Just now</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
