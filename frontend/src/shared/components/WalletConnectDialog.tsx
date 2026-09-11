/** @format */

import React, { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import { toast } from "sonner";
import { walletApi } from "../../infrastructure/api";
import { useAuth } from "../../features/auth";

interface WalletConnectDialogProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const WalletConnectDialog: React.FC<WalletConnectDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { user, refreshUser } = useAuth();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [isVerifying, setIsVerifying] = useState(false);
  const [isSigning, setIsSigning] = useState(false);

  // Force re-render when wallet state changes
  useEffect(() => {
    // This effect ensures the component re-renders when wallet state changes
  }, [isConnected, address]);

  const handleConnect = () => {
    connect({ connector: injected() });
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const handleVerifyWallet = async () => {
    if (!address) return;

    setIsSigning(true);
    try {
      // Create a message for the user to sign
      const message = `Verify wallet ownership for Trade Bot account.\n\nWallet: ${address}\nTimestamp: ${Date.now()}`;

      // Sign the message
      const signature = await signMessageAsync({ message });

      setIsSigning(false);
      setIsVerifying(true);

      // Verify with backend
      await walletApi.verifyWallet({
        walletAddress: address,
        signature,
        message,
      });

      toast.success("Wallet verified successfully!");
      await refreshUser(); // Refresh user data to get updated verification status
    } catch (error) {
      console.error("Wallet verification failed:", error);
      toast.error("Wallet verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
      setIsSigning(false);
    }
  };

  const isVerified = user?.userLevel === "VERIFIED";
  const hasKodiakConnection = user?.userLevel === "REGISTERED" || isVerified;

  // If modal mode (isOpen provided), render as modal
  if (isOpen !== undefined) {
    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">
              Wallet Verification
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4">
            {!hasKodiakConnection && (
              <div className="bg-yellow-900 border border-yellow-700 rounded p-3">
                <p className="text-yellow-200 text-sm">
                  You need to connect your Kodiak account first before verifying
                  your wallet.
                </p>
              </div>
            )}

            {hasKodiakConnection && isVerified && (
              <div className="bg-green-900 border border-green-700 rounded p-3">
                <p className="text-green-200 text-sm">
                  ✓ Your wallet is already verified! You have full access to all
                  features.
                </p>
              </div>
            )}

            {hasKodiakConnection && !isVerified && (
              <>
                {!isConnected ? (
                  <div className="text-center">
                    <p className="text-gray-300 mb-4">
                      Connect your wallet to verify ownership and unlock full
                      platform access.
                    </p>
                    <button
                      onClick={handleConnect}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                    >
                      Connect Wallet
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-gray-800 rounded p-3">
                      <p className="text-gray-300 text-sm mb-1">
                        Connected Wallet:
                      </p>
                      <p className="text-white font-mono text-sm">{address}</p>
                    </div>

                    <div className="text-center">
                      <p className="text-gray-300 mb-4">
                        Sign a message to prove wallet ownership and get
                        VERIFIED status.
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={handleVerifyWallet}
                          disabled={isSigning || isVerifying}
                          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-6 py-2 rounded-lg font-medium transition-colors flex-1"
                        >
                          {isSigning
                            ? "Signing..."
                            : isVerifying
                              ? "Verifying..."
                              : "Verify Wallet"}
                        </button>
                        <button
                          onClick={handleDisconnect}
                          className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="text-xs text-gray-500 mt-4">
              <p>
                • Only VERIFIED users can access trading strategies and bot
                configuration
              </p>
              <p>
                • Wallet verification ensures you own the connected Kodiak
                account
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render as persistent widget
  return (
    <div className="bg-[rgba(19,19,26,0.7)] backdrop-blur-md border border-white/5 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">
          Wallet Status
        </h3>
        <div
          className={`w-3 h-3 rounded-full ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        ></div>
      </div>

      {hasKodiakConnection ? (
        <div className="space-y-3">
          {isVerified ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
                  <span className="text-green-400 text-xs">✓</span>
                </div>
                <span className="text-sm text-green-400">Wallet Verified</span>
              </div>
              {isConnected ? (
                <div className="flex items-center justify-between">
                  <div className="bg-bg-surface rounded px-2 py-1">
                    <p className="text-text-primary font-mono text-xs">
                      {address?.slice(0, 6)}...{address?.slice(-4)}
                    </p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="text-text-tertiary hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                    title="Disconnect Wallet"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-text-tertiary text-sm mb-2">
                    Reconnect wallet
                  </p>
                  <button
                    onClick={handleConnect}
                    className="w-full bg-primary hover:bg-primary/80 text-white px-3 py-2 rounded-lg font-medium text-sm transition-colors"
                  >
                    Connect Wallet
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {!isConnected ? (
                <div className="text-center">
                  <p className="text-text-tertiary text-sm mb-3">
                    Connect wallet to verify ownership
                  </p>
                  <button
                    onClick={handleConnect}
                    className="w-full bg-primary hover:bg-primary/80 text-white px-3 py-2 rounded-lg font-medium text-sm transition-colors"
                  >
                    Connect Wallet
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="bg-bg-surface rounded p-2">
                      <p className="text-text-tertiary text-xs mb-1">
                        Connected:
                      </p>
                      <p className="text-text-primary font-mono text-xs">
                        {address?.slice(0, 6)}...{address?.slice(-4)}
                      </p>
                    </div>
                    <button
                      onClick={handleDisconnect}
                      className="text-text-tertiary hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors self-start mt-2"
                      title="Disconnect Wallet"
                    >
                      Disconnect
                    </button>
                  </div>
                  <button
                    onClick={handleVerifyWallet}
                    disabled={isSigning || isVerifying}
                    className="w-full bg-accent hover:bg-accent/80 disabled:bg-gray-600 text-white px-3 py-2 rounded-lg font-medium text-sm transition-colors"
                  >
                    {isSigning
                      ? "Signing..."
                      : isVerifying
                        ? "Verifying..."
                        : "Verify Wallet"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="text-center">
          <p className="text-text-tertiary text-sm">
            Connect Kodiak account first
          </p>
        </div>
      )}
    </div>
  );
};
