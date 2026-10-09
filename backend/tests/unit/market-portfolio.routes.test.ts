/** @format */

/**
 * `/api/market/{positions,balance,trades}` scope rules + venue dispatch
 * (P0-L2 follow-up — the venue-agnostic dashboard).
 *
 * Contract pinned here:
 * - absent id  → legacy kodiak default;
 * - malformed  → 400; unknown/foreign → 404; non-ACTIVE → 409;
 * - kodiak row → kodiakIntegrationService; lighter row → Lighter reader;
 * - a reader failure (`success:false`) → 400 with its error (e.g. sidecar down).
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
      getPositions: jest.fn(),
      getBalance: jest.fn(),
      getTrades: jest.fn(),
    },
  })
);

jest.mock("../../src/infrastructure/external/lighter/portfolio", () => ({
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

import {
  portfolioRoutes,
  resolveAccountScope,
} from "../../src/interfaces/http/trading/market-portfolio.routes";
import { kodiakIntegrationService } from "../../src/infrastructure/external/kodiak-integration.service";
import {
  getLighterBalance,
  getLighterPnl,
  getLighterPositions,
  getLighterTrades,
} from "../../src/infrastructure/external/lighter/portfolio";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";

const getAccountWithSecret =
  exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock;
const kodiakBalance = kodiakIntegrationService.getBalance as jest.Mock;
const kodiakPositions = kodiakIntegrationService.getPositions as jest.Mock;
const kodiakTrades = kodiakIntegrationService.getTrades as jest.Mock;
const lighterBalance = getLighterBalance as jest.Mock;
const lighterPositions = getLighterPositions as jest.Mock;
const lighterTrades = getLighterTrades as jest.Mock;
const lighterPnl = getLighterPnl as jest.Mock;

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/market", portfolioRoutes);
  return app;
}

describe("market portfolio routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    kodiakBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "42" },
    });
    kodiakPositions.mockResolvedValue({ success: true, data: { rows: [] } });
    kodiakTrades.mockResolvedValue({ success: true, data: { rows: [] } });
    lighterBalance.mockResolvedValue({
      success: true,
      data: { totalBalance: "7" },
    });
    lighterPositions.mockResolvedValue({ success: true, data: { rows: [] } });
    lighterTrades.mockResolvedValue({ success: true, data: { rows: [] } });
    lighterPnl.mockResolvedValue({ success: true, data: { points: [] } });
  });

  describe("resolveAccountScope", () => {
    it("defaults to the legacy kodiak scope when the id is absent", async () => {
      await expect(resolveAccountScope("u1", undefined)).resolves.toEqual({
        ok: true,
        exchange: "kodiak",
      });
    });

    it("rejects a malformed id with 400", async () => {
      await expect(resolveAccountScope("u1", "not-a-uuid")).resolves.toEqual({
        ok: false,
        status: 400,
        error: "Invalid exchangeAccountId format",
      });
      expect(getAccountWithSecret).not.toHaveBeenCalled();
    });

    it("answers 404 for unknown/foreign ids", async () => {
      await expect(resolveAccountScope("u1", MISSING_ID)).resolves.toEqual({
        ok: false,
        status: 404,
        error: "Exchange account not found",
      });
    });

    it("answers 409 for non-ACTIVE accounts", async () => {
      getAccountWithSecret.mockResolvedValueOnce({
        id: LIGHTER_ID,
        exchange: "lighter",
        status: "PENDING",
      });
      await expect(resolveAccountScope("u1", LIGHTER_ID)).resolves.toEqual({
        ok: false,
        status: 409,
        error: "Exchange account is not active",
      });
    });

    it("accepts BOTH venues with their exchange tag (no kodiak-only 400)", async () => {
      await expect(resolveAccountScope("u1", LIGHTER_ID)).resolves.toEqual({
        ok: true,
        exchangeAccountId: LIGHTER_ID,
        exchange: "lighter",
      });
      await expect(resolveAccountScope("u1", KODIAK_ID)).resolves.toEqual({
        ok: true,
        exchangeAccountId: KODIAK_ID,
        exchange: "kodiak",
      });
    });
  });

  describe("HTTP venue dispatch", () => {
    it("serves a kodiak account from kodiakIntegrationService", async () => {
      const res = await request(createApp()).get(
        `/api/market/balance?exchangeAccountId=${KODIAK_ID}`
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        data: { totalBalance: "42" },
      });
      expect(kodiakBalance).toHaveBeenCalledWith("u1", KODIAK_ID);
      expect(lighterBalance).not.toHaveBeenCalled();
    });

    it("serves a lighter account from the Lighter reader (no kodiak 400)", async () => {
      const res = await request(createApp()).get(
        `/api/market/balance?exchangeAccountId=${LIGHTER_ID}`
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        data: { totalBalance: "7" },
      });
      expect(lighterBalance).toHaveBeenCalledWith("u1", LIGHTER_ID);
      expect(kodiakBalance).not.toHaveBeenCalled();
    });

    it("dispatches positions per venue", async () => {
      const app = createApp();
      const lighter = await request(app).get(
        `/api/market/positions?exchangeAccountId=${LIGHTER_ID}`
      );
      expect(lighter.status).toBe(200);
      expect(lighterPositions).toHaveBeenCalledWith("u1", LIGHTER_ID);
      expect(kodiakPositions).not.toHaveBeenCalled();

      const kodiak = await request(app).get(
        `/api/market/positions?exchangeAccountId=${KODIAK_ID}`
      );
      expect(kodiak.status).toBe(200);
      expect(kodiakPositions).toHaveBeenCalledWith("u1", KODIAK_ID);
    });

    it("dispatches trades per venue and forwards the limit", async () => {
      const app = createApp();
      const lighter = await request(app).get(
        `/api/market/trades?exchangeAccountId=${LIGHTER_ID}&limit=25`
      );
      expect(lighter.status).toBe(200);
      expect(lighterTrades).toHaveBeenCalledWith("u1", 25, LIGHTER_ID);
      expect(kodiakTrades).not.toHaveBeenCalled();

      const kodiak = await request(app).get(
        `/api/market/trades?exchangeAccountId=${KODIAK_ID}`
      );
      expect(kodiak.status).toBe(200);
      expect(kodiakTrades).toHaveBeenCalledWith("u1", 50, KODIAK_ID);
    });

    it("dispatches venue PnL to Lighter and 404s Kodiak (native rows stay on /trades)", async () => {
      const app = createApp();
      const lighter = await request(app).get(
        `/api/market/pnl?exchangeAccountId=${LIGHTER_ID}&countBack=48`
      );
      expect(lighter.status).toBe(200);
      expect(lighterPnl).toHaveBeenCalledWith("u1", 48, LIGHTER_ID);

      const kodiak = await request(app).get(
        `/api/market/pnl?exchangeAccountId=${KODIAK_ID}`
      );
      expect(kodiak.status).toBe(404);
      expect(lighterPnl).toHaveBeenCalledTimes(1);
    });

    it("keeps the legacy kodiak default when no id is supplied", async () => {
      const res = await request(createApp()).get("/api/market/balance");
      expect(res.status).toBe(200);
      expect(kodiakBalance).toHaveBeenCalledWith("u1", undefined);
      expect(lighterBalance).not.toHaveBeenCalled();
    });

    it("maps scope violations to their HTTP status", async () => {
      const app = createApp();
      expect(
        (await request(app).get("/api/market/balance?exchangeAccountId=nope"))
          .status
      ).toBe(400);
      expect(
        (
          await request(app).get(
            `/api/market/balance?exchangeAccountId=${MISSING_ID}`
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
            `/api/market/balance?exchangeAccountId=${LIGHTER_ID}`
          )
        ).status
      ).toBe(409);
      expect(lighterBalance).not.toHaveBeenCalled();
    });

    it("surfaces a reader failure as 400 with its error (e.g. sidecar down)", async () => {
      lighterBalance.mockResolvedValue({
        success: false,
        error: "sidecar unreachable",
      });
      const res = await request(createApp()).get(
        `/api/market/balance?exchangeAccountId=${LIGHTER_ID}`
      );
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "sidecar unreachable",
      });
    });

    it("surfaces a Lighter positions failure as 400 too", async () => {
      lighterPositions.mockResolvedValue({
        success: false,
        error: "Sidecar unavailable",
      });
      const res = await request(createApp()).get(
        `/api/market/positions?exchangeAccountId=${LIGHTER_ID}`
      );
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: "Sidecar unavailable",
      });
    });
  });
});
