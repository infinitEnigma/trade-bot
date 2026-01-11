/** @format */

import React, { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

interface WalletConnectDialogProps {
  isOpen: boolean;
  onClose: () => void;
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
      await api.verifyWallet({
        walletAddress: address,
        signature,
        message,
      });

      toast.success("Wallet verified successfully!");
      await refreshUser(); // Refresh user data to get updated verification status
      onClose();
    } catch (error) {
      console.error("Wallet verification failed:", error);
      toast.error("Wallet verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
      setIsSigning(false);
    }
  };

  if (!isOpen) return null;

  const isVerified = user?.userLevel === "VERIFIED";
  const hasKodiakConnection = user?.userLevel === "REGISTERED" || isVerified;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Wallet Verification</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
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
                      Sign a message to prove wallet ownership and get VERIFIED
                      status.
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
              • Wallet verification ensures you own the connected Kodiak account
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
