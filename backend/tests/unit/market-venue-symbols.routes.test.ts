/** @format */

/**
 * X2: `/api/market/venue-symbols` — the venue catalog the frontend consults to
 * make the start-time symbol picker venue-aware.
 *
 * Contract pinned here:
 * - auth-gated (any authenticated user; only public catalog metadata);
 * - unknown/incomplete exchange|environment → 400;
 * - available catalog → `{ available: true, symbols: [...] }`;
 * - unfetchable catalog (`listVenueSymbols` → null) → `{ available: false,
 *   symbols: [] }` (fail-open — the UI stays silent, the start gate decides).
 */

import request from "supertest";
import express, { Express } from "express";

jest.mock("../../src/interfaces/middleware/auth.middleware", () => ({
  authMiddleware: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: "u1", userLevel: "VERIFIED" };
    next();
  }),
  AuthenticatedRequest: jest.fn(),
}));

jest.mock("../../src/infrastructure/external/venue-symbols", () => ({
  listVenueSymbols: jest.fn(),
}));

import { venueSymbolsRoutes } from "../../src/interfaces/http/trading/market-venue-symbols.routes";
import { listVenueSymbols } from "../../src/infrastructure/external/venue-symbols";

const listVenueSymbolsMock = listVenueSymbols as jest.Mock;

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/market", venueSymbolsRoutes);
  return app;
}

describe("market venue-symbols route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the lighter catalog with available: true", async () => {
    listVenueSymbolsMock.mockResolvedValue(["BTC", "ETH", "ETH/USDC", "SOL"]);
    const res = await request(createApp()).get(
      "/api/market/venue-symbols?exchange=lighter&environment=testnet"
    );
    expect(res.status).toBe(200);
    expect(listVenueSymbolsMock).toHaveBeenCalledWith("lighter", "testnet");
    expect(res.body).toMatchObject({
      success: true,
      data: {
        exchange: "lighter",
        environment: "testnet",
        available: true,
        symbols: ["BTC", "ETH", "ETH/USDC", "SOL"],
      },
    });
  });

  it("returns the kodiak catalog", async () => {
    listVenueSymbolsMock.mockResolvedValue(["PERP_BTC_USDC", "PERP_ETH_USDC"]);
    const res = await request(createApp()).get(
      "/api/market/venue-symbols?exchange=kodiak&environment=mainnet"
    );
    expect(res.status).toBe(200);
    expect(listVenueSymbolsMock).toHaveBeenCalledWith("kodiak", "mainnet");
    expect(res.body.data.symbols).toEqual(["PERP_BTC_USDC", "PERP_ETH_USDC"]);
  });

  it("reports available: false when the catalog cannot be fetched (fail-open)", async () => {
    listVenueSymbolsMock.mockResolvedValue(null);
    const res = await request(createApp()).get(
      "/api/market/venue-symbols?exchange=lighter&environment=testnet"
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      available: false,
      symbols: [],
    });
  });

  it("400s on a missing/invalid exchange or environment", async () => {
    const app = createApp();
    expect(
      (await request(app).get("/api/market/venue-symbols?environment=testnet"))
        .status
    ).toBe(400);
    expect(
      (
        await request(app).get(
          "/api/market/venue-symbols?exchange=lighter&environment=staging"
        )
      ).status
    ).toBe(400);
    expect(
      (
        await request(app).get(
          "/api/market/venue-symbols?exchange=coinbase&environment=testnet"
        )
      ).status
    ).toBe(400);
    expect(listVenueSymbolsMock).not.toHaveBeenCalled();
  });
});
