/** @format */

import request from "supertest";
import { Express } from "express";

// Mock blockchain service (provider only — wallet resolution lives in the
// wallet repository adapter, C2 multi-wallet).
jest.mock("../../../src/infrastructure/external/blockchain.service", () => {
  const mockBlockchainService = {
    getNativeBalance: jest.fn(),
    invalidateUserCache: jest.fn(),
  };

  return {
    createBlockchainService: jest.fn().mockReturnValue(mockBlockchainService),
  };
});

// Mock the wallet repository (ownership-scoped wallet resolution).
jest.mock(
  "../../../src/infrastructure/adapters/repositories/wallet-repository.adapter",
  () => ({
    walletRepositoryAdapter: {
      listWallets: jest.fn(),
      getOwnedWallet: jest.fn(),
    },
  })
);

// Mock rate limiters. balance.ts imports RateLimiters directly from the
// rate-limiter module (same convention as every other route file), so the
// direct path is what must be stubbed; the infrastructure barrel export is
// stubbed as well in case another module in this graph pulls it from there.
jest.mock("../../../src/infrastructure/security/rate-limiter.service", () => ({
  ...jest.requireActual(
    "../../../src/infrastructure/security/rate-limiter.service"
  ),
  RateLimiters: {
    balance: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
  },
}));
jest.mock("../../../src/infrastructure", () => ({
  RateLimiters: {
    balance: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
  },
}));

// Mock auth middleware to set user context for protected routes
jest.mock("../../../src/interfaces/middleware/auth.middleware", () => ({
  authMiddleware: jest
    .fn()
    .mockImplementation((req: any, res: any, next: any) => {
      req.user = {
        userId: "user-123",
        email: "test@example.com",
        userLevel: "VERIFIED",
        roles: [],
      };
      next();
    }),
  AuthenticatedRequest: jest.fn(),
}));

