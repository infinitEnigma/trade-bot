/** @format */

/**
 * L20: start-time venue symbol gate — the user-facing fail-fast that keeps a
 * non-listed symbol from ever reaching the engine.
 */

jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  assertSymbolSupported,
  listVenueSymbols,
  VenueSymbolError,
} from "../../src/infrastructure/external/venue-symbols";

const originalFetch = global.fetch;

function jsonResponse(
  body: unknown,
  ok = true,
  status = 200
): Promise<Response> {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("venue-symbols", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("listVenueSymbols", () => {
    it("lists lighter symbols from orderBooks", async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({
          code: 200,
          order_books: [
            { symbol: "BTC", market_id: 4100 },
            { symbol: "ETH/USDC", market_id: 4098 },
          ],
        })
      ) as unknown as typeof fetch;

      await expect(listVenueSymbols("lighter", "testnet")).resolves.toEqual([
        "BTC",
        "ETH/USDC",
      ]);
      expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain(
        "/api/v1/orderBooks"
      );
    });

    it("lists kodiak symbols from the Orderly futures instrument list", async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({
          success: true,
          data: {
            rows: [
              { symbol: "PERP_BTC_USDC", status: "ACTIVE" },
              { symbol: "PERP_ETH_USDC", status: "ACTIVE" },
            ],
          },
        })
      ) as unknown as typeof fetch;

      await expect(listVenueSymbols("kodiak", "testnet")).resolves.toEqual([
        "PERP_BTC_USDC",
        "PERP_ETH_USDC",
      ]);
      expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain(
        "/v1/public/futures"
      );
    });

    it("returns null for an unknown exchange (fail-open)", async () => {
      global.fetch = jest.fn() as unknown as typeof fetch;

      await expect(
        listVenueSymbols("somefuturevenue", "testnet")
      ).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns null when the venue fetch fails (fail-open)", async () => {
      global.fetch = jest.fn(() =>
        Promise.reject(new Error("venue down"))
      ) as unknown as typeof fetch;

      await expect(listVenueSymbols("lighter", "testnet")).resolves.toBeNull();
    });

    it("returns null on a non-2xx response (fail-open)", async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({}, false, 503)
      ) as unknown as typeof fetch;

      await expect(listVenueSymbols("lighter", "testnet")).resolves.toBeNull();
    });

    it("returns null when the payload has no symbols (unexpected shape)", async () => {
      global.fetch = jest.fn(() =>
        jsonResponse({ unexpected: true })
      ) as unknown as typeof fetch;

      await expect(listVenueSymbols("lighter", "testnet")).resolves.toBeNull();
    });
  });

  describe("assertSymbolSupported", () => {
    const lighterCatalog = () =>
      jsonResponse({
        order_books: [{ symbol: "BTC" }, { symbol: "SOL" }, { symbol: "ETH" }],
      });

    it("resolves when the symbol is listed (case-insensitive)", async () => {
      global.fetch = jest.fn(() => lighterCatalog()) as unknown as typeof fetch;

      await expect(
        assertSymbolSupported("btc", "lighter", "testnet")
      ).resolves.toBeUndefined();
    });

    it("rejects an unlisted symbol with a user-facing 400", async () => {
      global.fetch = jest.fn(() => lighterCatalog()) as unknown as typeof fetch;

      const error = await assertSymbolSupported(
        "PERP_BTC_USDC",
        "lighter",
        "testnet"
      ).catch(e => e as VenueSymbolError);

      expect(error).toBeInstanceOf(VenueSymbolError);
      expect((error as VenueSymbolError).statusCode).toBe(400);
      expect((error as Error).message).toContain(
        'Symbol "PERP_BTC_USDC" is not listed on lighter (testnet)'
      );
      expect((error as Error).message).toContain("Supported symbols: BTC, ETH");
    });

    it("fails open when the catalog cannot be fetched", async () => {
      global.fetch = jest.fn(() =>
        Promise.reject(new Error("venue down"))
      ) as unknown as typeof fetch;

      await expect(
        assertSymbolSupported("PERP_BTC_USDC", "lighter", "testnet")
      ).resolves.toBeUndefined();
    });
  });
});
