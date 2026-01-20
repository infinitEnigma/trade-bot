/** @format */

import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Wallet, Key } from "lucide-react";

// Import from the new dashboard feature
import {
  useDashboard,
  BalanceCards,
  QuickActions,
  PositionsTable,
  RecentTrades
} from "../features/dashboard";

// Import auth hook
import { useAuth } from "../features/auth";

// Import shared components
import { Container, Grid, Section } from "../shared/components/layout";
import { Card } from "../shared/components/ui";
import { UserProgressCard } from "../components/ui/UserProgressCard";

// Lazy load heavy components
const PriceChart = React.lazy(() => import("../components/PriceChart"));
const PortfolioChart = React.lazy(() =>
  import("../components/dashboard/PortfolioChart")
);

/**
 * New streamlined Dashboard component
 * Uses the extracted dashboard feature components
 */
const Dashboard: React.FC = () => {
  // Use auth hook for user data
  const { user } = useAuth();

  // Use the new dashboard hook
  const dashboardData = useDashboard();

  const {
    balance,
    positions,
    trades,
    profitablePositions,
    balanceLoading,
    positionsLoading,
    tradesLoading,
  } = dashboardData;

  // Determine access based on user level
  const hasKodiakAccess =
    user?.userLevel === "REGISTERED" || user?.userLevel === "VERIFIED";

  return (
    <Container
      size={{
        default: "lg",
        xl: "xl",
        "2xl": "2xl",
        "3xl": "3xl",
        "4xl": "4xl",
      }}
      className="py-2 space-y-4"
    >
      <Section>
        {/* User Progress Card */}
        <div className="mb-8">
          <UserProgressCard />
        </div>

        {/* Market Chart Section */}
        <div className="mb-8 contain-layout">
          <Suspense
            fallback={
              <Card className="h-96 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </Card>
            }
          >
            <PriceChart />
          </Suspense>
        </div>

        {/* Balance Cards */}
        <BalanceCards
          balance={balance}
          loading={balanceLoading}
        />

        {/* Portfolio Connection State */}
        {!hasKodiakAccess && (
          <Card className="text-center mb-8">
            <Wallet className="w-12 h-12 text-textMuted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">
              Connect Your Kodiak Account
            </h3>
            <p className="text-textMuted mb-4">
              Connect your trading account to view your portfolio data and
              trading performance.
            </p>
            <Link
              to="/settings"
              className="bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Key className="w-5 h-5" />
              Connect Account
            </Link>
          </Card>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Portfolio Chart */}
          <Card className="lg:col-span-2">
            <Suspense
              fallback={
                <div className="h-80 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              }
            >
              <PortfolioChart
                data={dashboardData.performanceData}
                selectedSymbol="PERP_BTC_USDC"
                onSymbolChange={() => {}} // TODO: Implement symbol selection
              />
            </Suspense>
          </Card>

          {/* Quick Actions Sidebar */}
          <QuickActions
            hasKodiakAccess={hasKodiakAccess}
            userLevel={user?.userLevel}
          />
        </div>

        {/* Positions & Trades Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <PositionsTable
            positions={positions}
            profitablePositions={profitablePositions}
            isLoading={positionsLoading}
          />

          <RecentTrades
            trades={trades}
            isLoading={tradesLoading}
          />
        </div>
      </Section>
    </Container>
  );
};

export default Dashboard;
