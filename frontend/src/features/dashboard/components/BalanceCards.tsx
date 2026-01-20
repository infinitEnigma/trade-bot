/** @format */

import React, { Suspense } from "react";
import { motion } from "framer-motion";
import { Wallet, DollarSign, Activity, TrendingUp } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { SectionHeader } from "../../../shared/components/ui";
import { DashboardCardSkeleton } from "../../../shared/components/feedback";
import { BalanceData } from "../types/dashboard.types";

interface BalanceCardsProps {
  balance: BalanceData | null;
  loading: boolean;
}

/**
 * BalanceCards component - displays the 4 main balance metrics
 */
export const BalanceCards: React.FC<BalanceCardsProps> = ({ balance, loading }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <DashboardCardSkeleton />
        <DashboardCardSkeleton />
        <DashboardCardSkeleton />
        <DashboardCardSkeleton />
      </div>
    );
  }

  if (!balance) {
    return null;
  }

  const cards = [
    {
      title: "Wallet Balance",
      value: balance.walletBalance,
      icon: Wallet,
      color: "primary" as const,
    },
    {
      title: "Account Balance",
      value: balance.accountBalance,
      icon: DollarSign,
      color: "success" as const,
    },
    {
      title: "Available Balance",
      value: balance.availableBalance,
      icon: Activity,
      color: "warning" as const,
    },
    {
      title: "Total Assets",
      value: balance.totalAssets,
      icon: TrendingUp,
      color: "info" as const,
    },
  ];

  return (
    <div className="mb-8">
      <SectionHeader
        title="Portfolio Overview"
        subtitle="Real-time performance and analytics"
        actions={
          <>
            <button className="btn-secondary flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Refresh
            </button>
            <button className="btn-primary flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              New Strategy
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card, index) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.4,
              delay: index * 0.1,
              ease: "easeOut"
            }}
            className="gpu-accelerated will-change-transform"
          >
            <Suspense fallback={<DashboardCardSkeleton />}>
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-10 h-10 rounded-lg bg-${card.color}/10 flex items-center justify-center`}>
                    <card.icon className={`w-5 h-5 text-${card.color}`} />
                  </div>
                  <span className="text-sm text-textMuted">{card.title}</span>
                </div>
                <div className="text-2xl font-bold text-text mb-1">
                  ${card.value.toLocaleString()}
                </div>
                <p className="text-xs text-textMuted">
                  {card.title.toLowerCase()}
                </p>
              </Card>
            </Suspense>
          </motion.div>
        ))}
      </div>
    </div>
  );
};
