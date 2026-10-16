/** @format */

/**
 * `GET /api/trades` — the local ledger read (Batch 1 multi-account trades).
 *
 * Contract pinned here:
 * - absent filters → all the caller's rows (single repo call, no ownership leak);
 * - malformed id → 400; unknown/foreign id → 404 (strategy and account alike);
 * - `limit` defaults to 50 and is capped at 200;
 * - repo failure → 500 with the generic message (details only in logs).
 */

import request from "supertest";
import express, { Express } from "express";

const ACCOUNT_ID = "72c483bc-4123-47c4-95c9-64aa8df20914";
const STRATEGY_ID = "49401abd-f139-4136-bc9e-61fe0bb69118";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

jest.mock("../../src/interfaces/middleware/auth.middleware", () => ({
  authMiddleware: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: "u1", userLevel: "VERIFIED" };
    next();
  }),
  AuthenticatedRequest: jest.fn(),
}));

jest.mock(
  "../../src/infrastructure/adapters/repositories/trade-repository.adapter",
  () => ({
    tradeRepositoryAdapter: {
      getTradesFiltered: jest.fn(),
    },
  })
);

jest.mock(
  "../../src/infrastructure/adapters/repositories/strategy-repository.adapter",
  () => ({
    strategyRepositoryAdapter: {
      strategyExistsForUser: jest.fn(),
    },
  })
);

jest.mock(
  "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      getAccountWithSecret: jest.fn(),
    },
  })
);

import { createTradesRoutes } from "../../src/interfaces/http/trading/trades.routes";
import { GetTradesUseCase } from "../../src/core/trades/get-trades.use-case";
import { tradeRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/trade-repository.adapter";
import { strategyRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/strategy-repository.adapter";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";

const getTradesFiltered = tradeRepositoryAdapter.getTradesFiltered as jest.Mock;
const strategyExistsForUser =
  strategyRepositoryAdapter.strategyExistsForUser as jest.Mock;
const getAccountWithSecret = (
  exchangeAccountRepositoryAdapter as unknown as {
    getAccountWithSecret: jest.Mock;
  }
).getAccountWithSecret;

/**
 * The route no longer orchestrates adapters (review P1); the test wires the
 * use case exactly like `server/route-config.ts` does in production.
 */
function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/trades",
    createTradesRoutes(
      new GetTradesUseCase({
        trades: tradeRepositoryAdapter,
        checkers: {
          strategyExistsForUser: (strategyId, userId) =>
            strategyRepositoryAdapter.strategyExistsForUser(
              strategyId,
              userId
            ),
          accountExistsForUser: async (userId, accountId) =>
            (await exchangeAccountRepositoryAdapter.getAccountWithSecret(
              userId,
              accountId
            )) !== null,
        },
      })
    )
  );
  return app;
}

const ROW = {
  id: "t1",
  strategyId: STRATEGY_ID,
  strategyName: "My Grid",
  botId: "b1",
  exchangeAccountId: ACCOUNT_ID,
  orderId: "o1",
  symbol: "ETH",
  side: "BUY",
  quantity: 0.01,
  price: 2000,
  fee: null,
  pnl: null,
  status: "FILLED",
  executedAt: new Date("2026-10-12T00:00:00Z"),
};

describe("GET /api/trades", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTradesFiltered.mockResolvedValue([ROW]);
    strategyExistsForUser.mockResolvedValue(true);
    getAccountWithSecret.mockResolvedValue({ id: ACCOUNT_ID });
  });

  it("returns all caller rows when no filters are given", async () => {
    const res = await request(createApp()).get("/api/trades");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rows).toHaveLength(1);
    // NULL fee/pnl preserved — never coerced to 0 (F2).
    expect(res.body.data.rows[0].fee).toBeNull();
    expect(res.body.data.rows[0].pnl).toBeNull();
    expect(getTradesFiltered).toHaveBeenCalledWith("u1", { limit: 50 });
    // No ownership lookups when nothing to scope.
    expect(strategyExistsForUser).not.toHaveBeenCalled();
    expect(getAccountWithSecret).not.toHaveBeenCalled();
  });

  it("forwards both filters and a custom limit to the repo", async () => {
    const res = await request(createApp()).get(
      `/api/trades?strategyId=${STRATEGY_ID}&exchangeAccountId=${ACCOUNT_ID}&limit=25`
    );
    expect(res.status).toBe(200);
    expect(strategyExistsForUser).toHaveBeenCalledWith(STRATEGY_ID, "u1");
    expect(getAccountWithSecret).toHaveBeenCalledWith("u1", ACCOUNT_ID);
    expect(getTradesFiltered).toHaveBeenCalledWith("u1", {
      strategyId: STRATEGY_ID,
      exchangeAccountId: ACCOUNT_ID,
      limit: 25,
    });
  });

  it("caps the limit at 200 and falls back to 50 on garbage", async () => {
    await request(createApp()).get("/api/trades?limit=9999");
    expect(getTradesFiltered).toHaveBeenLastCalledWith("u1", { limit: 200 });

    await request(createApp()).get("/api/trades?limit=abc");
    expect(getTradesFiltered).toHaveBeenLastCalledWith("u1", { limit: 50 });
  });

  it("maps malformed ids to 400 and foreign ids to 404", async () => {
    const app = createApp();
    expect((await request(app).get("/api/trades?strategyId=nope")).status).toBe(
      400
    );
    expect(
      (await request(app).get("/api/trades?exchangeAccountId=nope")).status
    ).toBe(400);
    expect(strategyExistsForUser).not.toHaveBeenCalled();
    expect(getTradesFiltered).not.toHaveBeenCalled();

    strategyExistsForUser.mockResolvedValue(false);
    expect(
      (await request(app).get(`/api/trades?strategyId=${MISSING_ID}`)).status
    ).toBe(404);

    getAccountWithSecret.mockResolvedValue(null);
    expect(
      (await request(app).get(`/api/trades?exchangeAccountId=${MISSING_ID}`))
        .status
    ).toBe(404);
    expect(getTradesFiltered).not.toHaveBeenCalled();
  });

  it("surfaces a repo failure as 500 with a generic message", async () => {
    getTradesFiltered.mockRejectedValue(new Error("relation down"));
    const res = await request(createApp()).get("/api/trades");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "Failed to fetch trades",
    });
  });
});
