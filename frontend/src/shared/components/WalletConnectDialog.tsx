/** @format */

import React, { useState } from "react";
import {
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
  useSignMessage,
} from "wagmi";
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
  const { address, isConnected, connector: activeConnector } = useConnection();
  // wagmi v3 deprecated the `connectAsync` / `disconnect` / `signMessageAsync`
  // aliases in favour of the TanStack mutation API; alias `mutate*` back to the
  // names used below so the call sites stay readable.
  const {
    mutateAsync: connectAsync,
    isPending: isConnecting,
    error: connectError,
  } = useConnect();
  const connectors = useConnectors();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: signMessageAsync } = useSignMessage();

  const [isVerifying, setIsVerifying] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [connectFailed, setConnectFailed] = useState<string | null>(null);

  // Prefer the currently-active connector, else the first available one
  // (e.g. the injected browser wallet from WalletProvider config).
  const targetConnector =
    connectors.find(c => activeConnector && c.id === activeConnector.id) ??
    connectors[0];

  const handleConnect = async () => {
    setConnectFailed(null);
    if (!targetConnector) {
      const msg =
        "No wallet connector available. Please install a browser wallet (e.g. MetaMask) and refresh.";
      setConnectFailed(msg);
      toast.error(msg);
      return;
    }
    try {
      await connectAsync({ connector: targetConnector });
    } catch (error) {
      // User rejection is the common case — surface it quietly, log the rest
      const message =
        error instanceof Error ? error.message : "Wallet connection failed.";
      const isUserRejection =
        /rejected|denied|cancelled|canceled|user closed/i.test(message);
      if (!isUserRejection) {
        console.error("Wallet connection failed:", error);
      }
      setConnectFailed(message);
      if (!isUserRejection) {
        toast.error(message);
      }
    }
  };

  // Local-only disconnect: ends the browser wallet session WITHOUT
  // touching the backend. Linked wallet + user level stay intact, so a
  // page refresh / reconnect resumes where the user left off.
  const handleDisconnect = () => {
    disconnect();
  };

  // Explicit, audited downgrade: unlinks the wallet on the backend.
  // REGISTERED -> BASIC; VERIFIED -> REGISTERED (or BASIC if Kodiak gone).
  const handleUnlinkWallet = async () => {
    setIsUnlinking(true);
    try {
      await walletApi.unlinkWallet();
      disconnect();
      toast.success("Wallet unlinked from your account.");
      await refreshUser();
    } catch (error) {
      console.error("Wallet unlink failed:", error);
      toast.error("Failed to unlink wallet. Please try again.");
    } finally {
      setIsUnlinking(false);
    }
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

  const isBasic = user?.userLevel === "BASIC";
  const isVerified = user?.userLevel === "VERIFIED";

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
            {isBasic && (
              <div className="bg-blue-900 border border-blue-700 rounded p-3">
                <p className="text-blue-200 text-sm">
                  Connect your wallet and sign the welcome message to upgrade to
                  REGISTERED status.
                </p>
              </div>
            )}

            {isVerified && (
              <div className="bg-green-900 border border-green-700 rounded p-3">
                <p className="text-green-200 text-sm">
                  ✓ Your wallet is already verified! You have full access to all
                  features.
                </p>
              </div>
            )}

            {/* Available to every non-VERIFIED user (BASIC and REGISTERED):
                BASIC connects + signs here to become REGISTERED. */}
            {!isVerified && (
              <>
                {!isConnected ? (
                  <div className="text-center">
                    <p className="text-gray-300 mb-4">
                      {isBasic
                        ? "Connect your wallet to verify ownership and upgrade to REGISTERED status."
                        : "Connect your wallet to confirm ownership. To become VERIFIED, add your Kodiak API keys in Settings."}
                    </p>
                    <button
                      onClick={handleConnect}
                      disabled={
                        isConnecting ||
                        (!targetConnector && connectors.length === 0)
                      }
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                    >
                      {isConnecting ? "Connecting..." : "Connect Wallet"}
                    </button>
                    {(connectFailed || connectError) && (
                      <p className="text-red-400 text-xs mt-2">
                        {connectFailed ??
                          (connectError instanceof Error
                            ? connectError.message
                            : "Wallet connection failed.")}
                      </p>
                    )}
                    {!targetConnector && (
                      <p className="text-yellow-400 text-xs mt-2">
                        No wallet detected. Install a browser wallet (e.g.
                        MetaMask) and refresh.
                      </p>
                    )}
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
                        {isBasic
                          ? "Sign the welcome message to prove wallet ownership and get REGISTERED status."
                          : "Re-sign to confirm wallet ownership. To become VERIFIED, add your Kodiak API keys in Settings."}
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
                              : isBasic
                                ? "Sign & Upgrade to REGISTERED"
                                : "Verify Wallet"}
                        </button>
                        <button
                          onClick={handleDisconnect}
                          title="Disconnect wallet locally (account status unchanged)"
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
                • BASIC users: connect + sign to become REGISTERED, then add
                Kodiak keys in Settings to become VERIFIED
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

      {isVerified ? (
        <div className="space-y-3">
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
                  title="Disconnect wallet locally (account status unchanged)"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-text-tertiary text-sm mb-2">
                  Wallet linked — reconnect to sign transactions
                </p>
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="w-full bg-primary hover:bg-primary/80 disabled:bg-gray-600 text-white px-3 py-2 rounded-lg font-medium text-sm transition-colors"
                >
                  {isConnecting ? "Connecting..." : "Reconnect Wallet"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!isConnected ? (
            <div className="text-center">
              <p className="text-text-tertiary text-sm mb-3">
                {isBasic
                  ? "Connect wallet to upgrade to REGISTERED"
                  : "Connect wallet to verify ownership"}
              </p>
              <button
                onClick={handleConnect}
                disabled={
                  isConnecting || (!targetConnector && connectors.length === 0)
                }
                className="w-full bg-primary hover:bg-primary/80 disabled:bg-gray-600 text-white px-3 py-2 rounded-lg font-medium text-sm transition-colors"
              >
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
              {(connectFailed || connectError) && (
                <p className="text-red-400 text-xs mt-2">
                  {connectFailed ??
                    (connectError instanceof Error
                      ? connectError.message
                      : "Wallet connection failed.")}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="bg-bg-surface rounded p-2">
                  <p className="text-text-tertiary text-xs mb-1">Connected:</p>
                  <p className="text-text-primary font-mono text-xs">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-text-tertiary hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors self-start mt-2"
                  title="Disconnect wallet locally (account status unchanged)"
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
                    : isBasic
                      ? "Sign & Upgrade to REGISTERED"
                      : "Confirm Wallet Ownership"}
              </button>
              {!isBasic && (
                <button
                  onClick={handleUnlinkWallet}
                  disabled={isUnlinking}
                  className="w-full text-text-tertiary hover:text-red-400 disabled:opacity-50 text-xs px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors"
                  title="Remove the linked wallet (downgrades account status)"
                >
                  {isUnlinking ? "Unlinking..." : "Unlink wallet"}
                </button>
              )}
            </div>
          )}
          {isBasic && (
            <p className="text-text-tertiary text-xs text-center">
              Signing the welcome message upgrades you to REGISTERED.
            </p>
          )}
          {!isBasic && !isVerified && (
            <p className="text-text-tertiary text-xs text-center">
              To reach VERIFIED, add your Kodiak API keys in Settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
