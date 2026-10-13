/** @format */

import React from "react";
import { cn } from "../../../shared/utils";
import type { OpenOrderRow } from "../../../infrastructure/api/market";

/**
 * OpenOrdersTable — the strategy workspace's open-orders view (Phase 3,
 * slice 4): one row per resting order for the workspace's scope (the
 * selected strategy's venue account + market).
 *
 * Loading, error and empty are THREE different states — a failed venue read
 * must never masquerade as an empty book (the RecentTradesTable honesty
 * rule). `price`/`quantity` are nullable on purpose (a market order carries
 * no fixed price) and render as an em dash — never a fabricated 0. The
 * section heading + resting count live with the slice-5 execution tab that
 * hosts this table; freshness is the tab's chip, not this component's.
 */
interface OpenOrdersTableProps {
  orders: OpenOrderRow[];
  isLoading: boolean;
  /** The venue read failed — distinct from "the book is empty". */
  error: boolean;
}

export const OpenOrdersTable: React.FC<OpenOrdersTableProps> = ({
  orders,
  isLoading,
  error,
}) => (
  <div>
    {/* Rows win over every state: a stale-but-present book beats a spinner;
        without rows the three states stay mutually exclusive. */}
    {orders.length > 0 ? (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs text-textMuted">
              <th className="py-2 pr-3 font-medium">Symbol</th>
              <th className="py-2 pr-3 font-medium">Side</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Price</th>
              <th className="py-2 pr-3 font-medium">Size</th>
              <th className="py-2 pr-3 font-medium">Filled</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Placed</th>
              <th className="py-2 font-medium">Venue</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr
                key={`${order.exchange}-${order.orderId}`}
                className="border-b border-white/5 last:border-none"
              >
                <td className="py-2 pr-3 font-medium text-text">
                  {order.symbol}
                </td>
                <td
                  className={cn(
                    "py-2 pr-3 font-medium",
                    order.side === "BUY" ? "text-success" : "text-danger"
                  )}
                >
                  {order.side}
                </td>
                <td className="py-2 pr-3 text-textMuted">
                  {order.orderType || "—"}
                </td>
                <td className="py-2 pr-3 text-text">{order.price ?? "—"}</td>
                <td className="py-2 pr-3 text-text">{order.quantity ?? "—"}</td>
                <td className="py-2 pr-3 text-textMuted">
                  {order.quantity != null
                    ? `${order.filledQuantity} / ${order.quantity}`
                    : order.filledQuantity > 0
                      ? String(order.filledQuantity)
                      : "—"}
                </td>
                <td className="py-2 pr-3">
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-white/10 text-textMuted">
                    {order.status}
                  </span>
                </td>
                <td className="py-2 pr-3 text-textMuted">
                  {order.createdAtMs != null
                    ? new Date(order.createdAtMs).toLocaleString()
                    : "—"}
                </td>
                <td className="py-2 text-xs text-textMuted">
                  {order.exchange.toUpperCase()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : error ? (
      <div className="rounded-lg bg-surface p-4 text-sm text-textMuted">
        Couldn&apos;t load open orders — this doesn&apos;t mean the book is
        empty; the venue read failed and will retry automatically.
      </div>
    ) : isLoading ? (
      <div className="rounded-lg bg-surface p-4 text-sm text-textMuted animate-pulse">
        Loading open orders…
      </div>
    ) : (
      <div className="rounded-lg bg-surface p-4 text-sm text-textMuted">
        No open orders — nothing is resting for this strategy right now.
      </div>
    )}
  </div>
);
