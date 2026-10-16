/** @format */

/**
 * `GET /api/market/orders` scope rules + venue dispatch (Phase 3 slice 1 —
 * the strategy workspace's venue-direct open-orders read).
 *
 * Contract pinned here (same scope table as market-portfolio.routes.test):
 * - absent id  → legacy kodiak default;
 * - malformed  → 400; unknown/foreign → 404; non-ACTIVE → 409;
 * - kodiak row → kodiakIntegrationService.getOrders; lighter row → getLighterOrders;
 * - `symbol` optional, forwarded trimmed (blank/array → undefined);
 * - a reader failure (`success:false`) → 400 with its error.
 */

import request from "supertest";
import express, { Express } from "express";

const LIGHTER_ID = "72c483bc-4123-47c4-95c9-64aa8df20914";
const KODIAK_ID = "49401abd-f139-4136-bc9e-61fe0bb69118";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

jest.mock("../../src/interfaces/middleware/auth.middleware", () => ({
  authMiddleware: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: "u1", userLevel: "VERIFIED" };
    next();
  }),
  AuthenticatedRequest: jest.fn(),
}));

jest.mock(
  "../../src/infrastructure/external/kodiak-integration.service",
  () => ({
    kodiakIntegrationService: {
      getOrders: jest.fn(),
      getPositions: jest.fn(),
      getBalance: jest.fn(),
      getTrades: jest.fn(),
    },
  })
);

jest.mock("../../src/infrastructure/external/lighter/portfolio", () => ({
  getLighterOrders: jest.fn(),
  getLighterPositions: jest.fn(),
  getLighterBalance: jest.fn(),
  getLighterTrades: jest.fn(),
  getLighterPnl: jest.fn(),
}));

jest.mock(
  "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      getAccountWithSecret: jest.fn(),
    },
  })
);

import { ordersRoutes } from "../../src/interfaces/http/trading/market-orders.routes";
import { setPortfolioScopeDeps } from "../../src/interfaces/http/trading/market-portfolio.routes";
import { kodiakIntegrationService } from "../../src/infrastructure/external/kodiak-integration.service";
import { getLighterOrders } from "../../src/infrastructure/external/lighter/portfolio";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";

const getAccountWithSecret =
  exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock;
const kodiakOrders = kodiakIntegrationService.getOrders as jest.Mock;
const lighterOrders = getLighterOrders as jest.Mock;

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/market", ordersRoutes);
  return app;
}

describe("market orders route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Review P3: ordersRoutes shares resolveAccountScope with the portfolio
    // routes, which now consume the injected port.
    setPortfolioScopeDeps({ getAccountWithSecret });
    getAccountWithSecret.mockImplementation((_userId: string, id: string) => {
      if (id === LIGHTER_ID) {
        return Promise.resolve({
          id: LIGHTER_ID,
          exchange: "lighter",
          status: "ACTIVE",
        });
      }
      if (id === KODIAK_ID) {
        return Promise.resolve({
          id: KODIAK_ID,
          exchange: "kodiak",
          status: "ACTIVE",
        });
      }
      return Promise.resolve(null);
    });
    kodiakOrders.mockResolvedValue({ success: true, data: [] });
    lighterOrders.mockResolvedValue({ success: true, data: [] });
  });

  it("dispatches to the Lighter reader with a trimmed symbol", async () => {
    const res = await request(createApp())
      .get("/api/market/orders")
      .query({ exchangeAccountId: LIGHTER_ID, symbol: " ETH " });

    expect(res.status).toBe(200);
    expect(lighterOrders).toHaveBeenCalledWith("u1", LIGHTER_ID, "ETH");
    expect(kodiakOrders).not.toHaveBeenCalled();
  });

  it("dispatches to Kodiak scoped to the account and forwards the symbol", async () => {
    const res = await request(createApp())
      .get("/api/market/orders")
      .query({ exchangeAccountId: KODIAK_ID, symbol: "PERP_BTC_USDC" });

    expect(res.status).toBe(200);
    expect(kodiakOrders).toHaveBeenCalledWith("u1", KODIAK_ID, "PERP_BTC_USDC");
    expect(lighterOrders).not.toHaveBeenCalled();
  });

  it("keeps the legacy kodiak default when no id is supplied", async () => {
    const res = await request(createApp()).get("/api/market/orders");

    expect(res.status).toBe(200);
    expect(kodiakOrders).toHaveBeenCalledWith("u1", undefined, undefined);
    expect(lighterOrders).not.toHaveBeenCalled();
  });

  it("reads a blank symbol as the whole book (undefined, never an empty id)", async () => {
    const res = await request(createApp())
      .get("/api/market/orders")
      .query({ symbol: "   " });

    expect(res.status).toBe(200);
    expect(kodiakOrders).toHaveBeenCalledWith("u1", undefined, undefined);
  });

  it("maps scope violations to their HTTP status", async () => {
    const app = createApp();
    expect(
      (await request(app).get("/api/market/orders?exchangeAccountId=nope"))
        .status
    ).toBe(400);
    expect(
      (
        await request(app).get(
          `/api/market/orders?exchangeAccountId=${MISSING_ID}`
        )
      ).status
    ).toBe(404);

    getAccountWithSecret.mockResolvedValueOnce({
      id: LIGHTER_ID,
      exchange: "lighter",
      status: "SUSPENDED",
    });
    expect(
      (
        await request(app).get(
          `/api/market/orders?exchangeAccountId=${LIGHTER_ID}`
        )
      ).status
    ).toBe(409);
    expect(lighterOrders).not.toHaveBeenCalled();
    expect(kodiakOrders).not.toHaveBeenCalled();
  });

  it("surfaces a reader failure as 400 with its error (e.g. sidecar down)", async () => {
    lighterOrders.mockResolvedValue({
      success: false,
      error: "sidecar unreachable",
    });
    const res = await request(createApp()).get(
      `/api/market/orders?exchangeAccountId=${LIGHTER_ID}`
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: "sidecar unreachable",
    });
  });

  it("surfaces a Kodiak reader failure as 400 too", async () => {
    kodiakOrders.mockResolvedValue({
      success: false,
      error: "No verified Kodiak credentials found",
    });
    const res = await request(createApp()).get(
      `/api/market/orders?exchangeAccountId=${KODIAK_ID}`
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: "No verified Kodiak credentials found",
    });
  });
});
