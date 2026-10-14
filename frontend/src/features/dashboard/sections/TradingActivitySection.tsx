/** @format */

import React from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Key,
  Loader2,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card } from "../../../shared/components/ui/Card";
import { SectionHeader } from "../../../shared/components/ui/SectionHeader";
import { RecentTradesTable } from "../../../shared/components/user/RecentTrades";
import { EngineJournalIntegrityNotice } from "../../strategies/components/EngineJournalIntegrityNotice";
import type { JournalIntegrityState } from "../../strategies/components/EngineJournalIntegrityNotice";
import type { LedgerTradeRow } from "../../../infrastructure/api/trading";
import type { PortfolioSummary } from "../../../shared/hooks/usePortfolioSummary";
import { RealizedPnlChart } from "../components/RealizedPnlChart";
import type { PerformanceData } from "../components/RealizedPnlChart";
import { BotStatusPanel } from "../components/BotStatusPanel";
import type { DashboardAccess } from "../utils/dashboardAccess";

interface TradingActivitySectionProps {
  access: DashboardAccess;
  portfolioSummary: PortfolioSummary;
  /** Plot-ready cumulative realized-PnL series (page derives it single-source). */
  portfolioData: PerformanceData[];
  /** Selected exchange account (unified scope). Drives card subtitles/labels. */
  activeAccountId: string;
  /** `id → "EXCHANGE (env) ref"` labels for account-scoped subtitles. */
  accountLabels: Record<string, string>;
  /** Platform ledger rows (GET /api/trades) for the Recent Trades table. */
  ledgerTrades: LedgerTradeRow[];
  ledgerTradesLoading: boolean;
  ledgerTradesError: unknown;
  /** System Status sources (WS liveness + engine liveness + journal state). */
  wsStatus: string;
  engineRunning: boolean | null;
  journalIntegrity?: JournalIntegrityState;
  journalIntegrityAlert?: boolean;
}

