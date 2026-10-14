/** @format */

/**
 * CleanupIncompleteBanner — the standing warning that a stop could NOT
 * verify its venue-side cleanup (wire contract: the engine/backend
 * `cleanup_incomplete` marker inside `bot_instances.force_stop_reason`,
 * surfaced to the UI by P0.1 — before this, NOTHING in the frontend read the
 * column).
 *
 * Prod 2026-10-14: the panic flatten left 2 BTC open on the venue while the
 * frontend toasted success on the HTTP 202 — a dispatch ack, never an
 * outcome. This banner is what a 202 can never replace:
 * - it renders the stop's VERIFIED residual verbatim (the exact quantity the
 *   engine still saw at the venue), and
 * - "Re-check venue" re-reads the venue's own position + open orders
 *   (READ-ONLY — it never moves money) so the operator can confirm current
 *   state with the same source of truth the engine used.
 *
 * The banner cannot be dismissed while the marker is present: the column is
 * never reset, so a clean-looking STOPPED row always stays distinguishable
 * from one that may still hold live venue exposure.
 */
import React, { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { marketApi } from "../../../../infrastructure/api";
import { unwrapRows } from "../../../../infrastructure/api/envelope";
import { cleanupIncompleteDetail } from "../../utils/cleanupIncomplete";
import type {
  AccountPositionRow,
  OpenOrderRow,
} from "../../../../infrastructure/api/market";

interface CleanupIncompleteBannerProps {
  /** The bot's `force_stop_reason`; null/absent = verified-clean stop. */
  forceStopReason?: string | null;
  /** Bound venue account — scopes the read-only re-check. */
  exchangeAccountId?: string | null;
  /** The bot's symbol, when known — narrows the re-check to this market. */
  symbol?: string;
}

interface VenueCheck {
  positionLabel: string;
  openOrders: number;
  checkedAt: number;
}

export const CleanupIncompleteBanner: React.FC<
  CleanupIncompleteBannerProps
> = ({ forceStopReason, exchangeAccountId, symbol }) => {
  const detail = cleanupIncompleteDetail(forceStopReason);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [venueCheck, setVenueCheck] = useState<VenueCheck | null>(null);

  if (!detail) return null;

  const recheckVenue = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const [positionsRes, ordersRes] = await Promise.all([
        marketApi.getPositions(exchangeAccountId ?? undefined),
        marketApi.getOpenOrders({
          exchangeAccountId: exchangeAccountId ?? undefined,
          symbol: symbol || undefined,
        }),
      ]);
      const positions = unwrapRows<AccountPositionRow>(
        positionsRes?.data
      ).filter(
        row =>
          !symbol ||
          String(row.symbol ?? "").toUpperCase() === symbol.toUpperCase()
      );
      const orders = unwrapRows<OpenOrderRow>(ordersRes?.data);
      // Honest either way: a symbol-less re-check reports row counts, never a
      // cross-market sum dressed up as "the position".
      const positionLabel = symbol
        ? `position ${
            positions.reduce(
              (sum, row) => sum + (Number(row.position_qty) || 0),
              0
            ) || 0
          } ${symbol}`
        : `${positions.length} position row${positions.length === 1 ? "" : "s"} (no symbol filter)`;
      setVenueCheck({
        positionLabel,
        openOrders: orders.length,
        checkedAt: Date.now(),
      });
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="cleanup-incomplete-banner"
      className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-300">
            Stop incomplete — venue state not verified
          </p>
          <p className="break-words text-xs text-red-200/90">{detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void recheckVenue()}
          disabled={checking}
          className="flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/30 disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Re-checking venue…" : "Re-check venue"}
        </button>
        <span className="text-[11px] text-red-200/70">
          The bot is stopped and cannot act — close any residual on the exchange
          directly.
        </span>
      </div>
      {venueCheck ? (
        <p className="text-xs text-red-100" data-testid="venue-check-result">
          Venue now: {venueCheck.positionLabel} •{" "}
          {venueCheck.openOrders > 0
            ? `${venueCheck.openOrders} open order${venueCheck.openOrders === 1 ? "" : "s"}`
            : "no open orders"}{" "}
          (read {new Date(venueCheck.checkedAt).toLocaleTimeString()})
        </p>
      ) : null}
      {checkError ? (
        <p className="text-xs text-red-300" data-testid="venue-check-error">
          Re-check failed: {checkError}
        </p>
      ) : null}
    </div>
  );
};

export default CleanupIncompleteBanner;
