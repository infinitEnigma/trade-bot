/** @format */

/**
 * X3: Strategies chart picker helpers — group building + default selection.
 * Pure logic, so the venue rules (membership, ties, defensive fallbacks)
 * are pinned without rendering the page.
 */

import { describe, it, expect } from "vitest";
import {
  buildChartSymbolGroups,
  decodeChartOption,
  encodeChartOption,
  FALLBACK_CHART_SELECTION,
  ORPHAN_CHART_VENUE,
  resolveChartSelection,
  type VenueCatalog,
} from "../../../features/strategies/utils/chartSymbolPicker";

const LIGHTER: VenueCatalog = {
  exchange: "lighter",
  environment: "testnet",
  available: true,
  symbols: ["ETH", "BTC", "SOL"],
};

const KODIAK: VenueCatalog = {
  exchange: "kodiak",
  environment: "mainnet",
  available: true,
  symbols: ["PERP_ETH_USDC", "PERP_BTC_USDC"],
};

describe("buildChartSymbolGroups", () => {
  it("builds one alphabetized group per available catalog with X1 labels", () => {
    const groups = buildChartSymbolGroups([LIGHTER, KODIAK], []);

    expect(groups).toEqual([
      {
        label: "Lighter testnet",
        exchange: "lighter",
        environment: "testnet",
        symbols: ["BTC", "ETH", "SOL"],
      },
      {
        label: "Kodiak mainnet",
        exchange: "kodiak",
        environment: "mainnet",
        symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"],
      },
    ]);
  });

  it("skips unavailable or empty catalogs (no empty optgroups)", () => {
    const groups = buildChartSymbolGroups(
      [
        { ...LIGHTER, available: false, symbols: [] },
        { ...KODIAK, symbols: [] },
      ],
      ["PERP_ETH_USDC"]
    );

    expect(groups).toEqual([
      {
        label: "Strategy symbols",
        exchange: "kodiak",
        environment: "mainnet",
        symbols: ["PERP_ETH_USDC"],
      },
    ]);
  });

  it("charts unlisted strategy symbols on the ORPHAN venue (Kodiak mainnet), never an account venue", () => {
    // The prod-2026-10-12 regression this pins: a Lighter-only user's legacy
    // PERP_* strategy symbol was charted against Lighter → tv/history 400.
    const groups = buildChartSymbolGroups(
      [LIGHTER],
      ["ETH", "PERP_LINK_USDC", "eth/usdc-odd"]
    );

    expect(groups).toHaveLength(2);
    // "ETH" is listed by the Lighter catalog → only the true orphans move.
    expect(groups[1].label).toBe("Strategy symbols");
    expect(groups[1].exchange).toBe(ORPHAN_CHART_VENUE.exchange);
    expect(groups[1].environment).toBe(ORPHAN_CHART_VENUE.environment);
    expect(groups[1].exchange).toBe("kodiak");
    expect(groups[1].environment).toBe("mainnet");
    expect(groups[1].symbols).toHaveLength(2);
    expect(groups[1].symbols).toEqual(
      expect.arrayContaining(["PERP_LINK_USDC", "eth/usdc-odd"])
    );
  });

  it("adds no orphan group when every strategy symbol is listed", () => {
    const groups = buildChartSymbolGroups([LIGHTER], ["eth", "BTC"]);
    expect(groups).toHaveLength(1);
  });
});

