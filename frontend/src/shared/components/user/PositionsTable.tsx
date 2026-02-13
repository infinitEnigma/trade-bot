/** @format */

import React, { Suspense } from "react";
import { TrendingUp, TrendingDown, Settings, X, Loader2, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../ui";
import { SectionHeader } from "../ui";
import { Position } from "../../../features/dashboard/types/dashboard.types";
import { useAuth } from "@/features/auth";
import { UserLevel } from "@/shared/types";

interface PositionsTableProps {
  positions: Position[];
  profitablePositions: number;
  isLoading: boolean;
}

/**
 * PositionsTable component - displays open trading positions
 */
export const PositionsTable: React.FC<PositionsTableProps> = ({
  positions,
  profitablePositions,
  isLoading,
}) => {
  const { user } = useAuth();
    
    if (!user && !UserLevel.VERIFIED) return null;
  return (
    <Card>
      <SectionHeader
        title="Open Positions"
        subtitle={`${positions.length} active positions • ${profitablePositions} profitable`}
        actions={
          <>
            <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm">
              Filter
            </button>
            <button className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm">
              Sort
            </button>
          </>
        }
      />

      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="table-enhanced w-full min-w-[600px]">
          <thead>
            <tr>
              <th className="text-left">Symbol</th>
              <th className="text-left">Side</th>
              <th className="text-left">Size</th>
              <th className="text-left">Entry Price</th>
              <th className="text-left">Current Price</th>
              <th className="text-left">PnL</th>
              <th className="text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                    <p className="text-text-secondary">Loading positions...</p>
                  </div>
                </td>
              </tr>
            ) : positions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8">
                  <Suspense
                    fallback={
                      <div className="flex flex-col items-center justify-center py-4">
                        <Loader2 className="w-6 h-6 animate-spin text-primary mb-2" />
                        <p className="text-sm text-textMuted">Loading...</p>
                      </div>
                    }
                  >
                    <div className="text-center">
                      <Target className="w-6 h-6 mx-auto mb-2 text-primary" />
                      <p className="text-sm text-text mb-4">
                        No Open Positions
                      </p>
                      <p className="text-xs text-textMuted mb-4">
                        Start trading by creating a new strategy or opening a position manually.
                      </p>
                      <Link
                        to="/strategies"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                      >
                        Manage Strategies
                      </Link>
                    </div>
                  </Suspense>
                </td>
              </tr>
            ) : (
              positions.map((position, index) => {
                const pnl = parseFloat(position.unsettled_pnl || "0");
                const size = parseFloat(position.position_qty || "0");
                const markPrice = parseFloat(position.mark_price || "0");
                const entryPrice = parseFloat(position.average_open_price || "0");
                const pnlPercent =
                  entryPrice > 0 ? ((markPrice - entryPrice) / entryPrice) * 100 : 0;

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
                    <td className="font-mono">{Math.abs(size).toFixed(4)}</td>
                    <td className="font-mono">
                      ${entryPrice.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="font-mono">
                      ${markPrice.toLocaleString(undefined, {
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
                    <td>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="p-1.5 rounded hover:bg-white/5"
                          title="Close"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          className="p-1.5 rounded hover:bg-white/5"
                          title="Edit"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
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
  );
};
