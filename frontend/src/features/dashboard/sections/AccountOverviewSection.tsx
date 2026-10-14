/** @format */

import React, { Suspense } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  DollarSign,
  Key,
  Loader2,
  Network,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card } from "../../../shared/components/ui/Card";
import {
  LoadingSpinner,
  SectionHeader,
  FreshnessIndicator,
} from "../../../shared/components/ui";
import { UserProgressCard } from "../../../shared/components/user/UserProgressCard";
import {
  ElectricalNetworkBackground,
  Grid,
} from "../../../shared/components/layout";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";
import type { ExchangeAccountDto } from "../../../infrastructure/api/accounts";
import { useConnection, useChainId } from "wagmi";
import { StatsCard } from "../components/StatsCard";
import type { DashboardAccess } from "../utils/dashboardAccess";

const WalletConnectDialog = React.lazy(() =>
  import("../../../shared/components/WalletConnectDialog").then(module => ({
    default: module.WalletConnectDialog,
  }))
);

interface AccountOverviewSectionProps {
  access: DashboardAccess;
  portfolioSummary: PortfolioSummary;
  /** ACTIVE exchange accounts (selector source), newest-first. */
  portfolioAccounts: ExchangeAccountDto[];
  /** Resolved active account id (URL value if valid, else newest ACTIVE). */
  activeAccountId: string;
  /** Persist a new scope (writes `?exchangeAccountId=`). */
  onAccountSelect: (id: string) => void;
  /** `id → \"EXCHANGE (env) ref\"` display labels for the selector options. */
  accountLabels: Record<string, string>;
}

/**
 * Account overview — tier-dependent ownership of the personal blocks:
 * onboarding progress, the portfolio figure strip (five distinct, real
 * sources; no card duplicates another), and the wallet widget.
 *
 * The five-figure honesty machinery is preserved verbatim from the old page:
 * - per-figure sources, never a collapsed "Balance" number;
 * - `totalIsPartial`/`failedAccounts` disclosure on the total (F3);
 * - no fabricated zeroes: below the strip's gate, tiers see a next-step CTA
 *   card instead of $0 cards.
 */
// Only `mainnet` is configured in the wagmi provider; map the active chain
// id to a human label, falling back to the raw id for any future chain.
const CHAIN_NAMES: Record<number, string> = { 1: "Ethereum mainnet" };
const formatNetwork = (chainId: number | undefined): string =>
  (chainId && CHAIN_NAMES[chainId]) ||
  (chainId ? `Chain ${chainId}` : "Unknown network");