describe("resolveChartSelection", () => {
  it("defaults to the first strategy's symbol with its catalog venue (case-insensitive)", () => {
    expect(resolveChartSelection([KODIAK, LIGHTER], ["perp_eth_usdc"])).toEqual(
      {
        symbol: "perp_eth_usdc",
        exchange: "kodiak",
        environment: "mainnet",
      }
    );
  });

  it("breaks membership ties by catalog (account) order — first catalog wins", () => {
    const both: VenueCatalog[] = [
      { ...KODIAK, symbols: ["BTC"] },
      { ...LIGHTER, symbols: ["BTC"] },
    ];
    expect(resolveChartSelection(both, ["BTC"])).toMatchObject({
      exchange: "kodiak",
      environment: "mainnet",
    });
  });

  it("uses ORPHAN_CHART_VENUE when no catalog lists the symbol (never the account venue)", () => {
    // Prod 2026-10-12: Lighter-only user + legacy PERP_LINK_USDC defaulted
    // to Lighter → tv/history 400. Orphans now chart on Kodiak mainnet.
    expect(resolveChartSelection([LIGHTER], ["PERP_LINK_USDC"])).toEqual({
      symbol: "PERP_LINK_USDC",
      exchange: ORPHAN_CHART_VENUE.exchange,
      environment: ORPHAN_CHART_VENUE.environment,
    });
  });

  it("falls back to the Kodiak default with no strategies and no venues", () => {
    expect(resolveChartSelection([], [])).toEqual(FALLBACK_CHART_SELECTION);
  });

  it("charts BTC on the first usable catalog's venue when there are no strategies", () => {
    // Lighter lists bare BTC — the historic default symbol, venue-corrected.
    expect(resolveChartSelection([LIGHTER], [])).toEqual({
      symbol: "BTC",
      exchange: "lighter",
      environment: "testnet",
    });
    // Unavailable catalogs are not usable.
    expect(
      resolveChartSelection([{ ...LIGHTER, available: false, symbols: [] }], [])
    ).toEqual(FALLBACK_CHART_SELECTION);
  });

  it("treats a malformed catalog (non-array symbols) as unavailable — never throws", () => {
    // Prod 2026-10-14: `q.filter is not a function` blanked /strategies for a
    // fresh Lighter-only account. These helpers run during render, so any
    // throw unmounts the whole page — degrade to fail-open instead.
    const malformed = {
      exchange: "lighter",
      environment: "testnet",
      available: true,
      symbols: undefined,
    } as unknown as VenueCatalog;
    const nullSymbols = { ...malformed, symbols: null };

    expect(() => buildChartSymbolGroups([malformed], ["ETH"])).not.toThrow();
    expect(buildChartSymbolGroups([malformed], ["ETH"])).toEqual([
      {
        label: "Strategy symbols",
        exchange: ORPHAN_CHART_VENUE.exchange,
        environment: ORPHAN_CHART_VENUE.environment,
        symbols: ["ETH"],
      },
    ]);
    expect(() => resolveChartSelection([nullSymbols], ["ETH"])).not.toThrow();
    expect(resolveChartSelection([nullSymbols], ["ETH"])).toEqual({
      symbol: "ETH",
      exchange: ORPHAN_CHART_VENUE.exchange,
      environment: ORPHAN_CHART_VENUE.environment,
    });
    // No strategies + malformed catalog → historic fallback, not a crash.
    expect(resolveChartSelection([malformed], [])).toEqual(
      FALLBACK_CHART_SELECTION
    );
  });
});

describe("encodeChartOption / decodeChartOption", () => {
  it("round-trips a selection", () => {
    const selection = {
      symbol: "ETH/USDC",
      exchange: "lighter",
      environment: "testnet",
    } as const;
    expect(decodeChartOption(encodeChartOption(selection))).toEqual(selection);
  });

  it("keeps the same raw symbol on two venues distinct (X1 trap)", () => {
    const lighter = encodeChartOption({
      symbol: "ETH",
      exchange: "lighter",
      environment: "testnet",
    });
    const kodiak = encodeChartOption({
      symbol: "ETH",
      exchange: "kodiak",
      environment: "mainnet",
    });
    expect(lighter).not.toBe(kodiak);
  });

  it("rejects malformed or unknown-vocabulary values", () => {
    expect(decodeChartOption("")).toBeNull();
    expect(decodeChartOption("coinbase|mainnet|BTC")).toBeNull();
    expect(decodeChartOption("kodiak|staging|BTC")).toBeNull();
    expect(decodeChartOption("kodiak|mainnet|")).toBeNull();
  });
});
