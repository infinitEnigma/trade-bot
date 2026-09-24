/** @format */

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Star, Wallet as WalletIcon } from "lucide-react";
import { Card, MetricIcon, SectionHeader } from "../../../shared/components/ui";
import { walletApi, WalletDto } from "../../../infrastructure/api/wallet";
import { useAuth } from "../../auth/hooks";
import { SmartToast } from "../../../shared/utils/toast";

const CHAIN_BADGES: Record<string, string> = {
  evm: "bg-primary/10 text-primary",
  solana: "bg-purple-500/10 text-purple-400",
  bitcoin: "bg-warning/10 text-warning",
};

export const ConnectedWallets: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const walletsQuery = useQuery({
    queryKey: ["wallets", user?.id],
    queryFn: () => walletApi.listWallets(),
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["wallets", user?.id] });
    queryClient.invalidateQueries({ queryKey: ["user", user?.id] });
    refreshUser();
  };

  const primaryMutation = useMutation({
    mutationFn: (walletId: string) => walletApi.setPrimaryWallet(walletId),
    onSuccess: () => {
      SmartToast.success("Primary wallet updated");
      invalidate();
    },
    onError: () => SmartToast.error("Failed to update primary wallet"),
  });

  const unlinkMutation = useMutation({
    mutationFn: (walletId: string) => walletApi.unlinkWallet(walletId),
    onSuccess: response => {
      SmartToast.success(response.message || "Wallet unlinked");
      invalidate();
    },
    onError: () => SmartToast.error("Failed to unlink wallet"),
  });

  const wallets = walletsQuery.data?.data?.wallets ?? [];

  return (
    <Card>
      <SectionHeader
        title="Connected Wallets"
        subtitle="Linked multi-chain wallets for tier qualification"
        actions={<MetricIcon icon={WalletIcon} color="primary" />}
      />

      {walletsQuery.isLoading ? (
        <div className="flex items-center gap-2 p-4 text-textMuted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading wallets...
        </div>
      ) : walletsQuery.isError ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-danger/10 border border-danger/20">
          <AlertCircle className="w-4 h-4 text-danger shrink-0" />
          <div className="text-sm">
            <p className="text-danger font-medium">Failed to load wallets</p>
            <button
              type="button"
              onClick={() => walletsQuery.refetch()}
              className="text-danger hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      ) : wallets.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
          <AlertCircle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-warning text-sm">No wallets connected yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {wallets.map((wallet: WalletDto) => (
            <div
              key={wallet.id}
              className="flex flex-wrap items-center gap-3 p-4 rounded-lg bg-surface border border-white/5"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium uppercase ${
                      CHAIN_BADGES[wallet.chain] || "bg-white/5 text-textMuted"
                    }`}
                  >
                    {wallet.chain}
                  </span>
                  {wallet.isPrimary && (
                    <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning">
                      <Star className="w-3 h-3 fill-warning" />
                      Primary
                    </span>
                  )}
                  {wallet.label && (
                    <span className="text-xs text-textMuted font-medium">
                      {wallet.label}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text font-mono truncate mt-1">
                  {wallet.address}
                </p>
                {wallet.verifiedAt && (
                  <p className="text-xs text-success mt-0.5">
                    Verified {new Date(wallet.verifiedAt).toLocaleDateString()}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!wallet.isPrimary && (
                  <button
                    type="button"
                    onClick={() => primaryMutation.mutate(wallet.id)}
                    disabled={primaryMutation.isPending}
                    className="btn-secondary text-xs disabled:opacity-50"
                  >
                    Set Primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `Unlink wallet "${wallet.address.slice(0, 6)}...${wallet.address.slice(
                          -4
                        )}" (${wallet.chain})?`
                      )
                    ) {
                      unlinkMutation.mutate(wallet.id);
                    }
                  }}
                  disabled={unlinkMutation.isPending}
                  className="btn-danger text-xs disabled:opacity-50"
                >
                  Unlink
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