// F3: honest relative time for the "Last Sync" row (from query dataUpdatedAt).
const formatRelativeTime = (timestampMs: number): string => {
  if (!timestampMs) return "Never";
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/**
 * Trading activity — VERIFIED's operational summary: bot status → positions
 * → recent trades → realized-PnL chart → System Status. Deliberately a
 * summary: order management, strategy configuration and per-strategy charts
 * stay in Strategies. Below VERIFIED this renders a tier explainer naming
 * exactly what unlocks and the next step — never locked controls, never
 * fabricated zeroes.
 */
export const TradingActivitySection: React.FC<TradingActivitySectionProps> = ({
  access,
  portfolioSummary,
  portfolioData,
  activeAccountId,
  accountLabels,
  ledgerTrades,
  ledgerTradesLoading,
  ledgerTradesError,
  wsStatus,
  engineRunning,
  journalIntegrity,
  journalIntegrityAlert,
}) => {
  const hasAnalyticsRole = access.canViewAnalytics;

  if (access.sections.trading !== "operational") {
    const isBasic = access.tier === "BASIC";
    return (
      <Card>
        <div className="flex items-start gap-3">
          {isBasic ? (
            <Wallet className="w-5 h-5 text-textMuted mt-0.5" />
          ) : (
            <Key className="w-5 h-5 text-textMuted mt-0.5" />
          )}
          <div>
            <h3 className="text-sm font-medium text-text">
              {isBasic
                ? "Trading unlocks after wallet + exchange setup"
                : "Trading unlocks after exchange verification"}
            </h3>
            <p className="text-sm text-textMuted mt-1">
              {isBasic
                ? "Connect your wallet, then verify an exchange account in Settings — live bot status, open positions, recent fills and the realized-PnL curve appear here."
                : "Verify an exchange account in Settings — live bot status, open positions, recent fills and the realized-PnL curve appear here."}
            </p>
            {isBasic ? (
              <button
                onClick={() =>
                  document
                    .getElementById("wallet-widget")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
                className="text-sm text-textMuted hover:text-text underline underline-offset-4 mt-2"
              >
                Go to Wallet
              </button>
            ) : (
              <Link
                to="/settings"
                className="text-sm text-textMuted hover:text-text underline underline-offset-4 mt-2 inline-block"
              >
                Open Settings
              </Link>
            )}
          </div>
        </div>
      </Card>
    );
  }

  const positions = portfolioSummary.positions;
  const positionsLoading = portfolioSummary.positionsLoading;
  // F3: "Last Sync" reflects the most recent successful positions read.
  const lastSyncLabel = portfolioSummary.positionsUpdatedAt
    ? formatRelativeTime(portfolioSummary.positionsUpdatedAt)
    : "Never";
  const profitablePositions = positions.filter(
    p => parseFloat(String(p.unsettled_pnl ?? "0")) >= 0
  ).length;

  return (
    <>
      {/* Bot status first: needs-attention rows surface before the tables. */}
      <div className="mb-6">
        <BotStatusPanel accountLabels={accountLabels} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart Section — cumulative realized-PnL curve (unrealized overlay
            stays an Analytics-boundary item). Caption keeps a flat 0
            readable as information, not breakage. Never labelled equity:
            no verified equity baseline is constructed here. */}
        <Card className="lg:col-span-2">
          <RealizedPnlChart data={portfolioData} />
          <p className="text-xs text-textMuted mt-2">
            Realized PnL from the venue (trade_pnl level, last-minus-first over
            7d, transfers excluded) — a flat 0 means no closed PnL in the window
            yet. Unrealized (open positions) is on the cards above.
          </p>
        </Card>

        {/* System Status — VERIFIED only. WS never connects below VERIFIED
            (ConditionalWebSocketInitializer) and engine/journal state is
            meaningless there; lower tiers get the explainer above instead. */}
        {access.sections.systemStatus && (
          <Card>
            <h3 className="text-sm font-medium text-textMuted mb-3">
              System Status
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text">API Connection</span>
                <span
                  className={`flex items-center gap-2 text-sm ${
                    wsStatus === "connected"
                      ? "text-success"
                      : wsStatus === "connecting" || wsStatus === "reconnecting"
                        ? "text-warning"
                        : "text-textMuted"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      wsStatus === "connected"
                        ? "bg-success"
                        : wsStatus === "connecting" ||
                            wsStatus === "reconnecting"
                          ? "bg-warning"
                          : "bg-textMuted"
                    }`}
                  />
                  {wsStatus === "connected"
                    ? "Connected"
                    : wsStatus === "connecting" || wsStatus === "reconnecting"
                      ? "Connecting…"
                      : "Disconnected"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text">Bot Engine</span>
                <span
                  className={`flex items-center gap-2 text-sm ${
                    engineRunning === null
                      ? "text-textMuted"
                      : engineRunning
                        ? "text-success"
                        : "text-warning"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      engineRunning === null
                        ? "bg-textMuted"
                        : engineRunning
                          ? "bg-success"
                          : "bg-warning"
                    }`}
                  />
                  {engineRunning === null
                    ? "Unknown"
                    : engineRunning
                      ? "Running"
                      : "Not running"}
                </span>
              </div>
              {/* F4 journal integrity: sticky reconciliation alert (red) OR
                verification-pending (amber), distinct from the liveness row
                above — an accounting state is not an engine-connectivity
                state and must not clear on a healthy heartbeat. Precedence
                and copy live in the component. */}
              <EngineJournalIntegrityNotice
                journalIntegrity={journalIntegrity}
                journalIntegrityAlert={journalIntegrityAlert}
                variant="row"
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-text">Last Sync</span>
                <span className="text-sm text-textMuted">{lastSyncLabel}</span>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Positions & Recent Trades */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Enhanced Positions Table */}
        <Card>
          <SectionHeader
            title="Open Positions"
            subtitle={`${positions.length} active positions • ${profitablePositions} profitable`}
          />

          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="table-enhanced w-full min-w-150">
              <thead>
                <tr>
                  <th className="text-left">Symbol</th>
                  <th className="text-left">Side</th>
                  <th className="text-left">Size</th>
                  <th className="text-left">Entry Price</th>
                  <th className="text-left">Current Price</th>
                  <th className="text-left">PnL</th>
                </tr>
              </thead>
              <tbody>
                {positionsLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                        <p className="text-text-secondary">
                          Loading positions...
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : positions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8">
                      <div className="flex flex-col items-center justify-center py-8">
                        <Target className="w-12 h-12 text-textMuted mb-4" />
                        <h3 className="text-lg font-semibold text-text mb-2">
                          No Open Positions
                        </h3>
                        <p className="text-textMuted text-center mb-4">
                          Start trading by creating a new strategy or opening a
                          position manually.
                        </p>
                        <div className="space-y-3">
                          {/* HD1: only VERIFIED may enter /strategies. */}
                          {access.tier === "VERIFIED" && (
                            <Link
                              to="/strategies"
                              className="w-full bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                            >
                              <Activity className="w-4 h-4" />
                              Manage Strategies
                            </Link>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  positions.map((position, index: number) => {
                    const pnl = parseFloat(
                      String(position.unsettled_pnl ?? "0")
                    );
                    const size = parseFloat(
                      String(position.position_qty ?? "0")
                    );
                    const markPrice = parseFloat(
                      String(position.mark_price ?? "0")
                    );
                    const entryPrice = parseFloat(
                      String(position.average_open_price ?? "0")
                    );
                    const pnlPercent =
                      entryPrice > 0
                        ? ((markPrice - entryPrice) / entryPrice) * 100
                        : 0;

                    return (
                      <tr key={index} className="group">
                        <td className="font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                              <span className="text-xs font-bold">
                                {position.symbol?.[5] || "?"}
                              </span>
                            </div>
                            <span>
                              {position.symbol
                                ?.replace("PERP_", "")
                                .replace("_USDC", "") || "N/A"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
                              size > 0
                                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                : "bg-red-500/20 text-red-400 border border-red-500/30"
                            }`}
                          >
                            {size > 0 ? (
                              <>
                                <TrendingUp className="w-4 h-4 mr-1" />
                                LONG
                              </>
                            ) : (
                              <>
                                <TrendingDown className="w-4 h-4 mr-1" />
                                SHORT
                              </>
                            )}
                          </span>
                        </td>
                        <td className="font-mono">
                          {Math.abs(size).toFixed(4)}
                        </td>
                        <td className="font-mono">
                          $
                          {entryPrice.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="font-mono">
                          $
                          {markPrice.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td>
                          <div
                            className={`inline-flex items-center px-3 py-1.5 rounded-lg ${
                              pnl >= 0
                                ? "bg-green-500/10 text-green-400"
                                : "bg-red-500/10 text-red-400"
                            }`}
                          >
                            <span className="font-medium">
                              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                            </span>
                            <span className="ml-2 text-xs opacity-80">
                              ({pnlPercent >= 0 ? "+" : ""}
                              {pnlPercent.toFixed(2)}%)
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent Trades — platform ledger, scoped to the unified account
            selection (single selector lives in AccountOverviewSection). */}
        <Card>
          <SectionHeader
            title="Recent Trades"
            subtitle={
              activeAccountId
                ? `Latest fills · ${accountLabels[activeAccountId] ?? activeAccountId}`
                : `Latest fills`
            }
          />
          <div className="max-h-96 overflow-y-auto">
            <RecentTradesTable
              trades={ledgerTrades}
              isLoading={ledgerTradesLoading}
              error={ledgerTradesError}
              accountLabels={accountLabels}
            />
          </div>
        </Card>
      </div>

      {/* Deep links: Strategies for every VERIFIED user, Analytics only with
          the QUALIFIED_ALPHA role (nav + route parity — no dead ends). */}
      <div className="flex flex-wrap items-center gap-4 mt-6">
        <Link
          to="/strategies"
          className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4"
        >
          <Activity className="w-4 h-4" />
          Manage Strategies
        </Link>
        {hasAnalyticsRole && (
          <Link
            to="/analytics"
            className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-text underline underline-offset-4"
          >
            <BarChart3 className="w-4 h-4" />
            View Analytics
          </Link>
        )}
      </div>
    </>
  );
};
