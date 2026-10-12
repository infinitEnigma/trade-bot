/** @format */

/**
 * RecentTradesTable — the shared latest-N trades table for both surfaces
 * (Batch 2): the Dashboard's all-accounts table (variant "full", with the
 * Account + Strategy attribution columns and a header slot for the account
 * filter) and the strategy card's fills list (variant "compact" — the card
 * already names the strategy, so the column would only repeat it).
 *
 * Rows are `LedgerTradeRow`s from GET /api/trades — the platform's own
 * ledger. Honesty rules kept from the F2/F3 work:
 * - NULL pnl/fee renders as "—" (unknown), never a fabricated 0;
 * - a fetch error is its own state, never folded into "No recent trades";
 * - empty-after-success says so plainly.
 *
 * Latest-N semantics: whatever the query returned is what exists here — the
 * table never claims a time window ("24h") it cannot back.
 */

import React from "react";
import { Loader2 } from "lucide-react";
import type { LedgerTradeRow } from "../../../infrastructure/api/trading";

export interface RecentTradesTableProps {
  trades: LedgerTradeRow[];
  isLoading: boolean;
  /** Non-null = the fetch failed; rendered as an error row (not empty state). */
  error: unknown;
  /** "full" = Dashboard (Account + Strategy columns); "compact" = strategy card. */
  variant?: "full" | "compact";
  /** Heading shown above the table. */
  title?: string;
  /**
   * Map exchangeAccountId → human label (e.g. "lighter (testnet) idx-a").
   * The component stays label-agnostic; the Dashboard owns the accounts
   * query and passes the map down.
   */
  accountLabels?: Record<string, string>;
  /** Right-side header slot (the Dashboard's account filter lives here). */
  headerActions?: React.ReactNode;
}

const formatPrice = (price: number): string =>
  price.toLocaleString(undefined, { maximumFractionDigits: 6 });

const formatQuantity = (quantity: number): string =>
  quantity.toLocaleString(undefined, { maximumFractionDigits: 8 });

const formatPnl = (pnl: number | null): React.ReactNode => {
  if (pnl === null) {
    // Unknown PnL (F2) — an em dash, never $0.00.
    return (
      <span className="text-textMuted" title="PnL unknown for this fill">
        —
      </span>
    );
  }
  return (
    <span className={pnl >= 0 ? "text-success" : "text-danger"}>
      {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toLocaleString()}
    </span>
  );
};

export const RecentTradesTable: React.FC<RecentTradesTableProps> = ({
  trades,
  isLoading,
  error,
  variant = "full",
  title = "Recent Trades",
  accountLabels,
  headerActions,
}) => {
  const showAttribution = variant === "full";
  const columnCount = showAttribution ? 8 : 6;

  const renderBody = () => {
    if (isLoading) {
      return (
        <tr>
          <td colSpan={columnCount} className="py-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-sm text-textMuted">Loading trades...</p>
          </td>
        </tr>
      );
    }
    if (error) {
      return (
        <tr>
          <td colSpan={columnCount} className="py-8 text-center">
            <p className="text-sm text-danger">Unable to load trades</p>
          </td>
        </tr>
      );
    }
    if (trades.length === 0) {
      return (
        <tr>
          <td colSpan={columnCount} className="py-8 text-center">
            <p className="text-sm text-textMuted">No recent trades</p>
          </td>
        </tr>
      );
    }
    return trades.map(trade => {
      const timestamp = new Date(trade.executedAt);
      return (
        <tr key={trade.id} className="border-t border-white/5">
          <td className="py-3 text-sm text-textMuted">
            <div className="flex flex-col">
              <span className="font-medium">
                {timestamp.toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span className="text-xs opacity-75">
                {timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </td>
          <td className="py-3 text-sm text-text font-medium">
            {trade.symbol.replace("PERP_", "").replace("_USDC", "")}
          </td>
          <td className="py-3">
            <span
              className={`px-2 py-1 text-xs font-medium rounded ${
                trade.side === "BUY"
                  ? "bg-success/20 text-success"
                  : "bg-danger/20 text-danger"
              }`}
            >
              {trade.side}
            </span>
          </td>
          <td className="py-3 text-sm text-text">
            ${formatPrice(trade.price)}
          </td>
          <td className="py-3 text-sm text-text text-right">
            {formatQuantity(trade.quantity)}
          </td>
          <td className="py-3 text-sm text-right">{formatPnl(trade.pnl)}</td>
          {showAttribution && (
            <>
              <td className="py-3 text-sm text-textMuted">
                {trade.exchangeAccountId
                  ? (accountLabels?.[trade.exchangeAccountId] ??
                    trade.exchangeAccountId)
                  : "—"}
              </td>
              <td className="py-3 text-sm text-textMuted">
                {trade.strategyName ?? "—"}
              </td>
            </>
          )}
        </tr>
      );
    });
  };

  return (
    <div>
      {(title || headerActions) && (
        <div className="flex items-center justify-between mb-4">
          {title && (
            <h2 className="text-lg font-semibold text-text">{title}</h2>
          )}
          {headerActions}
        </div>
      )}
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-textMuted">
              <th className="pb-3 font-medium">Date &amp; Time</th>
              <th className="pb-3 font-medium">Symbol</th>
              <th className="pb-3 font-medium">Side</th>
              <th className="pb-3 font-medium">Price</th>
              <th className="pb-3 font-medium text-right">Size</th>
              <th className="pb-3 font-medium text-right">PnL</th>
              {showAttribution && (
                <>
                  <th className="pb-3 font-medium">Account</th>
                  <th className="pb-3 font-medium">Strategy</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>{renderBody()}</tbody>
        </table>
      </div>
    </div>
  );
};
