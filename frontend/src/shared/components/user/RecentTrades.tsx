/** @format */

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "../ui";
import { Trade } from "../../../features/dashboard/types/dashboard.types";
import { useAuth } from "@/features/auth";
import { UserLevel } from "@/shared/types";

interface RecentTradesProps {
  trades: Trade[];
  isLoading: boolean;
}

/**
 * RecentTrades component - displays recent trading activity
 */
export const RecentTrades: React.FC<RecentTradesProps> = ({
  trades,
  isLoading,
}) => {
  const { user } = useAuth();
      
      if (!user && !UserLevel.VERIFIED) return null;
  const [currentTime] = useState(() => Date.now());
  return (
    <Card>
      <h2 className="text-lg font-semibold text-text mb-4">Recent Trades</h2>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-textMuted">
              <th className="pb-3 font-medium">Date & Time</th>
              <th className="pb-3 font-medium">Symbol</th>
              <th className="pb-3 font-medium">Side</th>
              <th className="pb-3 font-medium">Price</th>
              <th className="pb-3 font-medium text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="py-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <p className="text-sm text-textMuted">Loading trades...</p>
                </td>
              </tr>
            ) : !trades || trades.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center">
                  <p className="text-sm text-textMuted">No recent trades</p>
                </td>
              </tr>
            ) : (
              trades.map((trade, index) => {
                const timestamp = new Date(
                  trade.close_timestamp || trade.open_timestamp || currentTime
                );
                const dateString = timestamp.toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                });
                const timeString = timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <tr key={index} className="border-t border-white/5">
                    <td className="py-3 text-sm text-textMuted">
                      <div className="flex flex-col">
                        <span className="font-medium">{dateString}</span>
                        <span className="text-xs opacity-75">{timeString}</span>
                      </div>
                    </td>
                    <td className="py-3 text-sm text-text font-medium">
                      {trade.symbol
                        ?.replace("PERP_", "")
                        .replace("_USDC", "") || "N/A"}
                    </td>
                    <td className="py-3">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          trade.side === "LONG"
                            ? "bg-success/20 text-success"
                            : "bg-danger/20 text-danger"
                        }`}
                      >
                        {trade.side === "LONG" ? "LONG" : "SHORT"}
                      </span>
                    </td>
                    <td className="py-3 text-sm text-text">
                      $
                      {parseFloat(
                        trade.avg_close_price || trade.avg_open_price || "0"
                      ).toLocaleString()}
                    </td>
                    <td className="py-3 text-sm text-text text-right">
                      {parseFloat(trade.closed_position_qty || "0")}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
