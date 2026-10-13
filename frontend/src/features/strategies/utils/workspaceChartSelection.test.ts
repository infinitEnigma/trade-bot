/** @format */

/**
 * resolveWorkspaceChartSelection (Phase 3.1, review P1-1): the chart follows
 * the SELECTED strategy; a dropdown pick wins only while the strategy it was
 * made for stays selected — switching strategies rebinds the chart.
 */

import { describe, it, expect } from "vitest";
import {
  resolveWorkspaceChartSelection,
  type ChartSelectionOverride,
} from "../utils/workspaceChartSelection";
import type { VenueCatalog } from "../utils/chartSymbolPicker";

const KODIAK: VenueCatalog = {
  exchange: "kodiak",
  environment: "mainnet",
  available: true,
  symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"],
};

const LIGHTER: VenueCatalog = {
  exchange: "lighter",
  environment: "mainnet",
  available: true,
  symbols: ["BTC"],
};

const override = (
  strategyId: string,
  selection: ChartSelectionOverride["selection"]
): ChartSelectionOverride => ({ strategyId, selection });

describe("resolveWorkspaceChartSelection", () => {
  it("charts the selected strategy's symbol on its catalog venue", () => {
    expect(
      resolveWorkspaceChartSelection(
        [KODIAK, LIGHTER],
        { id: "s1", symbol: "PERP_ETH_USDC" },
        null
      )
    ).toEqual({
      symbol: "PERP_ETH_USDC",
      exchange: "kodiak",
      environment: "mainnet",
    });
  });

  it("honours the operator's pick while the same strategy stays selected", () => {
    const pick: ChartSelectionOverride["selection"] = {
      symbol: "BTC",
      exchange: "lighter",
      environment: "mainnet",
    };
    expect(
      resolveWorkspaceChartSelection(
        [KODIAK, LIGHTER],
        { id: "s1", symbol: "PERP_ETH_USDC" },
        override("s1", pick)
      )
    ).toEqual(pick);
  });

  it("rebinds when another strategy is selected (stale pick ignored)", () => {
    const pick: ChartSelectionOverride["selection"] = {
      symbol: "BTC",
      exchange: "lighter",
      environment: "mainnet",
    };
    expect(
      resolveWorkspaceChartSelection(
        [KODIAK, LIGHTER],
        { id: "s2", symbol: "PERP_BTC_USDC" },
        override("s1", pick)
      )
    ).toEqual({
      symbol: "PERP_BTC_USDC",
      exchange: "kodiak",
      environment: "mainnet",
    });
  });

  it("ignores an override when nothing is selected (historic BTC rules)", () => {
    const pick: ChartSelectionOverride["selection"] = {
      symbol: "PERP_ETH_USDC",
      exchange: "kodiak",
      environment: "mainnet",
    };
    expect(
      resolveWorkspaceChartSelection([LIGHTER], null, override("s1", pick))
    ).toEqual({
      symbol: "BTC",
      exchange: "lighter",
      environment: "mainnet",
    });
  });

  it("treats an empty config symbol as no symbol (BTC rules)", () => {
    expect(
      resolveWorkspaceChartSelection([KODIAK], { id: "s1", symbol: "" }, null)
    ).toEqual({
      symbol: "PERP_BTC_USDC",
      exchange: "kodiak",
      environment: "mainnet",
    });
  });
});
