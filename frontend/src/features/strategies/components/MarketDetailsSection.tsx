/** @format */

import React, { Suspense, lazy, useState } from "react";
import { ChevronDown, LineChart } from "lucide-react";
import {
  decodeChartOption,
  encodeChartOption,
  type ChartSelection,
  type ChartSymbolGroup,
} from "../utils/chartSymbolPicker";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";

// Lazy load the heavy chart for the same performance reason the page did.
const CandlestickChart = lazy(
  () => import("../../../shared/components/charts/CandlestickChart")
);

interface MarketDetailsSectionProps {
  chartOptionCount: number;
  chartGroups: ChartSymbolGroup[];
  chartSelection: ChartSelection;
  chartSymbol: string;
  onChartSelectionChange: (selection: ChartSelection) => void;
  portfolioSummary: PortfolioSummary;
  isVerified: boolean;
}

/**
 * Phase 2 IA: the chart + portfolio figures are REFERENCE detail, not the
 * strategy-management task. They render in a collapsible section placed below
 * the strategy list (they used to lead the page and push the list down).
 *
 * Defaults open to preserve existing visibility while letting the operator
 * tuck it away to focus on the list; collapsed state names the chart symbol so
 * the section isn't a dead end.
 */
export const MarketDetailsSection: React.FC<MarketDetailsSectionProps> = ({
  chartOptionCount,
  chartGroups,
  chartSelection,
  chartSymbol,
  onChartSelectionChange,
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
          <span className="text-lg font-semibold text-text">
            Market &amp; portfolio
          </span>
          {!open && chartOptionCount > 1 && (
            <span className="text-xs text-textMuted">
              — {chartSymbol.replace("PERP_", "").replace("_USDC", "")}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-textMuted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div id="strategies-market-details" className="mt-4 space-y-6">
          {/* Candlestick Chart - Advanced trading data for verified users */}
          {/* P1/X3: symbol AND venue follow the dropdown (all venue-listed
              symbols, grouped by venue — X1 pattern); the venue drives the
              backend's candle dispatch and the Orderly-WS skip. */}
          <div>
            {chartOptionCount > 1 && (
              <div className="flex items-center gap-2 mb-3">
                <label
                  htmlFor="strategies-chart-symbol"
                  className="text-sm text-textMuted"
                >
                  Chart symbol
                </label>
                <select
                  id="strategies-chart-symbol"
                  value={encodeChartOption(chartSelection)}
                  onChange={event => {
                    const decoded = decodeChartOption(event.target.value);
                    if (decoded) onChartSelectionChange(decoded);
                  }}
                  aria-label="Chart symbol"
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-text focus:border-primary/50 focus:outline-none"
                >
                  {chartGroups.map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.symbols.map(sym => (
                        <option
                          key={sym}
                          value={encodeChartOption({
                            symbol: sym,
                            exchange: group.exchange,
                            environment: group.environment,
                          })}
                        >
                          {sym.replace("PERP_", "").replace("_USDC", "")}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
            <Suspense
              fallback={
                <div className="glass-card p-6 animate-pulse">
                  <div className="w-32 h-5 bg-surface rounded mb-4"></div>
                  <div className="bg-surface rounded-lg h-110"></div>
                </div>
              }
            >
              <CandlestickChart
                symbol={chartSymbol}
                interval="1h"
                height={450}
                venue={{
                  exchange: chartSelection.exchange,
                  environment: chartSelection.environment,
                }}
              />
            </Suspense>
          </div>

          {/* Account Balance Overview - real venue balances (VERIFIED users) */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-text">Portfolio</h3>
            </div>

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
