/** @format */

/**
 * Workspace chart binding (Phase 3.1, review P1-1) — pure helper deciding
 * which market the selected-strategy workspace's chart shows.
 *
 * The chart follows the SELECTED strategy: its symbol resolved through the
 * existing chartSymbolPicker rules (catalog membership → venue, orphan →
 * ORPHAN_CHART_VENUE, no symbol → BTC/fallback). The operator's dropdown pick
 * is KEYED to the strategy it was made for — it persists while that strategy
 * stays selected and is ignored once another is selected (the chart rebinds
 * to the new strategy instead of showing a stale market).
 *
 * Derived during render by the caller — no effects, no reset handlers.
 */

import {
  resolveChartSelection,
  type ChartSelection,
  type VenueCatalog,
} from "./chartSymbolPicker";

/** A dropdown pick, remembered per strategy. */
export interface ChartSelectionOverride {
  strategyId: string;
  selection: ChartSelection;
}

/** Minimal strategy shape the binding needs. */
export interface ChartBoundStrategy {
  id: string;
  /** Raw config symbol (`""` when absent → falls back to the BTC rules). */
  symbol?: string;
}

export function resolveWorkspaceChartSelection(
  catalogs: VenueCatalog[],
  strategy: ChartBoundStrategy | null,
  override: ChartSelectionOverride | null
): ChartSelection {
  const defaultSelection = resolveChartSelection(
    catalogs,
    strategy?.symbol ? [strategy.symbol] : []
  );
  if (strategy && override && override.strategyId === strategy.id) {
    return override.selection;
  }
  return defaultSelection;
}
