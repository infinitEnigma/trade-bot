/** @format */

/**
 * X4 end-to-end gate test (review item #4).
 *
 * Exercises the REAL HTTP chain — `requireWalletProof` middleware → real
 * `consumeProof` (real `ethers` signature verification over the server-built
 * challenge) → real `checkAccountWalletBinding` → handler — with ONLY the
 * infrastructure boundaries stubbed:
 *   - Redis (`redisService.setex` / `getDel`) — an in-memory map,
 *   - the wallet repository (`listWallets`),
 *   - the database `query` (bot lookup + account `meta` read).
 *
 * This is the complement to `bots.controller.test.ts`, which mocks the proof
 * decisions themselves; here the crypto + binding logic is genuinely exercised
 * so a regression in the middleware wiring cannot hide behind a success mock.
 */

import request from "supertest";
import express from "express";
import { ethers } from "ethers";

// In-memory Redis: only setex (issue) + getDel (atomic consume) are used by
// the real service on this path.
jest.mock("../../src/infrastructure/cache/redis.service", () => {
  const store = new Map<string, string>();
  return {
    redisService: {
      setex: jest.fn(async (key: string, _ttl: number, value: string) => {
        store.set(key, value);
        return { success: true };
      }),
      // Atomic get-and-delete, synchronously (models real Redis GETDEL).
      getDel: jest.fn(async (key: string) => {
        const value = store.get(key) ?? null;
        if (value !== null) store.delete(key);
        return { success: true, data: value };
      }),
      get: jest.fn(async (key: string) => ({
        success: true,
        data: store.get(key) ?? null,
      })),
      del: jest.fn(async (key: string) => ({
        success: true,
        data: store.delete(key) ? 1 : 0,
      })),
      getClient: jest.fn(),
    },
  };
});

// Wallet repo: the linked-wallet membership check reads this.
jest.mock(
  "../../src/infrastructure/adapters/repositories/wallet-repository.adapter",
  () => ({
    walletRepositoryAdapter: { listWallets: jest.fn() },
  })
);

// DB pool: `query` backs botBoundAccountId (bot lookup) and
// checkAccountWalletBinding (account meta read). Routed by SQL text.
jest.mock("../../src/database/pool", () => ({ query: jest.fn() }));

import {
  requireWalletProof,
  botBoundAccountId,
} from "../../src/interfaces/middleware/wallet-proof.middleware";
import { issueChallenge } from "../../src/core/wallet/wallet-proof.service";
import { walletRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/wallet-repository.adapter";
import { query } from "../../src/database/pool";

const USER_ID = "user-123";
const ACCOUNT_ID = "acct-1";
const BOT_ID = "bot-abc";
const wallet = ethers.Wallet.createRandom();

/** Route `query` by the SQL each caller issues (scoped by user — as in prod). */
function routeQuery(): void {
  (query as jest.Mock).mockImplementation(async (sql: string) => {
    if (/FROM bot_instances/i.test(sql)) {
      return { rows: [{ exchange_account_id: ACCOUNT_ID }] };
    }
    if (/FROM exchange_accounts/i.test(sql)) {
      // The account is bound to the linked wallet's address.
      return {
        rows: [
          {
            meta: {
              walletBinding: {
                address: wallet.address,
                verifiedAt: "2026-10-09T00:00:00.000Z",
                source: "venue",
              },
            },
          },
        ],
      };
    }
    return { rows: [] };
  });
}

/** Minimal app: auth stub → REAL requireWalletProof → handler. */
function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Stand in for authMiddleware: attach the authenticated user.
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = {
      userId: USER_ID,
      email: "test@example.com",
      userLevel: "VERIFIED",
      roles: [],
    };
    next();
  });
  app.post(
    "/api/bot/management/start",
    requireWalletProof("bot:start", {
      resolveAccountId: (userId, req) =>
        botBoundAccountId(
          userId,
          (req.body as { botId?: string }).botId as string
        ),
    }),
    (req: express.Request, res: express.Response) => {
      const verified = (
        req as unknown as { verifiedWalletProof?: { address: string } }
      ).verifiedWalletProof;
      res.status(200).json({ success: true, address: verified?.address });
    }
  );
  return app;
}

