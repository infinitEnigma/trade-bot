/** @format */

import React from "react";
import type { AccountPositionRow } from "../../../infrastructure/api/market";

/**
 * PositionsTable (Phase 3.1, review P2-4): one row per resting venue
 * position for the workspace's scope. ACCOUNT × MARKET truth — the host
 * labels that it is not strategy-attributed. Blank fields render as an em
 * dash, never a fabricated 0 (the OpenOrdersTable honesty rule); the
 * unrealized PnL keeps the venue's own string and is only colour-coded.
 * Loading, error and flat are three distinct states.
 */
interface PositionsTableProps {
  positions: AccountPositionRow[];
  isLoading: boolean;
  /** The venue read failed — distinct from "the account is flat here". */
  error: boolean;
}

export const PositionsTable: React.FC<PositionsTableProps> = ({
  positions,
  isLoading,
  error,
}) => {
  if (positions.length > 0) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs text-textMuted">
              <th className="py-2 pr-3 font-medium">Symbol</th>
              <th className="py-2 pr-3 font-medium">Quantity</th>
              <th className="py-2 pr-3 font-medium">Avg entry</th>
              <th className="py-2 pr-3 font-medium">Mark</th>
              <th className="py-2 font-medium">Unrealized PnL</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(position => {
              // "" → NaN → the honest unknown tone (Number("") is 0 — never
              // let a blank read as a profitable zero).
              const pnl = position.unsettled_pnl
                ? Number(position.unsettled_pnl)
                : NaN;
              return (
                <tr
                  key={position.symbol}
                  className="border-b border-white/5 last:border-none"
                >
                  <td className="py-2 pr-3 font-medium text-text">
                    {position.symbol}
                  </td>
                  <td className="py-2 pr-3 text-text">
                    {position.position_qty || "—"}
                  </td>
                  <td className="py-2 pr-3 text-text">
                    {position.average_open_price || "—"}
                  </td>
                  <td className="py-2 pr-3 text-text">
                    {position.mark_price || "—"}
                  </td>
                  <td
                    className={
                      Number.isFinite(pnl)
                        ? pnl >= 0
                          ? "py-2 text-success"
                          : "py-2 text-danger"
                        : "py-2 text-textMuted"
                    }
                  >
                    {position.unsettled_pnl || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-surface p-4 text-sm text-textMuted">
        Couldn&apos;t load positions — this doesn&apos;t mean the account is
        flat; the venue read failed and will retry automatically.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="rounded-lg bg-surface p-4 text-sm text-textMuted animate-pulse">
        Loading positions…
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-surface p-4 text-sm text-textMuted">
      No position on this market — the account is flat here right now.
    </div>
  );
};
