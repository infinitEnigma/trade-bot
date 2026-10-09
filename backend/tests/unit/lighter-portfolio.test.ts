/** @format */

/**
 * Lighter portfolio reader — mapping/contract tests (P0 follow-up: the
 * venue-agnostic dashboard). Venue + sidecar + crypto + caches are mocked;
 * the assertions pin the exact shapes the frontend consumes.
 */

// Env before any module reads it (sidecar config is resolved lazily).
process.env.LIGHTER_SIDECAR_URL = "http://127.0.0.1:8790";

type PortfolioModule =
  typeof import("../../src/infrastructure/external/lighter/portfolio");

const ACCOUNT_ROW = {
  id: "acc-lighter-1",
  exchange: "lighter",
  status: "ACTIVE",
  environment: "testnet",
  accountRef: "404",
  credentialsEncrypted: "ENC",
};

const ENVELOPE = JSON.stringify({
  v: 3,
  kind: "lighter",
  accountIndex: 404,
  apiKeyIndex: 4,
  privateKey: "PK-NEVER-LOGGED",
});

const ACCOUNT_PAYLOAD = {
  accounts: [
    {
      account_index: 404,
      collateral: "9999.873308",
      total_asset_value: "9999.210358",
      assets: [
        { symbol: "ETH", balance: "3.00000000", locked_balance: "0.10000000" },
      ],
      positions: [
        {
          symbol: "ETH",
          sign: 1,
          position: "0.0100",
          avg_entry_price: "2751.93",
          unrealized_pnl: "-0.662950",
        },
        {
          symbol: "BTC",
          sign: -1,
          position: "0.0200",
          avg_entry_price: "100",
          unrealized_pnl: "-15",
        },
        {
          symbol: "SOL",
          sign: 1,
          position: "0.0000",
          avg_entry_price: "10",
          unrealized_pnl: "0",
        },
      ],
    },
  ],
};

const TRADES_PAYLOAD = {
  code: 200,
  trades: [
    {
      market_id: 4095,
      size: "0.0100",
      price: "2750.62",
      timestamp: 1790116529366,
      bid_account_id: 404,
      ask_account_id: 368,
    },
    {
      market_id: 4095,
      size: "0.0200",
      price: "2700.00",
      timestamp: 1790116509366,
      bid_account_id: 368,
      ask_account_id: 404,
    },
    {
      market_id: 4095,
      size: "0.0500",
      price: "2600.00",
      timestamp: 1790116400000,
      bid_account_id: 368,
      ask_account_id: 369,
    },
  ],
};

const BOOKS_PAYLOAD = {
  order_books: [{ market_id: 4095, symbol: "ETH" }],
};