describe("X4 wallet-proof gate — end-to-end (real crypto + real middleware)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WALLET_PROOF_REQUIRED; // gate defaults ON
    (walletRepositoryAdapter.listWallets as jest.Mock).mockResolvedValue([
      { id: "w1", userId: USER_ID, chain: "evm", address: wallet.address },
    ]);
    routeQuery();
  });

  it("allows a start when a real signature over the stored challenge matches the bound wallet", async () => {
    const app = makeApp();

    // 1. Issue a real server-built challenge and sign it with the linked key.
    const challenge = await issueChallenge(USER_ID, "bot:start");
    const signature = await wallet.signMessage(challenge.message);

    // 2. Send the proof through the real middleware chain.
    const res = await request(app)
      .post("/api/bot/management/start")
      .send({
        botId: BOT_ID,
        walletProof: {
          nonce: challenge.nonce,
          address: wallet.address,
          signature,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.address).toBe(wallet.address);
  });

  it("403s when the proof is absent (PROOF_REQUIRED)", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/bot/management/start")
      .send({ botId: BOT_ID });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PROOF_REQUIRED");
  });

  it("403s a second (replayed) use of the same signature — atomic single-use", async () => {
    const app = makeApp();
    const challenge = await issueChallenge(USER_ID, "bot:start");
    const signature = await wallet.signMessage(challenge.message);
    const body = {
      botId: BOT_ID,
      walletProof: {
        nonce: challenge.nonce,
        address: wallet.address,
        signature,
      },
    };

    const first = await request(app)
      .post("/api/bot/management/start")
      .send(body);
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post("/api/bot/management/start")
      .send(body);
    expect(replay.status).toBe(403);
    expect(replay.body.code).toBe("CHALLENGE_NOT_FOUND");
  });

  it("403s (WALLET_BINDING_MISMATCH) when the signed wallet is linked but not the account's bound wallet", async () => {
    // Account is bound to a DIFFERENT (still linked) wallet than the signer.
    const bound = ethers.Wallet.createRandom();
    (walletRepositoryAdapter.listWallets as jest.Mock).mockResolvedValue([
      { id: "w1", userId: USER_ID, chain: "evm", address: wallet.address },
      { id: "w2", userId: USER_ID, chain: "evm", address: bound.address },
    ]);
    (query as jest.Mock).mockImplementation(async (sql: string) => {
      if (/FROM bot_instances/i.test(sql)) {
        return { rows: [{ exchange_account_id: ACCOUNT_ID }] };
      }
      return {
        rows: [
          {
            meta: {
              walletBinding: {
                address: bound.address,
                verifiedAt: "2026-10-09T00:00:00.000Z",
                source: "venue",
              },
            },
          },
        ],
      };
    });

    const app = makeApp();
    const challenge = await issueChallenge(USER_ID, "bot:start");
    const signature = await wallet.signMessage(challenge.message);

    const res = await request(app)
      .post("/api/bot/management/start")
      .send({
        botId: BOT_ID,
        walletProof: {
          nonce: challenge.nonce,
          address: wallet.address,
          signature,
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WALLET_BINDING_MISMATCH");
  });

  it("fails closed (WALLET_BINDING_MISSING, 403) when the bound bot has no exchange account", async () => {
    // botBoundAccountId resolves null (bot exists, unbound) → fail-closed.
    (query as jest.Mock).mockResolvedValue({
      rows: [{ exchange_account_id: null }],
    });
    const app = makeApp();
    const challenge = await issueChallenge(USER_ID, "bot:start");
    const signature = await wallet.signMessage(challenge.message);

    const res = await request(app)
      .post("/api/bot/management/start")
      .send({
        botId: BOT_ID,
        walletProof: {
          nonce: challenge.nonce,
          address: wallet.address,
          signature,
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WALLET_BINDING_MISSING");
  });
});

