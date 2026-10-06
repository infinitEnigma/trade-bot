/** @format */

import React from "react";
import { createConfig, WagmiProvider, useDisconnect } from "wagmi";
import { mainnet } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "wagmi";
import { injected } from "wagmi/connectors";

// Create Wagmi config WITHOUT auto-connect
const config = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
  },
  // Removed ssr: true to disable auto-connect that triggers rate limits
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      refetchOnWindowFocus: false, // Don't refetch on window focus
      refetchOnReconnect: false, // Don't refetch on reconnect
    },
  },
});

/**
 * Drop every cached query (Fix A). The client is app-scoped, so entries
 * keyed by the previous user id (`["user", oldId]`, `["exchange-accounts",
 * oldId]`, …) survive a login/register/logout unless explicitly cleared —
 * that is what leaked the previous wallet + userLevel into a new account.
 */
export const clearQueryCache = async (): Promise<void> => {
  queryClient.clear();
};

/**
 * Bridge for the `auth:disconnect-wallet` event (Fix A). The auth layer
 * (useAuth.clearPreviousSession) fires it on login/register/logout because a
 * wallet connection is per-browser, not per-app-user: without this, a new
 * account registered in the same tab inherits the previous MetaMask address
 * and can silently link it to the new user id. Mounted inside WagmiProvider
 * so it can reach wagmi's disconnect action.
 */
const WalletSessionSync = ({ children }: { children: React.ReactNode }) => {
  const { disconnect } = useDisconnect();

  React.useEffect(() => {
    const handleDisconnectWallet = () => {
      try {
        disconnect();
      } catch (error) {
        // No active connector (e.g. already disconnected) — nothing to clean.
        console.warn("Wallet disconnect on auth change failed:", error);
      }
    };

    window.addEventListener("auth:disconnect-wallet", handleDisconnectWallet);
    return () =>
      window.removeEventListener(
        "auth:disconnect-wallet",
        handleDisconnectWallet
      );
  }, [disconnect]);

  return <>{children}</>;
};

/**
 * WalletProvider - Provides Wagmi and React Query context to the application
 * This component should wrap the main App component to provide wallet connectivity
 * and query client functionality throughout the application.
 */
const WalletProvider = ({ children }: { children: React.ReactNode }) => (
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <WalletSessionSync>{children}</WalletSessionSync>
    </QueryClientProvider>
  </WagmiProvider>
);

export default WalletProvider;
