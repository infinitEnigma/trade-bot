/** @format */

/**
 * X3: Lighter public candles reader (`lighter/market-data.ts`) — the venue
 * dispatch behind `GET /api/market/tv/history?exchange=lighter`.
 *
 * Contract pinned here:
 * - TradingView resolution → Lighter enum (`1→1m … 720→12h`, `1D`/`D→1d`);
 *   anything else fails loudly without touching the venue (no silent clamp);
 * - symbol resolves through the market directory (mocked); a miss is an
 *   explicit "not listed" error, never a guessed id;
 * - route `from`/`to` are unix **seconds**, venue params are **milliseconds**;
 *   `count_back` derives from the window, capped at the venue's 500 max;
 * - venue rows convert to TradingView columns with `t` in **seconds**;
 * - venue rejections / transport failures answer `{success:false, error}`
 *   (never throw) — the route maps that to 400 like the Kodiak branch.
 */

type MarketDataModule =
  typeof import("../../src/infrastructure/external/lighter/market-data");

const ROWS = [
  // Out of order on purpose — the reader must emit chronological columns.
  { t: 1791503600000, o: 81700.5, h: 81800, l: 81600, c: 81750.25, v: 12.5 },
  { t: 1791500000000, o: 81600, h: 81710, l: 81500, c: 81700.5, v: 10 },
];

describe("lighter candles reader", () => {
  let marketData: MarketDataModule;
  let venueGet: jest.Mock;
  let resolveMarketId: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    venueGet = jest.fn().mockResolvedValue({ data: { code: 200, c: ROWS } });
    resolveMarketId = jest.fn().mockResolvedValue(1);

    jest.doMock("axios", () => ({
      __esModule: true,
      isAxiosError: (error: unknown) =>
        Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
      default: {
        create: jest.fn(() => ({ get: venueGet })),
      },
    }));
    jest.doMock(
      "../../src/infrastructure/external/lighter/market-directory",
      () => ({ resolveMarketId })
    );
    jest.doMock("../../src/core/logging/context-aware-logger.service", () => ({
      integrationLogger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    marketData = require("../../src/infrastructure/external/lighter/market-data");
  });

  it("maps TV resolutions to Lighter enums and sends ms timestamps", async () => {
    const result = await marketData.getLighterCandles({
      symbol: "BTC",
      resolution: "1",
      from: 1791500000,
      to: 1791503600,
      environment: "mainnet",
    });

    expect(result.success).toBe(true);
    expect(resolveMarketId).toHaveBeenCalledWith("BTC", "mainnet");
    const [path, options] = venueGet.mock.calls[0];
    expect(path).toBe("/api/v1/candles");
    // Route seconds → venue milliseconds; count_back = window/candle + 1.
    expect(options.params).toEqual({
      market_id: 1,
      resolution: "1m",
      start_timestamp: 1791500000000,
      end_timestamp: 1791503600000,
      count_back: 61,
    });
  });

  it("maps the daily resolutions (1D and D) to 1d", async () => {
    for (const resolution of ["1D", "D"]) {
      venueGet.mockClear();
      const result = await marketData.getLighterCandles({
        symbol: "BTC",
        resolution,
        from: 1790000000,
        to: 1791500000,
        environment: "testnet",
      });
      expect(result.success).toBe(true);
      expect(venueGet.mock.calls[0][1].params.resolution).toBe("1d");
    }
  });

  it("rejects an unsupported resolution without hitting the venue", async () => {
    const result = await marketData.getLighterCandles({
      symbol: "BTC",
      resolution: "120",
      from: 1791500000,
      to: 1791503600,
      environment: "mainnet",
    });

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('Unsupported resolution "120"');
    expect(resolveMarketId).not.toHaveBeenCalled();
    expect(venueGet).not.toHaveBeenCalled();
  });

  it("answers an explicit not-listed error when the symbol is not on the venue", async () => {
    resolveMarketId.mockResolvedValueOnce(null);

    const result = await marketData.getLighterCandles({
      symbol: "PERP_ETH_USDC",
      resolution: "60",
      from: 1791500000,
      to: 1791503600,
      environment: "testnet",
    });

    expect(result).toMatchObject({
      success: false,
      error: 'symbol "PERP_ETH_USDC" not listed on Lighter',
    });
    expect(venueGet).not.toHaveBeenCalled();
  });

  it("emits TradingView columns with t in seconds, chronologically sorted", async () => {
    const result = await marketData.getLighterCandles({
      symbol: "BTC",
      resolution: "60",
      from: 1791496400,
      to: 1791503600,
      environment: "mainnet",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      s: "ok",
      t: [1791500000, 1791503600], // ms → seconds
      o: [81600, 81700.5],
      h: [81710, 81800],
      l: [81500, 81600],
      c: [81700.5, 81750.25],
      v: [10, 12.5],
    });
  });

  it("caps count_back at the venue's 500-candle maximum", async () => {
    await marketData.getLighterCandles({
      symbol: "BTC",
      resolution: "1",
      from: 1790000000, // ~17 days of minutes ≫ 500
      to: 1791500000,
      environment: "mainnet",
    });

    expect(venueGet.mock.calls[0][1].params.count_back).toBe(500);
  });

  it("passes a venue rejection (code != 200) through as an error", async () => {
    venueGet.mockResolvedValueOnce({
      data: { code: 400, message: "invalid market_id" },
    });

    const result = await marketData.getLighterCandles({
      symbol: "BTC",
      resolution: "1",
      from: 1791500000,
      to: 1791503600,
      environment: "mainnet",
    });

    expect(result).toEqual({
      success: false,
      error: "Lighter candles error: invalid market_id",
    });
  });

  it("answers no_data for an empty window (success, not an error)", async () => {
    venueGet.mockResolvedValueOnce({ data: { code: 200, c: [] } });

    const result = await marketData.getLighterCandles({
      symbol: "BTC",
      resolution: "1",
      from: 1791500000,
      to: 1791503600,
      environment: "mainnet",
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ s: "no_data", t: [] });
  });

  it("maps a transport failure to success:false (never throws)", async () => {
    venueGet.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503, data: { message: "venue down" } },
    });

    const result = await marketData.getLighterCandles({
      symbol: "BTC",
      resolution: "1",
      from: 1791500000,
      to: 1791503600,
      environment: "mainnet",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Lighter candles unavailable");
    expect(result.error).toContain("HTTP 503: venue down");
  });
});
