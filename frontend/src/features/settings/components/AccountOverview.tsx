/** @format */

import React from "react";
import { Shield, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { MetricIcon } from "../../../shared/components/ui";
import { AccountOverview as AccountOverviewType } from "../types/settings.types";

interface AccountOverviewProps {
  overview: AccountOverviewType;
  statusLoading: boolean;
}

/**
 * AccountOverview component - displays account status and connection info
 */
export const AccountOverview: React.FC<AccountOverviewProps> = ({
  overview,
  statusLoading
}) => {
  return (
    <Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-white/5">
          <MetricIcon icon={Shield} color="primary" />
          <div>
            <p className="text-sm text-textMuted">User Level</p>
            <p className="font-medium text-text">{overview.userLevel}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-white/5">
          <MetricIcon icon={CheckCircle} color="success" />
          <div>
            <p className="text-sm text-textMuted">Account Status</p>
            <p className="font-medium text-text">{overview.accountStatus}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-lg bg-surface border border-white/5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            statusLoading ? "bg-warning/10" : overview.kodiakConnected ? "bg-success/10" : "bg-warning/10"
          }`}>
            {statusLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-warning" />
            ) : overview.kodiakConnected ? (
              <CheckCircle className="w-4 h-4 text-success" />
            ) : (
              <XCircle className="w-4 h-4 text-warning" />
            )}
          </div>
          <div>
            <p className="text-sm text-textMuted">Kodiak Status</p>
            <p className="font-medium text-text">
              {statusLoading
                ? "Loading..."
                : overview.kodiakConnected
                  ? "Connected"
                  : "Not Connected"}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
};