export const AccountOverviewSection: React.FC<AccountOverviewSectionProps> = ({
  access,
  portfolioSummary,
  portfolioAccounts,
  activeAccountId,
  onAccountSelect,
  accountLabels,
}) => {
  // Wallet identity/network for the REGISTERED panel — honest: the address
  // and connected chain come straight from wagmi, no invented network.
  const { address, isConnected } = useConnection();
  const chainId = useChainId();

  // For VERIFIED users, always show portfolio (even with zero balances).
  // For REGISTERED users, show if balance data exists.
  const shouldShowPortfolio =
    access.tier === "VERIFIED" ||
    (access.tier === "REGISTERED" && portfolioSummary.exchangeBalance > 0);

  return (
    <div className="mb-8">
      {/* ✅ User Progress Card - Shows account progression */}
      <div className="mb-8">
        <ElectricalNetworkBackground />
        <UserProgressCard />
      </div>

      {/* Portfolio Overview — P0 single-source: the loading/error gate
          reads the hook (one balance system), not useBalance. */}
      {portfolioSummary.initialLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="p-6 flex items-center justify-center">
              <LoadingSpinner />
            </Card>
          ))}
        </div>
      ) : portfolioSummary.error ? (
        <Card className="mb-8 border-warning/20 bg-warning/5">
          <div className="flex items-start gap-3 p-6">
            <Activity className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-text">
                Portfolio figures unavailable
              </h3>
              <p className="text-sm text-textMuted mt-1 break-words">
                {portfolioSummary.error}
              </p>
              <p className="text-xs text-textMuted mt-2">
                Positions and trades below carry their own error state — this
                card only reflects the failed figure read, not a zero balance.
              </p>
            </div>
          </div>
        </Card>
      ) : shouldShowPortfolio ? (
        <div className="mb-8">
          <SectionHeader
            title="Portfolio Overview"
            subtitle="Real-time performance and analytics"
            actions={
              <>
                {/* Single URL-scoped account selector (moved here from the
                    positions/trades headers). Persists ?exchangeAccountId= so
                    refresh + shared links keep the user's context. */}
                {portfolioAccounts.length > 0 && (
                  <select
                    value={activeAccountId}
                    onChange={event => onAccountSelect(event.target.value)}
                    aria-label="Select exchange account"
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-text focus:border-primary/50 focus:outline-none"
                  >
                    {portfolioAccounts.map(account => (
                      <option key={account.id} value={account.id}>
                        {accountLabels[account.id] ?? account.accountRef}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => {
                    portfolioSummary.refresh();
                  }}
                  className="btn-secondary flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                {/* HD1: /strategies requires VERIFIED — a REGISTERED
                    landing spot must not offer a button that bounces. */}
                {access.tier === "VERIFIED" && (
                  <Link
                    to="/strategies"
                    className="btn-primary flex items-center gap-2"
                  >
                    <Target className="w-4 h-4" />
                    New Strategy
                  </Link>
                )}
              </>
            }
          />

          {/* Five distinct, real figures (B1/B6; 2026-10-09 PnL fix):
              on-chain wallet, selected exchange balance, venue-exact
              unrealized PnL, venue-computed realized PnL, and the total
              across every ACTIVE exchange account. Each reads its own
              source — no card is a duplicate of another. */}
          <Grid cols={{ default: 1, md: 2, lg: 3, xl: 5 }} gap={6}>
            <StatsCard
              title="Wallet (on-chain)"
              value={portfolioSummary.walletBalance}
              icon={Wallet}
              format="currency"
            />
            <StatsCard
              title="Exchange balance"
              value={portfolioSummary.exchangeBalance}
              icon={DollarSign}
              format="currency"
            />
            <StatsCard
              title="Unrealized PnL (open positions)"
              value={portfolioSummary.unrealizedPnl}
              icon={Activity}
              format="pnl"
            />
            <StatsCard
              title="Realized PnL (7d, venue)"
              value={portfolioSummary.realizedPnl}
              icon={Activity}
              format="pnl"
            />
            <StatsCard
              title={`Total across ${
                portfolioSummary.activeAccountCount || 0
              } exchange account${
                portfolioSummary.activeAccountCount === 1 ? "" : "s"
              }`}
              value={portfolioSummary.totalAcrossExchanges}
              icon={TrendingUp}
              format="currency"
              note={
                // F3: an unreadable account must never look like a complete
                // total — label the sum as partial and name what's missing.
                portfolioSummary.totalIsPartial
                  ? `Partial — ${portfolioSummary.failedAccounts.length} of ${
                      portfolioSummary.activeAccountCount
                    } account${
                      portfolioSummary.activeAccountCount === 1 ? "" : "s"
                    } unreadable (${portfolioSummary.failedAccounts
                      .map(a => a.label)
                      .join(", ")})`
                  : undefined
              }
            />
          </Grid>
        </div>
      ) : access.tier === "BASIC" ? (
        <Card className="text-center mb-8">
          <Wallet className="w-12 h-12 text-textMuted mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text mb-2">
            Connect Your Wallet
          </h3>
          <p className="text-textMuted mb-4">
            Your next step is connecting your wallet — use the wallet widget on
            this page to reach REGISTERED status. Exchange accounts come after
            that.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() =>
                document
                  .getElementById("wallet-widget")
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
              className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 inline-flex items-center gap-2"
            >
              <Wallet className="w-5 h-5" />
              Go to Wallet
            </button>
            <Link
              to="/settings"
              className="text-sm text-textMuted hover:text-text underline underline-offset-4"
            >
              Exchange account settings
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* REGISTERED: the on-chain wallet balance is already fetched at
              this tier (the wallet query is gated on userLevel !== BASIC),
              so surface it here rather than leaving it hidden. Identity,
              network, balance and last-updated all come from real sources. */}
          <Card className="mb-8">
            <SectionHeader
              title="Your Wallet (on-chain)"
              subtitle="Linked wallet identity and balance"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-textMuted mb-1">Address</p>
                <p className="text-sm font-mono text-text break-all">
                  {isConnected && address ? address : "Not connected"}
                </p>
              </div>
              <div>
                <p className="text-xs text-textMuted mb-1 flex items-center gap-1">
                  <Network className="w-3 h-3" />
                  Network
                </p>
                <p className="text-sm text-text">{formatNetwork(chainId)}</p>
              </div>
              <div>
                <p className="text-xs text-textMuted mb-1">Balance</p>
                <p className="text-sm font-semibold text-text">
                  ${portfolioSummary.walletBalance.toLocaleString()}
                </p>
                <FreshnessIndicator
                  updatedAt={portfolioSummary.walletBalanceUpdatedAt}
                />
              </div>
            </div>
          </Card>

          <Card className="text-center mb-8">
            <Activity className="w-12 h-12 text-textMuted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">
              Connect Your Trading Account
            </h3>
            <p className="text-textMuted mb-4">
              Connect your trading account in Settings to see your portfolio,
              positions and recent trades here.
            </p>
            <Link
              to="/settings"
              className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Key className="w-5 h-5" />
              Connect Account
            </Link>
          </Card>
        </>
      )}

      {/* Wallet Status Widget - visible for all authenticated users (BASIC and
          above). BASIC users connect + sign here to upgrade to REGISTERED.
          The id is the anchor target for the "Go to Wallet" CTAs above and in
          the header. */}
      <Card className="mb-8">
        <h2 className="text-lg font-semibold text-text mb-4">Wallet</h2>
        <div id="wallet-widget">
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
      </Card>
    </div>
  );
};
