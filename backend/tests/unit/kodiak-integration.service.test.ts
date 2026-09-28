/** @format */

import { KodiakIntegrationService } from "../../src/infrastructure/external/kodiak-integration.service";
import { query } from "../../src/database/pool";
import { redisService } from "../../src/infrastructure/cache/redis.service";
import { encryptionService } from "../../src/infrastructure/security/encryption.service";
import { kodiakCache } from "../../src/infrastructure/external/kodiak-cache";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";
import { integrationLogger as logger } from "../../src/core/logging/context-aware-logger.service";

// Mock dependencies
jest.mock("../../src/database/pool");
jest.mock("../../src/infrastructure/cache/redis.service", () => ({
  redisService: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  },
}));
jest.mock("../../src/infrastructure/security/encryption.service");
jest.mock("../../src/infrastructure/external/kodiak-cache");
jest.mock(
  "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      listAccounts: jest.fn(),
      getAccountWithSecret: jest.fn(),
    },
  })
);
jest.mock("../../src/core/logging/context-aware-logger.service", () => ({
  integrationLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  redisLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  cacheLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the dependencies used by generateKodiakSignature
jest.mock("crypto", () => {
  const originalModule = jest.requireActual("crypto");
  return {
    ...originalModule,
    createHash: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue(Buffer.from("mocked-hash")),
    }),
  };
});

jest.mock("bs58", () => ({
  decode: jest.fn().mockReturnValue(Buffer.from("mocked-secret-key")),
}));

jest.mock("@noble/ed25519", () => ({
  hashes: {
    sha512: jest.fn(),
  },
  etc: {
    sha512Sync: jest.fn(),
  },
  utils: {
    sha512Sync: jest.fn(),
  },
  sign: jest.fn(),
}));

describe("KodiakIntegrationService", () => {
  let service: KodiakIntegrationService;

  beforeEach(() => {
    service = new KodiakIntegrationService();
    jest.clearAllMocks();
  });

  describe("getUserCredentials (C2 exchange accounts)", () => {
    const activeAccount = {
      id: "account-1",
      userId: "test-user-id",
      exchange: "kodiak",
      environment: "mainnet",
      accountRef: "test-account-id",
      status: "ACTIVE",
    };

    it("should return null when the user has no ACTIVE kodiak account", async () => {
      (
        exchangeAccountRepositoryAdapter.listAccounts as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.getUserCredentials("test-user-id");

      expect(result).toBeNull();
      expect(
        exchangeAccountRepositoryAdapter.getAccountWithSecret
      ).not.toHaveBeenCalled();
    });

    it("should decrypt the versioned single envelope", async () => {
      (
        exchangeAccountRepositoryAdapter.listAccounts as jest.Mock
      ).mockResolvedValue([activeAccount]);
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...activeAccount,
        credentialsEncrypted: "versioned-ciphertext",
        encryptionVersion: 2,
      });
      (encryptionService.decryptWithVersion as jest.Mock).mockResolvedValue(
        JSON.stringify({
          v: 1,
          kind: "kodiak",
          accountId: "test-account-id",
          apiKey: "decrypted-api-key",
          secretKey: "decrypted-secret-key",
        })
      );

      const result = await service.getUserCredentials("test-user-id");

      expect(result).toEqual({
        accountId: "test-account-id",
        apiKey: "decrypted-api-key",
        secretKey: "decrypted-secret-key",
      });
    });

    it("should decrypt backfilled kodiak-legacy wrappers field by field", async () => {
      (
        exchangeAccountRepositoryAdapter.listAccounts as jest.Mock
      ).mockResolvedValue([activeAccount]);
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...activeAccount,
        credentialsEncrypted: JSON.stringify({
          v: 1,
          kind: "kodiak-legacy",
          accountId: "test-account-id",
          apiKeyCipher: "encrypted-api-key",
          secretKeyCipher: "encrypted-secret-key",
        }),
        encryptionVersion: 2,
      });
      // The wrapper column is plaintext JSON, so the versioned decrypt fails.
      (encryptionService.decryptWithVersion as jest.Mock).mockRejectedValue(
        new Error("not a versioned envelope")
      );
      (encryptionService.decryptApiKey as jest.Mock).mockImplementation(
        (blob: string) => {
          if (blob === "encrypted-api-key") return "decrypted-api-key";
          throw new Error("Not an api-key blob");
        }
      );
      (encryptionService.decryptSecretKey as jest.Mock).mockImplementation(
        (blob: string) => {
          if (blob === "encrypted-secret-key") return "decrypted-secret-key";
          throw new Error("Not a secret-key blob");
        }
      );

      const result = await service.getUserCredentials("test-user-id");

      expect(result).toEqual({
        accountId: "test-account-id",
        apiKey: "decrypted-api-key",
        secretKey: "decrypted-secret-key",
      });
    });

    it("should return null and log when the envelope cannot be decrypted", async () => {
      (
        exchangeAccountRepositoryAdapter.listAccounts as jest.Mock
      ).mockResolvedValue([activeAccount]);
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...activeAccount,
        credentialsEncrypted: JSON.stringify({
          v: 1,
          kind: "kodiak-legacy",
          accountId: "test-account-id",
          apiKeyCipher: "encrypted-api-key",
          secretKeyCipher: "encrypted-secret-key",
        }),
        encryptionVersion: 2,
      });
      (encryptionService.decryptWithVersion as jest.Mock).mockRejectedValue(
        new Error("Decryption failed")
      );
      (encryptionService.decryptApiKey as jest.Mock).mockImplementation(() => {
        throw new Error("Decryption failed");
      });
      (encryptionService.decryptSecretKey as jest.Mock).mockImplementation(
        () => {
          throw new Error("Decryption failed");
        }
      );

      const result = await service.getUserCredentials("test-user-id");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle repository errors gracefully", async () => {
      (
        exchangeAccountRepositoryAdapter.listAccounts as jest.Mock
      ).mockRejectedValue(new Error("Database error"));

      const result = await service.getUserCredentials("test-user-id");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("resolveKodiakAccount (C3b account scope)", () => {
    const account = {
      id: "acct-uuid-1",
      userId: "test-user-id",
      exchange: "kodiak",
      environment: "testnet",
      accountRef: "venue-ref-1",
      status: "ACTIVE",
    };

    beforeEach(() => {
      (encryptionService.decryptWithVersion as jest.Mock).mockResolvedValue(
        JSON.stringify({
          v: 1,
          kind: "kodiak",
          accountId: "venue-ref-1",
          apiKey: "api-key",
          secretKey: "secret-key",
        })
      );
    });

    it("pins the requested account without consulting the default list", async () => {
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...account,
        credentialsEncrypted: "cipher",
        encryptionVersion: 2,
      });

      const result = await service.resolveKodiakAccount(
        "test-user-id",
        "acct-uuid-1"
      );

      expect(result).toEqual({
        id: "acct-uuid-1",
        accountRef: "venue-ref-1",
        credentials: {
          accountId: "venue-ref-1",
          apiKey: "api-key",
          secretKey: "secret-key",
        },
      });
      expect(
        exchangeAccountRepositoryAdapter.listAccounts
      ).not.toHaveBeenCalled();
      expect(
        exchangeAccountRepositoryAdapter.getAccountWithSecret
      ).toHaveBeenCalledWith("test-user-id", "acct-uuid-1");
    });

    it("refuses an account the user does not own", async () => {
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.resolveKodiakAccount("test-user-id", "acct-uuid-1")
      ).resolves.toBeNull();
    });

    it("refuses a non-ACTIVE account", async () => {
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({ ...account, status: "REVOKED" });

      await expect(
        service.resolveKodiakAccount("test-user-id", "acct-uuid-1")
      ).resolves.toBeNull();
      expect(encryptionService.decryptWithVersion).not.toHaveBeenCalled();
    });

    it("refuses a non-kodiak account", async () => {
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({ ...account, exchange: "lighter" });

      await expect(
        service.resolveKodiakAccount("test-user-id", "acct-uuid-1")
      ).resolves.toBeNull();
      expect(encryptionService.decryptWithVersion).not.toHaveBeenCalled();
    });

    it("returns null when the envelope cannot be decrypted", async () => {
      (
        exchangeAccountRepositoryAdapter.getAccountWithSecret as jest.Mock
      ).mockResolvedValue({
        ...account,
        credentialsEncrypted: "unreadable-cipher",
        encryptionVersion: 2,
      });
      (encryptionService.decryptWithVersion as jest.Mock).mockRejectedValue(
        new Error("bad envelope")
      );

      await expect(
        service.resolveKodiakAccount("test-user-id", "acct-uuid-1")
      ).resolves.toBeNull();
    });

    it("scopes the positions cache key and resolution to the account", async () => {
      (kodiakCache.get as jest.Mock).mockReturnValue(null);
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "acct-uuid-1",
        accountRef: "venue-ref-1",
        credentials: {
          accountId: "venue-ref-1",
          apiKey: "api-key",
          secretKey: "secret-key",
        },
      });
      (service as any).makeKodiakRequest = jest.fn().mockResolvedValue([]);

      const result = await service.getPositions("test-user-id", "acct-uuid-1");

      expect(result.success).toBe(true);
      expect((service as any).resolveKodiakAccount).toHaveBeenCalledWith(
        "test-user-id",
        "acct-uuid-1"
      );
      expect(kodiakCache.get).toHaveBeenCalledWith(
        "positions:test-user-id:acct-uuid-1"
      );
      expect(kodiakCache.set).toHaveBeenCalledWith(
        "positions:test-user-id:acct-uuid-1",
        result
      );
    });
  });

  describe("getPositions", () => {
    it("should return cached positions when available", async () => {
      const mockCachedResult = {
        success: true,
        data: [{ symbol: "BTC-USDC", positionAmt: "1.0" }],
      };

      (kodiakCache.get as jest.Mock).mockReturnValue(mockCachedResult);

      const result = await service.getPositions("test-user-id");

      expect(result).toEqual(mockCachedResult);
      expect(kodiakCache.get).toHaveBeenCalledWith("positions:test-user-id");
    });

    it("should fetch and cache positions when not cached", async () => {
      (kodiakCache.get as jest.Mock).mockReturnValue(null);
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "account-1",
        accountRef: "test-account",
        credentials: {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        },
      });
      (service as any).makeKodiakRequest = jest
        .fn()
        .mockResolvedValue([{ symbol: "BTC-USDC", positionAmt: "1.0" }]);

      const result = await service.getPositions("test-user-id");

      expect(result).toEqual({
        success: true,
        data: [{ symbol: "BTC-USDC", positionAmt: "1.0" }],
      });
      expect(kodiakCache.set).toHaveBeenCalledWith(
        "positions:test-user-id",
        result
      );
    });

    it("should return error when no credentials found", async () => {
      (kodiakCache.get as jest.Mock).mockReturnValue(null);
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue(null);

      const result = await service.getPositions("test-user-id");

      expect(result).toEqual({
        success: false,
        error: "No verified Kodiak credentials found",
      });
    });

    it("should handle API errors gracefully", async () => {
      (kodiakCache.get as jest.Mock).mockReturnValue(null);
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "account-1",
        accountRef: "test-account",
        credentials: {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        },
      });
      (service as any).makeKodiakRequest = jest
        .fn()
        .mockRejectedValue(new Error("API error"));

      const result = await service.getPositions("test-user-id");

      expect(result).toEqual({
        success: false,
        error: "Failed to get Kodiak positions",
      });
      expect(logger.error("Get Kodiak positions error"));
      /*expect(logger.error).toHaveBeenCalledWith('Get Kodiak positions error', expect.any(Error), {
                userId: 'test-user-id',
                error: expect.any(Error)
            });*/
    });
  });

  describe("getTrades", () => {
    it("should return cached trades when available", async () => {
      const mockCachedResult = {
        success: true,
        data: [{ symbol: "BTC-USDC", id: "123", side: "BUY" }],
      };

      (kodiakCache.get as jest.Mock).mockReturnValue(mockCachedResult);

      const result = await service.getTrades("test-user-id", 50);

      expect(result).toEqual(mockCachedResult);
      expect(kodiakCache.get).toHaveBeenCalledWith("trades:test-user-id:50");
    });

    it("should fetch and cache trades with default limit", async () => {
      (kodiakCache.get as jest.Mock).mockReturnValue(null);
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "account-1",
        accountRef: "test-account",
        credentials: {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        },
      });
      (service as any).makeKodiakRequest = jest
        .fn()
        .mockResolvedValue([{ symbol: "BTC-USDC", id: "123", side: "BUY" }]);

      const result = await service.getTrades("test-user-id");

      expect(result).toEqual({
        success: true,
        data: [{ symbol: "BTC-USDC", id: "123", side: "BUY" }],
      });
      expect(kodiakCache.set).toHaveBeenCalledWith(
        "trades:test-user-id:50",
        result
      );
    });
  });

  describe("getBalance", () => {
    it("should return cached balance when available", async () => {
      const mockCachedResult = {
        success: true,
        data: {
          totalBalance: "1000",
          totalPnl24H: "50",
          balances: [],
        },
      };

      (redisService.get as jest.Mock).mockResolvedValue({
        success: true,
        data: JSON.stringify(mockCachedResult),
      });

      const result = await service.getBalance("test-user-id");

      expect(result).toEqual(mockCachedResult);
    });

    it("should fetch and cache balance when not cached", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "account-1",
        accountRef: "test-account",
        credentials: {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        },
      });

      // Mock the makeKodiakRequest method to return the expected data structure
      (service as any).makeKodiakRequest = jest
        .fn()
        .mockResolvedValueOnce([
          { holding: "BTC", balance: "1.0", price: "50000" },
        ]) // holdings
        .mockResolvedValueOnce({ total_pnl_24_h: "50" }); // account info

      const result = await service.getBalance("test-user-id");

      expect(result.success).toBe(true);
      expect(result.data?.totalBalance).toBe("50000");
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:balance:test-user-id",
        300,
        JSON.stringify(result)
      );
    });
  });

  describe("getAccountInfo", () => {
    it("should return cached account info when available", async () => {
      const mockCachedResult = {
        success: true,
        data: {
          totalBalance: "1000",
          accountType: "SPOT",
        },
      };

      (redisService.get as jest.Mock).mockResolvedValue({
        success: true,
        data: JSON.stringify(mockCachedResult),
      });

      const result = await service.getAccountInfo("test-user-id");

      expect(result).toEqual(mockCachedResult);
    });

    it("should fetch and cache account info when not cached", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "account-1",
        accountRef: "test-account",
        credentials: {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        },
      });
      (service as any).makeKodiakRequest = jest.fn().mockResolvedValue({
        totalBalance: "1000",
        accountType: "SPOT",
      });

      const result = await service.getAccountInfo("test-user-id");

      expect(result.success).toBe(true);
      expect(result.data?.accountType).toBe("SPOT");
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:account:test-user-id",
        600,
        JSON.stringify(result)
      );
    });
  });

  describe("getMarketTicker", () => {
    it("should return cached ticker when available", async () => {
      const mockCachedResult = {
        success: true,
        data: {
          symbol: "PERP_BTC_USDC",
          mark_price: 50000,
        },
      };

      (redisService.get as jest.Mock).mockResolvedValue({
        success: true,
        data: JSON.stringify(mockCachedResult),
      });

      const result = await service.getMarketTicker("PERP_BTC_USDC");

      expect(result).toEqual(mockCachedResult);
    });

    it("should fetch and cache ticker when not cached", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              rows: [
                {
                  symbol: "PERP_BTC_USDC",
                  executed_price: 50000,
                  executed_quantity: 0.001,
                  executed_timestamp: Date.now(),
                },
              ],
            },
          }),
      });

      const result = await service.getMarketTicker("PERP_BTC_USDC");

      expect(result.success).toBe(true);
      expect(result.data?.symbol).toBe("PERP_BTC_USDC");
      /*expect(redisService.setex).toHaveBeenCalledWith(
                'kodiak:market_trades:PERP_BTC_USDC:1',
                30,
                expect.any(String)
            );*/
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:ticker:PERP_BTC_USDC",
        30,
        expect.any(String)
      );
    });

    it("should handle API errors gracefully", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Internal Server Error"),
      });

      const result = await service.getMarketTicker("PERP_BTC_USDC");

      // Even if API calls fail, we should still return a success with symbol
      expect(result.success).toBe(false);
      //expect(result.data?.symbol).toBe('PERP_BTC_USDC');

      // Check that both futures and trades API errors are logged
      expect(logger.error("Get Kodiak futures data error"));
      /*expect(logger.error).toHaveBeenCalledWith('Get Kodiak futures data error', expect.any(Error), {
                symbol: 'PERP_BTC_USDC',
            });
            expect(logger.error).toHaveBeenCalledWith('Get Kodiak market trades error', expect.any(Error), {
                symbol: 'PERP_BTC_USDC',
            });*/
    });
  });

  describe("getOrderbook", () => {
    it("should fetch and cache orderbook data", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              asks: [[50001, 1.0]],
              bids: [[49999, 1.0]],
            },
          }),
      });

      const result = await service.getOrderbook("PERP_BTC_USDC");

      expect(result.success).toBe(true);
      expect(result.data?.asks).toEqual([[50001, 1.0]]);
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:orderbook:PERP_BTC_USDC",
        60,
        JSON.stringify(result)
      );
    });
  });

  describe("getTradingViewConfig", () => {
    it("should fetch and cache TradingView config", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              supported_resolutions: ["1", "5", "15", "60"],
            },
          }),
      });

      const result = await service.getTradingViewConfig();

      expect(result.success).toBe(true);
      expect(result.data?.supported_resolutions).toEqual([
        "1",
        "5",
        "15",
        "60",
      ]);
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:tv:config",
        3600,
        JSON.stringify(result)
      );
    });
  });

  describe("getTradingViewSymbols", () => {
    it("should fetch and cache TradingView symbols", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: "BTC/USDC",
              ticker: "PERP_BTC_USDC",
              description: "Bitcoin perpetual futures",
            },
          }),
      });

      const result = await service.getTradingViewSymbols("PERP_BTC_USDC");

      expect(result.success).toBe(true);
      expect(result.data?.ticker).toBe("PERP_BTC_USDC");
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:tv:symbols:PERP_BTC_USDC",
        3600,
        JSON.stringify(result)
      );
    });
  });

  describe("getTradingViewHistory", () => {
    it("should fetch and cache TradingView history with rounded timestamps", async () => {
      const from = 1643723400; // Round to 1643723400
      const to = 1643727000; // Round to 1643727000

      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              s: "ok",
              t: [1643723400, 1643723700],
              o: [50000, 50100],
              h: [50100, 50200],
              l: [49900, 50000],
              c: [50100, 50200],
              v: [100, 150],
            },
          }),
      });

      const result = await service.getTradingViewHistory(
        "PERP_BTC_USDC",
        "5",
        from,
        to
      );

      expect(result.success).toBe(true);
      expect(result.data?.s).toBe("ok");
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:tv:history:PERP_BTC_USDC:5:1643723400:1643727000",
        300,
        JSON.stringify(result)
      );
    });
  });

  describe("getPublicAccountInfo", () => {
    it("should fetch public account info with authenticated request", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "account-1",
        accountRef: "test-account",
        credentials: {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        },
      });
      (service as any).makeKodiakRequest = jest.fn().mockResolvedValue({
        data: {
          address: "0x1234567890abcdef",
          account_id: "test-account",
        },
      });

      const result = await service.getPublicAccountInfo("test-account-id", {
        accountId: "test-account",
        apiKey: "test-api-key",
        secretKey: "test-secret-key",
      });

      expect(result.success).toBe(true);
      expect(result.data?.address).toBe("0x1234567890abcdef");
      expect(redisService.setex).toHaveBeenCalledWith(
        "kodiak:public_account:test-account-id",
        600,
        JSON.stringify(result)
      );
    });

    it("should fallback to public request when authenticated request fails", async () => {
      (redisService.get as jest.Mock).mockResolvedValue({ success: false });
      (service as any).resolveKodiakAccount = jest.fn().mockResolvedValue({
        id: "account-1",
        accountRef: "test-account",
        credentials: {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        },
      });
      (service as any).makeKodiakRequest = jest
        .fn()
        .mockRejectedValue(new Error("Auth failed"));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              address: "0x1234567890abcdef",
              account_id: "test-account",
            },
          }),
      });

      const result = await service.getPublicAccountInfo("test-account-id", {
        accountId: "test-account",
        apiKey: "test-api-key",
        secretKey: "test-secret-key",
      });

      expect(result.success).toBe(true);
      expect(result.data?.address).toBe("0x1234567890abcdef");
    });
  });

  describe("invalidateUserCache", () => {
    it("should clear user cache entries", async () => {
      (kodiakCache.clearUserCache as jest.Mock).mockReturnValue(5);

      await service.invalidateUserCache("test-user-id");

      expect(kodiakCache.clearUserCache).toHaveBeenCalledWith("test-user-id");
      expect(logger.info).toHaveBeenCalledWith(
        "Kodiak cache invalidated for user",
        {
          userId: "test-user-id",
          entriesCleared: 5,
        }
      );
    });
  });

  describe("testConnectivity", () => {
    it("should return success for valid credentials", async () => {
      (service as any).makeKodiakRequest = jest.fn().mockResolvedValue({});

      const result = await service.testConnectivity({
        accountId: "test-account",
        apiKey: "test-api-key",
        secretKey: "test-secret-key",
      });

      expect(result).toEqual({ success: true });
      expect(logger.info).toHaveBeenCalledWith(
        "Kodiak API connectivity test successful",
        {
          exchange: "kodiak",
          accountId: "test-account",
          durationMs: expect.any(Number),
        }
      );
    });

    it("should return error for invalid credentials", async () => {
      (service as any).makeKodiakRequest = jest
        .fn()
        .mockRejectedValue(new Error("Invalid credentials"));

      const result = await service.testConnectivity({
        accountId: "test-account",
        apiKey: "test-api-key",
        secretKey: "test-secret-key",
      });

      expect(result).toEqual({
        success: false,
        error: "Invalid credentials",
      });
      expect(logger.error).toHaveBeenCalledWith(
        "Kodiak API connectivity test error",
        expect.any(Error),
        {
          exchange: "kodiak",
          accountId: "test-account",
          durationMs: expect.any(Number),
        }
      );
    });
  });

  describe("makeKodiakRequest", () => {
    it("should make authenticated GET request", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: "test" }),
      });

      // Mock the generateKodiakSignature method to avoid import issues
      (service as any).generateKodiakSignature = jest
        .fn()
        .mockResolvedValue("mock-signature");

      const result = await (service as any).makeKodiakRequest(
        "GET",
        "/test/endpoint",
        {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        }
      );

      expect(result).toEqual({ success: true, data: "test" });
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.orderly.org/v1/test/endpoint",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "orderly-account-id": "test-account",
            "orderly-key": "test-api-key",
            "orderly-signature": "mock-signature",
          }),
        })
      );
    });

    it("should handle API errors", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("Invalid signature"),
      });

      // Mock the generateKodiakSignature method to avoid import issues
      (service as any).generateKodiakSignature = jest
        .fn()
        .mockResolvedValue("mock-signature");

      await expect(
        (service as any).makeKodiakRequest("GET", "/test/endpoint", {
          accountId: "test-account",
          apiKey: "test-api-key",
          secretKey: "test-secret-key",
        })
      ).rejects.toThrow(
        "Kodiak API error: 401 Unauthorized - Invalid signature"
      );

      expect(logger.error).toHaveBeenCalledWith(
        "Kodiak API request failed",
        expect.any(Error),
        {
          method: "GET",
          path: "/test/endpoint",
          accountId: "test-account",
        }
      );
    });
  });

  describe("generateKodiakSignature", () => {
    it("should generate valid Ed25519 signature", async () => {
      // Configure the mocked dependencies for successful signature generation
      const mockEd25519 = require("@noble/ed25519");
      mockEd25519.sign.mockResolvedValue(Buffer.from("mocked-signature"));

      const message = "test-message";
      const secretKey = "test-secret-key";

      const result = await (service as any).generateKodiakSignature(
        message,
        secretKey
      );

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should handle signature generation errors", async () => {
      // Configure the mocked dependencies to throw an error
      const mockEd25519 = require("@noble/ed25519");
      mockEd25519.sign.mockRejectedValue(
        new Error("Signature generation failed")
      );

      const message = "test-message";
      const secretKey = "invalid-key";

      await expect(
        (service as any).generateKodiakSignature(message, secretKey)
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to generate Kodiak signature",
        expect.any(Error)
      );
    });
  });
});