// Mock logger
jest.mock("../../../src/core/logging/logger.service", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

// Get the mock blockchain service
const mockBlockchainService =
  require("../../../src/infrastructure/external/blockchain.service").createBlockchainService();
const mockWalletRepository = require(
  "../../../src/infrastructure/adapters/repositories/wallet-repository.adapter"
).walletRepositoryAdapter;

const mockEvmWallet = {
  id: "wallet-1",
  userId: "user-123",
  chain: "evm",
  address: "0x1234567890abcdef1234567890abcdef12345678",
  label: null,
  isPrimary: true,
  verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const mockSolanaWallet = {
  ...mockEvmWallet,
  id: "wallet-sol",
  chain: "solana",
  address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  isPrimary: false,
};

const mockBalance = {
  address: mockEvmWallet.address,
  nativeBalance: "1000000000000000000",
  nativeBalanceFormatted: "1.0",
  chainId: 80094,
  chainName: "Berachain Mainnet",
  symbol: "BERA",
  timestamp: "2026-01-01T00:00:00.000Z",
  cacheHit: false,
};

// Create a test app
function createTestApp(): Express {
  const express = require("express");
  const app = express();

  // Add necessary middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Import and register routes
  const {
    walletBalanceRoutes,
  } = require("../../../src/interfaces/http/wallet/balance");
  app.use("/api/balance", walletBalanceRoutes);

  // Add error handling middleware
  const {
    handleErrors,
  } = require("../../../src/interfaces/middleware/error-handler.middleware");
  app.use(handleErrors);

  return app;
}

function mockAuthAs(userLevel: string | null): void {
  jest
    .spyOn(
      require("../../../src/interfaces/middleware/auth.middleware"),
      "authMiddleware"
    )
    .mockImplementation((req: any, res: any, next: any) => {
      req.user = userLevel
        ? {
            userId: "user-123",
            email: "test@example.com",
            userLevel,
            roles: [],
          }
        : null;
      next();
    });
}

describe("Balance Controller Tests", () => {
  let app: Express;
  let originalAuthMiddleware: any;

  beforeAll(() => {
    // Save original auth middleware
    originalAuthMiddleware =
      require("../../../src/interfaces/middleware/auth.middleware").authMiddleware;
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Restore original auth middleware
    jest
      .spyOn(
        require("../../../src/interfaces/middleware/auth.middleware"),
        "authMiddleware"
      )
      .mockImplementation(originalAuthMiddleware);

    // Create fresh app instance
    app = createTestApp();
  });

  describe("GET /api/balance/current", () => {
    it("should return null balance for BASIC user", async () => {
      mockAuthAs("BASIC");
      app = createTestApp();

      const response = await request(app)
        .get("/api/balance/current")
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: null,
        message: "Wallet balance data available after wallet connection",
      });
      // BASIC short-circuit must not touch wallet or provider layers.
      expect(mockWalletRepository.listWallets).not.toHaveBeenCalled();
      expect(mockBlockchainService.getNativeBalance).not.toHaveBeenCalled();
    });

    it("should return on-chain balance for VERIFIED user with primary EVM wallet", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([mockEvmWallet]);
      mockBlockchainService.getNativeBalance.mockResolvedValue(mockBalance);

      const response = await request(app)
        .get("/api/balance/current")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        source: "onchain",
        walletId: "wallet-1",
        address: mockEvmWallet.address,
        chainId: 80094,
        chainName: "Berachain Mainnet",
        symbol: "BERA",
        nativeBalance: "1000000000000000000",
        nativeBalanceFormatted: "1.0",
        timestamp: mockBalance.timestamp,
        observedAt: mockBalance.timestamp,
        cache: "miss",
      });
      expect(mockBlockchainService.getNativeBalance).toHaveBeenCalledWith(
        mockEvmWallet.address
      );
    });

    it("should return balance for REGISTERED user who owns a wallet", async () => {
      // Regression: REGISTERED (wallet linked) used to be rejected with
      // "requires VERIFIED account status".
      mockAuthAs("REGISTERED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([mockEvmWallet]);
      mockBlockchainService.getNativeBalance.mockResolvedValue(mockBalance);

      const response = await request(app)
        .get("/api/balance/current")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.source).toBe("onchain");
      expect(response.body.data.nativeBalanceFormatted).toBe("1.0");
    });

    it("should report cache hits", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([mockEvmWallet]);
      mockBlockchainService.getNativeBalance.mockResolvedValue({
        ...mockBalance,
        cacheHit: true,
      });

      const response = await request(app)
        .get("/api/balance/current")
        .expect(200);

      expect(response.body.data.cache).toBe("hit");
    });

    it("should return 400 when the user has no EVM wallet", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([]);

      const response = await request(app)
        .get("/api/balance/current")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("No connected wallet found");
    });

    it("should return 503 when the provider fails", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([mockEvmWallet]);
      mockBlockchainService.getNativeBalance.mockRejectedValue(
        new Error("Failed to get balance from blockchain")
      );

      const response = await request(app)
        .get("/api/balance/current")
        .expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it("should return 503 for unexpected provider errors (fail-closed)", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([mockEvmWallet]);
      mockBlockchainService.getNativeBalance.mockRejectedValue(
        new Error("Unexpected error")
      );

      const response = await request(app)
        .get("/api/balance/current")
        .expect(503);

      expect(response.body.success).toBe(false);
    });

    it("should scope the read to an owned walletId", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.getOwnedWallet.mockResolvedValue(mockEvmWallet);
      mockBlockchainService.getNativeBalance.mockResolvedValue(mockBalance);

      const response = await request(app)
        .get("/api/balance/current?walletId=wallet-1")
        .expect(200);

      expect(mockWalletRepository.getOwnedWallet).toHaveBeenCalledWith(
        "user-123",
        "wallet-1"
      );
      expect(response.body.data.walletId).toBe("wallet-1");
      expect(mockBlockchainService.getNativeBalance).toHaveBeenCalledWith(
        mockEvmWallet.address
      );
    });

    it("should return 404 for a foreign or missing walletId", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.getOwnedWallet.mockResolvedValue(null);

      const response = await request(app)
        .get("/api/balance/current?walletId=not-mine")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(mockBlockchainService.getNativeBalance).not.toHaveBeenCalled();
    });

    it("should return 400 when walletId points to a non-EVM wallet", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.getOwnedWallet.mockResolvedValue(mockSolanaWallet);

      const response = await request(app)
        .get("/api/balance/current?walletId=wallet-sol")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("not supported");
      expect(mockBlockchainService.getNativeBalance).not.toHaveBeenCalled();
    });

    it("should handle unauthenticated user scenario", async () => {
      mockAuthAs(null);
      app = createTestApp();

      const response = await request(app)
        .get("/api/balance/current")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("User not authenticated");
    });
  });

  describe("POST /api/balance/refresh", () => {
    it("should invalidate cache, refetch, and return the on-chain shape", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([mockEvmWallet]);
      mockBlockchainService.invalidateUserCache.mockResolvedValue(undefined);
      mockBlockchainService.getNativeBalance.mockResolvedValue({
        ...mockBalance,
        cacheHit: false,
      });

      const response = await request(app)
        .post("/api/balance/refresh")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.source).toBe("onchain");
      expect(response.body.data.cache).toBe("miss");
      expect(mockBlockchainService.invalidateUserCache).toHaveBeenCalledWith(
        "user-123",
        mockEvmWallet.address
      );
      expect(mockBlockchainService.getNativeBalance).toHaveBeenCalledWith(
        mockEvmWallet.address
      );
    });

    it("should accept an optional walletId in the body", async () => {
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.getOwnedWallet.mockResolvedValue(mockEvmWallet);
      mockBlockchainService.invalidateUserCache.mockResolvedValue(undefined);
      mockBlockchainService.getNativeBalance.mockResolvedValue(mockBalance);

      const response = await request(app)
        .post("/api/balance/refresh")
        .send({ walletId: "wallet-1" })
        .expect(200);

      expect(mockWalletRepository.getOwnedWallet).toHaveBeenCalledWith(
        "user-123",
        "wallet-1"
      );
      expect(response.body.data.walletId).toBe("wallet-1");
    });

    it("should return a structured 400 when wallet is not connected", async () => {
      // Regression: used to be 500 with success: true.
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([]);

      const response = await request(app)
        .post("/api/balance/refresh")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("No connected wallet found");
    });

    it("should return a structured 503 when the provider fails", async () => {
      // Regression: used to be 500 with success: true.
      mockAuthAs("VERIFIED");
      app = createTestApp();

      mockWalletRepository.listWallets.mockResolvedValue([mockEvmWallet]);
      mockBlockchainService.invalidateUserCache.mockResolvedValue(undefined);
      mockBlockchainService.getNativeBalance.mockRejectedValue(
        new Error("Failed to get balance from blockchain")
      );

      const response = await request(app)
        .post("/api/balance/refresh")
        .expect(503);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });
});