describe("lighter portfolio reader", () => {
  let portfolio: PortfolioModule;
  let venueGet: jest.Mock;
  let sidecarPost: jest.Mock;
  let resolveAccount: jest.Mock;
  let decrypt: jest.Mock;
  let redisGet: jest.Mock;
  let redisSetex: jest.Mock;
  let memoryCacheGet: jest.Mock;
  let memoryCacheSet: jest.Mock;
  let replacePositions: jest.Mock;
  let replaceBalances: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    venueGet = jest.fn();
    sidecarPost = jest
      .fn()
      .mockResolvedValue({ data: { ok: true, token: "tok-abc" } });
    resolveAccount = jest.fn().mockResolvedValue(ACCOUNT_ROW);
    decrypt = jest.fn().mockResolvedValue(ENVELOPE);
    redisGet = jest.fn().mockResolvedValue({ success: false });
    redisSetex = jest.fn().mockResolvedValue({ success: true });
    memoryCacheGet = jest.fn().mockReturnValue(null);
    memoryCacheSet = jest.fn();
    replacePositions = jest.fn().mockResolvedValue(undefined);
    replaceBalances = jest.fn().mockResolvedValue(undefined);

    jest.doMock("axios", () => ({
      __esModule: true,
      isAxiosError: (error: unknown) =>
        Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
      // One shared client shape: the module only posts to the sidecar and
      // gets from the venue, so a single object serves both.
      default: {
        create: jest.fn(() => ({ get: venueGet, post: sidecarPost })),
      },
    }));
    jest.doMock(
      "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
      () => ({
        exchangeAccountRepositoryAdapter: {
          getAccountWithSecret: resolveAccount,
        },
      })
    );
    jest.doMock("../../src/infrastructure/security/encryption.service", () => ({
      encryptionService: { decryptWithVersion: decrypt },
    }));
    jest.doMock("../../src/infrastructure/cache/redis.service", () => ({
      redisService: { get: redisGet, setex: redisSetex },
    }));
    jest.doMock("../../src/infrastructure/external/kodiak-cache", () => ({
      kodiakCache: {
        get: memoryCacheGet,
        set: memoryCacheSet,
        delete: jest.fn(),
      },
    }));
    jest.doMock(
      "../../src/infrastructure/adapters/repositories/exchange-snapshot.adapter",
      () => ({
        exchangeSnapshotAdapter: { replacePositions, replaceBalances },
      })
    );
    jest.doMock("../../src/core/logging/context-aware-logger.service", () => ({
      integrationLogger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    portfolio = require("../../src/infrastructure/external/lighter/portfolio");
  });

  describe("resolveLighterAccount", () => {
    it("resolves an ACTIVE lighter row into envelope credentials", async () => {
      const resolved = await portfolio.resolveLighterAccount(
        "u1",
        "acc-lighter-1"
      );
      expect(resolved).toEqual({
        id: "acc-lighter-1",
        accountRef: "404",
        credentials: {
          accountIndex: 404,
          apiKeyIndex: 4,
          privateKey: "PK-NEVER-LOGGED",
          environment: "testnet",
        },
      });
      expect(resolveAccount).toHaveBeenCalledWith("u1", "acc-lighter-1");
    });

    it("returns null for a non-lighter or inactive row", async () => {
      resolveAccount.mockResolvedValueOnce({
        ...ACCOUNT_ROW,
        exchange: "kodiak",
      });
      expect(
        await portfolio.resolveLighterAccount("u1", "acc-lighter-1")
      ).toBeNull();

      resolveAccount.mockResolvedValueOnce({
        ...ACCOUNT_ROW,
        status: "REVOKED",
      });
      expect(
        await portfolio.resolveLighterAccount("u1", "acc-lighter-1")
      ).toBeNull();
    });

    it("returns null when the envelope is not a lighter one", async () => {
      decrypt.mockResolvedValueOnce(
        JSON.stringify({ v: 3, kind: "kodiak", accountId: "x" })
      );
      expect(
        await portfolio.resolveLighterAccount("u1", "acc-lighter-1")
      ).toBeNull();
    });
  });

  describe("getLighterBalance", () => {
    it("maps collateral + assets to the KodiakAccountInfo shape and snapshots", async () => {
      venueGet.mockResolvedValue({ data: ACCOUNT_PAYLOAD });

      const result = await portfolio.getLighterBalance("u1", "acc-lighter-1");

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        totalBalance: "9999.873308",
        totalPnl24H: "0",
        totalPnl30D: "0",
        totalPnlAll: "0",
        tradingVolume24H: "0",
        accountType: "LIGHTER",
        balances: [
          {
            asset: "ETH",
            free: "3.00000000",
            locked: "0.10000000",
            freeze: "0",
            withdrawing: "0",
            ipoable: "0",
            btcValuation: "0",
          },
        ],
      });

      // Authenticated read with the sidecar token.
      expect(sidecarPost).toHaveBeenCalledTimes(1);
      expect(sidecarPost.mock.calls[0][0]).toBe("/v1/auth-token");
      const [path, options] = venueGet.mock.calls[0];
      expect(path).toBe("/api/v1/account");
      expect(options.headers.Authorization).toBe("tok-abc");
      // The private key travels to the loopback sidecar only — never the venue.
      expect(sidecarPost.mock.calls[0][1].private_key).toBe("PK-NEVER-LOGGED");
      expect(JSON.stringify(venueGet.mock.calls)).not.toContain(
        "PK-NEVER-LOGGED"
      );

      // Redis cache + C3b snapshot.
      expect(redisSetex).toHaveBeenCalledWith(
        "lighter:balance:u1:acc-lighter-1",
        300,
        expect.any(String)
      );
      expect(replaceBalances).toHaveBeenCalledWith("acc-lighter-1", [
        { asset: "ETH", holding: 3, frozen: 0.1 },
      ]);
    });

    it("serves the Redis cache without touching the venue", async () => {
      const cached = { success: true, data: { totalBalance: "1" } };
      redisGet.mockResolvedValue({
        success: true,
        data: JSON.stringify(cached),
      });

      const result = await portfolio.getLighterBalance("u1", "acc-lighter-1");

      expect(result).toEqual(cached);
      expect(venueGet).not.toHaveBeenCalled();
      expect(sidecarPost).not.toHaveBeenCalled();
    });

    it("fails soft when the sidecar is unreachable", async () => {
      sidecarPost.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await portfolio.getLighterBalance("u1", "acc-lighter-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("sidecar unreachable");
      expect(result.error).not.toContain("PK-NEVER-LOGGED");
    });
  });

  describe("getLighterPositions", () => {
    it("maps sign/magnitude rows to the dashboard shape with derived mark", async () => {
      venueGet.mockResolvedValue({ data: ACCOUNT_PAYLOAD });

      const result = await portfolio.getLighterPositions("u1", "acc-lighter-1");

      expect(result.success).toBe(true);
      expect(result.data?.rows).toEqual([
        {
          symbol: "PERP_ETH_USDC",
          position_qty: "0.01",
          average_open_price: "2751.93",
          // mark = entry + pnl·sign/|qty| = 2751.93 − 0.66295/0.01
          mark_price: "2685.635",
          unsettled_pnl: "-0.66295",
          side: "LONG",
        },
        {
          symbol: "PERP_BTC_USDC",
          position_qty: "-0.02",
          average_open_price: "100",
          // short: mark = 100 + (−15·−1)/0.02 = 850
          mark_price: "850",
          unsettled_pnl: "-15",
          side: "SHORT",
        },
      ]);

      expect(memoryCacheSet).toHaveBeenCalledWith(
        "lighter:positions:u1:acc-lighter-1",
        expect.objectContaining({ success: true }),
        30000
      );
      expect(replacePositions).toHaveBeenCalledWith("acc-lighter-1", [
        {
          symbol: "PERP_ETH_USDC",
          positionQty: 0.01,
          entryPrice: 2751.93,
          markPrice: 2685.635,
          unrealizedPnl: -0.66295,
        },
        {
          symbol: "PERP_BTC_USDC",
          positionQty: -0.02,
          entryPrice: 100,
          markPrice: 850,
          unrealizedPnl: -15,
        },
      ]);
    });

    it("caches the auth token across reads (one sidecar call)", async () => {
      venueGet.mockResolvedValue({ data: ACCOUNT_PAYLOAD });

      await portfolio.getLighterPositions("u1", "acc-lighter-1");
      await portfolio.getLighterBalance("u1", "acc-lighter-1");

      expect(sidecarPost).toHaveBeenCalledTimes(1);
      expect(venueGet).toHaveBeenCalledTimes(2);
    });
  });

  describe("getLighterTrades", () => {
    it("maps fills by my side and resolves symbols via orderBooks", async () => {
      venueGet.mockImplementation((path: string) => {
        if (path === "/api/v1/trades") return { data: TRADES_PAYLOAD };
        if (path === "/api/v1/orderBooks") return { data: BOOKS_PAYLOAD };
        throw new Error(`unexpected path ${path}`);
      });

      const result = await portfolio.getLighterTrades(
        "u1",
        50,
        "acc-lighter-1"
      );

      expect(result.success).toBe(true);
      // The third row belongs to other accounts — dropped even if the venue
      // filter ever loosens.
      expect(result.data?.rows).toEqual([
        {
          symbol: "PERP_ETH_USDC",
          side: "LONG",
          closed_position_qty: "0.01",
          avg_close_price: "2750.62",
          avg_open_price: "2750.62",
          realized_pnl: "0",
          close_timestamp: 1790116529366,
          open_timestamp: 1790116529366,
        },
        {
          symbol: "PERP_ETH_USDC",
          side: "SHORT",
          closed_position_qty: "0.02",
          avg_close_price: "2700",
          avg_open_price: "2700",
          realized_pnl: "0",
          close_timestamp: 1790116509366,
          open_timestamp: 1790116509366,
        },
      ]);

      // The venue requires sort_by + limit — pin the params.
      const [path, options] = venueGet.mock.calls[0];
      expect(path).toBe("/api/v1/trades");
      expect(options.params).toEqual({
        account_index: 404,
        sort_by: "timestamp",
        limit: 50,
      });
    });

    it("clamps the limit into the venue's 1..100 window", async () => {
      venueGet.mockImplementation((path: string) => {
        if (path === "/api/v1/trades") return { data: { trades: [] } };
        if (path === "/api/v1/orderBooks") return { data: BOOKS_PAYLOAD };
        throw new Error(`unexpected path ${path}`);
      });

      await portfolio.getLighterTrades("u1", 5000, "acc-lighter-1");

      expect(venueGet.mock.calls[0][1].params.limit).toBe(100);
    });
  });

  describe("getLighterPnl", () => {
    const PNL_PAYLOAD = {
      code: 200,
      resolution: "1h",
      pnl: [
        {
          timestamp: 1791462000,
          trade_pnl: 112.5,
          inflow: 0,
          outflow: 0,
          pool_pnl: 0,
          pool_inflow: 0,
          pool_outflow: 0,
          pool_total_shares: 0,
          spot_inflow: 0,
          spot_outflow: 0,
          staked_lit: 0,
          staking_inflow: 0,
          staking_outflow: 0,
          staking_pnl: 0,
          trade_spot_pnl: 0,
          volume: 540.25,
        },
        {
          timestamp: 1791465600,
          trade_pnl: "14.75",
          inflow: 0,
          outflow: 0,
          pool_pnl: 0,
          pool_inflow: 0,
          pool_outflow: 0,
          pool_total_shares: 0,
          spot_inflow: 0,
          spot_outflow: 0,
          staked_lit: 0,
          staking_inflow: 0,
          staking_outflow: 0,
          staking_pnl: 0,
          trade_spot_pnl: 0,
          volume: "108.26",
        },
      ],
    };

    it("maps the venue trade_pnl series to points (string-safe)", async () => {
      venueGet.mockImplementation((path: string) => {
        if (path === "/api/v1/pnl") return { data: PNL_PAYLOAD };
        throw new Error(`unexpected path ${path}`);
      });

      const result = await portfolio.getLighterPnl("u1", 168, "acc-lighter-1");

      expect(result.success).toBe(true);
      expect(result.data?.points).toEqual([
        { timestamp: 1791462000, tradePnl: 112.5, volume: 540.25 },
        { timestamp: 1791465600, tradePnl: 14.75, volume: 108.26 },
      ]);

      // Venue contract: by/index/value scoping, hourly resolution,
      // transfers excluded so deposits never read as profit.
      const [path, options] = venueGet.mock.calls[0];
      expect(path).toBe("/api/v1/pnl");
      expect(options.params).toEqual({
        by: "index",
        value: "404",
        resolution: "1h",
        start_timestamp: expect.any(Number),
        end_timestamp: expect.any(Number),
        count_back: 168,
        ignore_transfers: true,
      });
    });

    it("answers no-credentials closed (never throws the read)", async () => {
      resolveAccount.mockResolvedValueOnce({
        ...ACCOUNT_ROW,
        status: "REVOKED",
      });

      const result = await portfolio.getLighterPnl("u1", 168, "acc-lighter-1");

      expect(result).toEqual({
        success: false,
        error: "No verified Lighter credentials found",
      });
    });
  });
});
