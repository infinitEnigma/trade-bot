/** @format */

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Key, Loader2, XCircle } from "lucide-react";
import { Card, MetricIcon, SectionHeader } from "../../../shared/components/ui";
import {
  accountsApi,
  ExchangeAccountDto,
} from "../../../infrastructure/api/accounts";
import { useAuth } from "../../auth/hooks";
import { SmartToast } from "../../../shared/utils/toast";

const STATUS_STYLES: Record<ExchangeAccountDto["status"], string> = {
  ACTIVE: "bg-success/10 text-success",
  PENDING: "bg-warning/10 text-warning",
  INVALID: "bg-danger/10 text-danger",
  REVOKED: "bg-white/5 text-textMuted",
};

/**
 * ExchangeAccounts (C2) — lists every connected venue account with
 * per-account verify / disconnect actions (plan §3 C2 frontend deliverable).
 */
export const ExchangeAccounts: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", user?.id],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ["exchange-accounts", user?.id],
    });
    queryClient.invalidateQueries({ queryKey: ["kodiak-status", user?.id] });
    queryClient.invalidateQueries({ queryKey: ["user", user?.id] });
    // Level is recomputed server-side on verify/revoke — refresh the profile.
    refreshUser();
  };

  const verifyMutation = useMutation({
    mutationFn: (accountId: string) => accountsApi.verifyAccount(accountId),
    onSuccess: response => {
      SmartToast.success(response.message || "Account verified");
      invalidate();
    },
    onError: () => SmartToast.error("Failed to verify account"),
  });

  const revokeMutation = useMutation({
    mutationFn: (accountId: string) => accountsApi.revokeAccount(accountId),
    onSuccess: response => {
      SmartToast.success(response.message || "Account disconnected");
      invalidate();
    },
    onError: (error: unknown) => {
      const candidate = error as {
        response?: { data?: { error?: string }; status?: number };
        message?: string;
      };
      SmartToast.error(
        candidate?.response?.data?.error ||
          candidate?.message ||
          "Failed to disconnect account"
      );
    },
  });

  const accounts = accountsQuery.data?.data?.accounts ?? [];

  return (
    <Card>
      <SectionHeader
        title="Exchange Accounts"
        subtitle="Connected trading accounts (venue + environment)"
        actions={<MetricIcon icon={Key} color="primary" />}
      />

      {accountsQuery.isLoading ? (
        <div className="flex items-center gap-2 p-4 text-textMuted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading accounts...
        </div>
      ) : accountsQuery.isError ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-danger/10 border border-danger/20">
          <AlertCircle className="w-4 h-4 text-danger shrink-0" />
          <div className="text-sm">
            <p className="text-danger font-medium">Failed to load accounts</p>
            <button
              type="button"
              onClick={() => accountsQuery.refetch()}
              className="text-danger hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
          <AlertCircle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-warning text-sm">
            No exchange accounts connected yet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map(account => (
            <div
              key={account.id}
              className="flex flex-wrap items-center gap-3 p-4 rounded-lg bg-surface border border-white/5"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text capitalize">
                    {account.exchange}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-white/5 text-textMuted uppercase">
                    {account.environment}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      STATUS_STYLES[account.status]
                    }`}
                  >
                    {account.status}
                  </span>
                </div>
                <p className="text-sm text-textMuted font-mono truncate mt-1">
                  {account.accountRef}
                </p>
                {account.status === "ACTIVE" && account.verifiedAt && (
                  <p className="text-xs text-success mt-0.5">
                    Verified {new Date(account.verifiedAt).toLocaleDateString()}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(account.status === "PENDING" ||
                  account.status === "INVALID") && (
                  <button
                    type="button"
                    onClick={() => verifyMutation.mutate(account.id)}
                    disabled={verifyMutation.isPending}
                    className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
                  >
                    {verifyMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    Verify
                  </button>
                )}
                {account.status !== "REVOKED" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `Disconnect ${account.exchange} (${account.environment}) account "${account.accountRef}"? Your user level is recomputed from the remaining accounts.`
                        )
                      ) {
                        revokeMutation.mutate(account.id);
                      }
                    }}
                    disabled={revokeMutation.isPending}
                    className="btn-danger flex items-center gap-1.5 text-xs disabled:opacity-50"
                  >
                    {revokeMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
