/** @format */

/**
 * StrategyChartPanel — the Strategies page's persistent chart (F5).
 *
 * Lifted out of `StrategyWorkspace` (where it lived inside the selected
 * strategy's detail pane) so it is a PAGE-level market view: it mounts in the
 * empty state — where the workspace, and therefore the old chart, never
 * rendered at all — and stays mounted while a strategy is created or edited
 * (the form is now a side panel beside it, not a full-screen modal covering
 * it). The chart is a market view, not a strategy view; only the preview band
 * is strategy-shaped.
 *
 * Deliberately dumb about scope: the caller owns which market is selected,
 * which orders belong to it and which grid is being previewed. The chart
 * itself filters the forwarded book to the charted market (its own
 * `toDisplaySymbol` guard), so an account-wide book is safe to pass and a
 * market the operator detours to simply shows no levels — the same defensive
 * behaviour the workspace relied on.
 */

import React, { Suspense, lazy } from "react";
import { Card } from "../../../shared/components/ui";
import {
  decodeChartOption,
  encodeChartOption,
  venueLabel,
  type ChartSelection,
  type ChartSymbolGroup,
} from "../utils/chartSymbolPicker";
import type { OpenOrderRow } from "../../../infrastructure/api/market";
import type { GridPreviewInput } from "../../../shared/components/charts/gridPreview";

// Same performance reason as everywhere else: the chart pulls in
// lightweight-charts, which is a separate vendor chunk.
const CandlestickChart = lazy(
  () => import("../../../shared/components/charts/CandlestickChart")
);

/** The pane's height — unchanged from the workspace's chart (Phase 3.1). */
const CHART_HEIGHT = 450;

/**
 * Do two symbol spellings name the same market? Venues disagree (`BTC` vs
 * `PERP_BTC_USDC`), and the form's symbol field and the chart dropdown are two
 * independent pickers, so a naive `===` would report a mismatch for the same
 * market spelled two ways. Mirrors the chart's own `toDisplaySymbol`.
 */
const sameMarket = (left: string, right: string): boolean => {
  const normalise = (raw: string): string => {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) return "";
    return symbol.includes("_") ? symbol : `PERP_${symbol}_USDC`;
  };
  return normalise(left) === normalise(right);
};

/**
 * The venue a symbol spelling implies. `PERP_*_USDC` is Kodiak/Orderly naming;
 * a bare or slash-quoted symbol (`BTC`, `ETH/USDC`) is Lighter's. This is the
 * only venue signal the form's symbol field carries — strategies store no
 * exchange today (the documented X2 gap), so the spelling is a proxy, not an
 * authoritative binding.
 */
const impliedVenue = (raw: string): string | null => {
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return null;
  return symbol.includes("_") ? "kodiak" : "lighter";
};

interface StrategyChartPanelProps {
  /** The charted market + venue (page-owned selection). */
  selection: ChartSelection;
  /** Venue-grouped dropdown options (X1 labels, X3 venue disambiguation). */
  groups: ChartSymbolGroup[];
  /** Total selectable symbols — the picker only shows when there is a choice. */
  optionCount: number;
  onSelectionChange: (selection: ChartSelection) => void;
  /**
   * The account's open-orders book. May be unfiltered — the chart keeps only
   * the rows for the market it is showing.
   */
  orders?: OpenOrderRow[];
  /**
   * F5: the grid the form is currently configuring. `null` (or absent) when no
   * form is open. A draft naming another market is NOT drawn — a band on the
   * wrong market is worse than no band — the panel says so instead.
   */
  previewGrid?: GridPreviewInput | null;
  /**
   * Review P1: where the forwarded order levels come from, in one honest line
   * (e.g. "Levels: Lighter testnet · account 42"). Rendered under the picker so
   * the operator always knows whose resting orders are drawn — an
   * attribution the chart itself cannot state, because the backend's book
   * response carries rows but not the account that answered.
   */
  ordersNote?: string;
}

export const StrategyChartPanel: React.FC<StrategyChartPanelProps> = ({
  selection,
  groups,
  optionCount,
  onSelectionChange,
  orders,
  previewGrid,
  ordersNote,
}) => {
  // Review P1: the preview must name the charted MARKET *and* the charted
  // VENUE. A band is centred on the live price of whichever market is on
  // screen, so previewing a grid that will run on the other venue would place
  // its levels around the wrong book. The form's symbol spelling is the only
  // venue signal it carries (strategies store no exchange — X2).
  const previewOffVenue =
    previewGrid != null &&
    (impliedVenue(previewGrid.symbol) ?? selection.exchange) !==
      selection.exchange;
  const previewOffMarket =
    previewGrid != null && !sameMarket(previewGrid.symbol, selection.symbol);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Market</h2>
          <p className="text-xs text-textMuted">
            {venueLabel(selection.exchange, selection.environment)} ·{" "}
            {selection.symbol.replace("PERP_", "").replace("_USDC", "")} — live
            candles, your resting orders, and the grid you are configuring
          </p>
        </div>
        {optionCount > 1 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="strategies-chart-symbol"
              className="text-sm text-textMuted"
            >
              Chart symbol
            </label>
            <select
              id="strategies-chart-symbol"
              value={encodeChartOption(selection)}
              onChange={event => {
                const decoded = decodeChartOption(event.target.value);
                if (decoded) onSelectionChange(decoded);
              }}
              aria-label="Chart symbol"
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-text focus:border-primary/50 focus:outline-none"
            >
              {groups.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.symbols.map(symbol => (
                    <option
                      key={symbol}
                      value={encodeChartOption({
                        symbol,
                        exchange: group.exchange,
                        environment: group.environment,
                      })}
                    >
                      {symbol.replace("PERP_", "").replace("_USDC", "")}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
      </div>

      {previewGrid && (previewOffMarket || previewOffVenue) && (
        <p className="text-xs text-textMuted">
          You are configuring{" "}
          <span className="text-text">
            {previewGrid.symbol.replace("PERP_", "").replace("_USDC", "")}
          </span>{" "}
          — switch the chart to that market to see its levels here.
        </p>
      )}

      {ordersNote && <p className="text-xs text-textMuted">{ordersNote}</p>}

      <Suspense
        fallback={
          <div className="glass-card p-6 animate-pulse">
            <div className="w-32 h-5 bg-surface rounded mb-4"></div>
            <div className="bg-surface rounded-lg h-110"></div>
          </div>
        }
      >
        <CandlestickChart
          symbol={selection.symbol}
          interval="1h"
          height={CHART_HEIGHT}
          venue={{
            exchange: selection.exchange,
            environment: selection.environment,
          }}
          orders={orders}
          previewGrid={previewOffMarket || previewOffVenue ? null : previewGrid}
        />
      </Suspense>
    </Card>
  );
};
