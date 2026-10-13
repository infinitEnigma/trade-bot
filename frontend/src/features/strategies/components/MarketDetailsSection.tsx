/** @format */

import React, { useState } from "react";
import { ChevronDown, LineChart } from "lucide-react";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";

interface MarketDetailsSectionProps {
  portfolioSummary: PortfolioSummary;
  isVerified: boolean;
}

/**
 * Phase 2 IA (Phase 3.1 re-scoped): the portfolio figures are REFERENCE
 * detail, not the strategy-management task — they render in a collapsible
 * section below the strategy workspace. The chart MOVED into the selected
 * strategy's workspace (review P1-1: it follows the selected strategy
 * instead of being a detached market view), so this section keeps only the
 * portfolio-wide summary the reviewer asked to preserve here.
 *
 * Defaults open to preserve existing visibility while letting the operator
 * tuck it away to focus on the workspace.
 */
export const MarketDetailsSection: React.FC<MarketDetailsSectionProps> = ({
  portfolioSummary,
  isVerified,
}) => {
  const [open, setOpen] = useState(true);

  return (
    <section className="border-t border-white/5 pt-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="strategies-market-details"
        className="w-full flex items-center justify-between gap-3 group"
      >
        <span className="flex items-center gap-2">
          <LineChart className="w-4 h-4 text-textMuted" />
          <span className="text-lg font-semibold text-text">Portfolio</span>
        </span>
        <ChevronDown
          className={`w-5 h-5 text-textMuted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div id="strategies-market-details" className="mt-4 space-y-6">
          {/* Account Balance Overview - real venue balances (VERIFIED users) */}
          <div>
            {portfolioSummary.initialLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="glass-card p-6">
                    <div className="animate-pulse">
                      <div className="grid grid-rows-[auto_1fr_auto] gap-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 bg-white/10 rounded-lg"></div>
                          <div className="w-20 h-4 bg-white/10 rounded"></div>
                        </div>
                        <div className="w-24 h-8 bg-white/10 rounded"></div>
                        <div className="w-16 h-4 bg-white/10 rounded"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : portfolioSummary.error ? (
              <div className="glass-card p-8 text-center">
                <div className="w-12 h-12 mx-auto mb-4 bg-warning/10 rounded-full flex items-center justify-center">
                  <div className="w-6 h-6 bg-warning rounded"></div>
                </div>
                <h4 className="text-lg font-semibold text-text mb-2">
                  Portfolio figures unavailable
                </h4>
                <p className="text-textMuted mb-4">{portfolioSummary.error}</p>
              </div>
            ) : isVerified ? (
              /* Five distinct, real figures (B1/B6; 2026-10-09 PnL fix) — same
                 sources as the Dashboard strip: on-chain wallet, selected
                 exchange balance, venue-exact unrealized PnL, venue-computed
                 realized PnL, total across all accounts. */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                <div className="glass-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <div className="w-5 h-5 bg-blue-500 rounded"></div>
                    </div>
                    <span className="text-sm text-textMuted">Wallet</span>
                  </div>
                  <div className="text-2xl font-bold text-text mb-1">
                    ${portfolioSummary.walletBalance.toLocaleString()}
                  </div>
                  <p className="text-xs text-textMuted">On-chain balance</p>
                </div>

                <div className="glass-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <div className="w-5 h-5 bg-green-500 rounded"></div>
                    </div>
                    <span className="text-sm text-textMuted">Exchange</span>
                  </div>
                  <div className="text-2xl font-bold text-text mb-1">
                    ${portfolioSummary.exchangeBalance.toLocaleString()}
                  </div>
                  <p className="text-xs text-textMuted">Selected account</p>
                </div>

                <div className="glass-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                      <div className="w-5 h-5 bg-orange-500 rounded"></div>
                    </div>
                    <span className="text-sm text-textMuted">
                      Unrealized PnL
                    </span>
                  </div>
                  <div
                    className={`text-2xl font-bold mb-1 ${
                      portfolioSummary.unrealizedPnl >= 0
                        ? "text-success"
                        : "text-danger"
                    }`}
                  >
                    {portfolioSummary.unrealizedPnl >= 0 ? "+" : "-"}$
                    {Math.abs(portfolioSummary.unrealizedPnl).toLocaleString()}
                  </div>
                  <p className="text-xs text-textMuted">Open positions</p>
                </div>

                <div className="glass-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                      <div className="w-5 h-5 bg-orange-500 rounded"></div>
                    </div>
                    <span className="text-sm text-textMuted">Realized PnL</span>
                  </div>
                  <div
                    className={`text-2xl font-bold mb-1 ${
                      portfolioSummary.realizedPnl >= 0
                        ? "text-success"
                        : "text-danger"
                    }`}
                  >
                    {portfolioSummary.realizedPnl >= 0 ? "+" : "-"}$
                    {Math.abs(portfolioSummary.realizedPnl).toLocaleString()}
                  </div>
                  <p className="text-xs text-textMuted">Venue 7d window</p>
                </div>

                <div className="glass-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                      <div className="w-5 h-5 bg-purple-500 rounded"></div>
                    </div>
                    <span className="text-sm text-textMuted">Total</span>
                  </div>
                  <div className="text-2xl font-bold text-text mb-1">
                    ${portfolioSummary.totalAcrossExchanges.toLocaleString()}
                  </div>
                  <p className="text-xs text-textMuted">
                    Across {portfolioSummary.activeAccountCount || 0} account
                    {portfolioSummary.activeAccountCount === 1 ? "" : "s"}
                  </p>
                  {portfolioSummary.totalIsPartial ? (
                    // F3: partial sum is labelled and names the unreadable
                    // accounts — never presented as the complete portfolio.
                    <p className="text-xs text-warning mt-1">
                      Partial —{" "}
                      {portfolioSummary.failedAccounts
                        .map(a => a.label)
                        .join(", ")}{" "}
                      unreadable
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
};
