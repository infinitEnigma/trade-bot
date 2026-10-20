/** @format */

// Mock logger before importing any modules that use it
jest.mock("../../../src/core/logging/logger.service", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import request from "supertest";
import { Express } from "express";

// Mock middleware to pass through and set user context
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

jest.mock("../../../src/interfaces/middleware/validation.middleware", () => ({
  validators: {
    startBot: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
    stopBot: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
    resumeBot: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
    recoverEngineJournal: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
    // D2 sessions: run attach/detach routes (management.ts) register these;
    // without them router.post receives undefined and every route in the
    // suite dies with "argument handler must be a function".
    attachRun: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
    detachRun: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
    abandonResidual: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
  },
}));

jest.mock("../../../src/infrastructure/security/rate-limiter.service", () => ({
  RateLimiters: {
    botInstances: jest
      .fn()
      .mockImplementation((req: any, res: any, next: any) => next()),
  },
}));

// Mock all other dependencies
jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("test-bot-id"),
}));

jest.mock("../../../src/database/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../../../src/core/bots/bot-lifecycle.service", () => ({
  botLifecycleService: {
    createAndStart: jest.fn(),
    stop: jest.fn(),
    start: jest.fn(),
    emergencyStop: jest.fn(),
    attachStrategyRun: jest.fn(),
    detachStrategyRun: jest.fn(),
    abandonResidual: jest.fn(),
    handleEngineEvent: jest.fn(),
    sweepTimedOutCommands: jest.fn(),
    setSocketServer: jest.fn(),
  },
}));

jest.mock("../../../src/core/bots/engine-registry.service", () => ({
  engineRegistryService: {
    getEngineLiveness: jest.fn(),
    recoverJournalIntegrity: jest.fn(),
  },
}));

// C3a: the start route validates the caller's bound ACTIVE account through the
// adapter, and the credentials route resolves the bot's binding through
// getBoundAccountSecrets. Both are mocked so the suites assert the routing,
// not the SQL (which the adapter's own suite covers).
jest.mock(
  "../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      getAccountWithSecret: jest.fn(),
    },
    getBoundAccountSecrets: jest.fn(),
  })
);

import { setEngineDbDeps, setEngineAccountDeps, engineDb, engineAccount } from "../../../src/interfaces/http/bots/engine";
import { setManagementDbDeps, setManagementAccountDeps, managementDb, managementAccount } from "../../../src/interfaces/http/bots/management";

jest.mock("../../../src/core/strategies/engine-manager.service.pure", () => ({
  EngineManager: jest.fn().mockImplementation(() => ({
    ensureEngineRunning: jest.fn().mockResolvedValue(undefined),
    stopEngineIfNoActiveBots: jest.fn().mockResolvedValue(undefined),
    getEngineStatus: jest.fn().mockResolvedValue({ running: true }),
  })),
}));

jest.mock("../../../src/core/service-provider", () => ({
  serviceProvider: {
    getBotManagementService: jest.fn().mockReturnValue({
      getBotInstances: jest.fn(),
      getBotInstance: jest.fn(),
      getBotPerformance: jest.fn(),
    }),
    getMarketService: jest.fn().mockReturnValue({
      hasUserKodiakCredentials: jest.fn().mockResolvedValue(true),
    }),
    getEngineManager: jest.fn().mockReturnValue({
      ensureEngineRunning: jest.fn().mockResolvedValue(undefined),
      stopEngineIfNoActiveBots: jest.fn().mockResolvedValue(undefined),
      getEngineStatus: jest.fn().mockResolvedValue({ running: true }),
    }),
    getRoleManagementService: jest.fn().mockReturnValue({
      isAdminUser: jest.fn().mockResolvedValue(true),
    }),
  },
}));

jest.mock(
  "../../../src/infrastructure/adapters/repositories/strategy-repository.adapter",
  () => ({
    strategyRepositoryAdapter: {
      getStrategy: jest.fn(),
    },
  })
);

jest.mock(
  "../../../src/infrastructure/adapters/repositories/bot-instance-repository.adapter",
  () => ({
    botInstanceRepositoryAdapter: {
      getActiveBotInstances: jest.fn(),
      createBotInstance: jest.fn(),
    },
  })
);

jest.mock(
  "../../../src/infrastructure/adapters/repositories/audit-log-repository.adapter",
  () => ({
    auditLogRepositoryAdapter: {
      logEvent: jest.fn(),
    },
  })
);

// Mock other dependencies
jest.mock("../../../src/infrastructure/security/encryption.service", () => ({
  withCredentials: jest.fn().mockImplementation((userId, callback) => {
    return callback({
      get: jest.fn().mockReturnValue("test-value"),
    });
  }),
  encryptionService: {
    encryptWithVersion: jest.fn().mockReturnValue("encrypted-session-key"),
  },
}));

jest.mock("../../../src/shared/utils/context", () => ({
  getCorrelationId: jest.fn().mockReturnValue("test-correlation-id"),
  getContextForLogging: jest.fn().mockReturnValue({}),
}));

// Mock Redis service to prevent initialization issues
jest.mock("../../../src/infrastructure/cache/redis.service", () => ({
  redisService: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn(() => ({
      set: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
      setNX: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      exists: jest.fn().mockResolvedValue(0),
      expire: jest.fn().mockResolvedValue(1),
    })),
    del: jest.fn().mockResolvedValue({ success: true }),
    atomicReadModifyWrite: jest.fn(),
    cleanupForTests: jest.fn(),
    isHealthy: jest.fn().mockResolvedValue(true),
  },
}));

// X4: the proof service the requireWalletProof middleware calls. `enabled`
// toggles the gate (mirrors WALLET_PROOF_REQUIRED); `consumeProof` resolves a
// verified address by default and rejects with a WalletProofError otherwise.
jest.mock("../../../src/core/wallet/wallet-proof.service", () => {
  const actual = jest.requireActual(
    "../../../src/core/wallet/wallet-proof.service"
  );
  return {
    ...actual,
    walletProofEnabled: jest.fn(() => false),
    consumeProof: jest.fn(),
    checkAccountWalletBinding: jest.fn().mockResolvedValue({ ok: true }),
  };
});

jest.mock("../../../src/core/notifications/error-notification.service", () => ({
  errorNotificationService: {
    notifyError: jest.fn(),
  },
  ErrorSeverity: {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
    CRITICAL: "CRITICAL",
  },
  ErrorCategory: {
    SYSTEM: "SYSTEM",
    BUSINESS_LOGIC: "BUSINESS_LOGIC",
  },
}));

// Create a test app
function createTestApp(): Express {
  const express = require("express");
  const app = express();

  // Add necessary middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock WebSocket io instance with 'to' method
  app.set("io", {
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
  });

  // Import and register routes
  const { botRoutes } = require("../../../src/interfaces/http/bots");
  app.use("/api/bot", botRoutes);

  return app;
}

describe("Bots Controller", () => {
  let app: Express;

  beforeAll(() => {
    // Set required environment variables for tests
    process.env.BOT_ENGINE_API_KEY = "test-engine-key";
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Wire engine ports with jest.fn() doubles; tests set return values directly.
    setEngineDbDeps({
      selectBot: jest.fn(),
      selectIssuedMarker: jest.fn(),
      findBot: jest.fn(),
      insertCredentialsIssuedMarker: jest.fn(),
      getBotStats: jest.fn(),
      ping: jest.fn(),
    });
    setEngineAccountDeps({
      getBoundAccountSecrets: jest.fn(),
    });
    setManagementDbDeps({
      auditCredentialAccess: jest.fn(),
      selectBot: jest.fn(),
    });
    setManagementAccountDeps({
      getAccountWithSecret: jest.fn(),
    });

    // Create fresh app instance
    app = createTestApp();
  });

  describe("Bot Management Routes", () => {
    describe("GET /api/bot/management/instances", () => {
      it("should return list of bot instances for authenticated user", async () => {
        const mockBotInstances = [
          {
            id: "bot-1",
            strategy_id: "strategy-1",
            user_id: "user-123",
            status: "RUNNING",
            running_time: 3600,
            total_trades: 150,
            total_pnl: 1250.5,
            created_at: new Date().toISOString(),
            strategy_name: "Grid Trading BTC",
            strategy_type: "GRID",
            strategy_config: { symbol: "PERP_BTC_USDC" },
          },
        ];

        const serviceProvider =
          require("../../../src/core/service-provider").serviceProvider;
        serviceProvider
          .getBotManagementService()
          .getBotInstances.mockResolvedValue(mockBotInstances);

        const response = await request(app)
          .get("/api/bot/management/instances")
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "bot-1",
              strategy_id: "strategy-1",
              user_id: "user-123",
              status: "RUNNING",
              running_time: 3600,
              total_trades: 150,
              total_pnl: 1250.5,
              strategy_name: "Grid Trading BTC",
              strategy_type: "GRID",
              strategy_config: { symbol: "PERP_BTC_USDC" },
            }),
          ])
        );
        expect(
          serviceProvider.getBotManagementService().getBotInstances
        ).toHaveBeenCalledWith("user-123");
      });
    });

    describe("POST /api/bot/management/start", () => {
      const testStrategyId = "d290f1ee-6c54-4b01-90e6-d701748f0851";
      const testExchangeAccountId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

      /** C3a: the route resolves + validates the bound account before starting. */
      const mockBoundAccount = (status = "ACTIVE") => {
        (managementAccount().getAccountWithSecret as jest.Mock).mockResolvedValue(
          {
            id: testExchangeAccountId,
            userId: "user-123",
            exchange: "kodiak",
            environment: "testnet",
            accountRef: "kodiak-account-id",
            status,
            verifiedAt: null,
            lastVerifiedAt: null,
            meta: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        );
      };

      it("should start a bot bound to the chosen exchange account", async () => {
        const mockLifecycleResult = {
          botId: "test-bot-id",
          desiredState: "RUNNING",
          actualState: "STARTING",
          correlationId: "test-correlation-id",
        };

        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");
        botLifecycleService.createAndStart.mockResolvedValue(
          mockLifecycleResult
        );

        const query = require("../../../src/database/pool").query;
        query.mockResolvedValue({});

        mockBoundAccount();

        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId: testStrategyId,
            exchangeAccountId: testExchangeAccountId,
            notionalAmount: 1000.5,
          });

        expect(response.status).toBe(202);
        expect(response.body.success).toBe(true);
        expect(response.body.data.botId).toEqual("test-bot-id");
        expect(response.body.data.strategyId).toEqual(testStrategyId);
        expect(response.body.data.desiredState).toEqual("RUNNING");
        expect(response.body.data.actualState).toEqual("STARTING");
        expect(response.body.data.correlationId).toEqual("test-correlation-id");
        // C3a: the account id reaches the lifecycle service, which writes it to
        // bot_instances.exchange_account_id.
        expect(botLifecycleService.createAndStart).toHaveBeenCalledWith(
          "user-123",
          testStrategyId,
          1000.5,
          testExchangeAccountId
        );
      });

      it("should reject a start with no exchange account", async () => {
        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");

        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId: testStrategyId,
            notionalAmount: 1000.5,
          });

        // The engine can never guess which account to trade.
        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(botLifecycleService.createAndStart).not.toHaveBeenCalled();
      });

      it("should 404 an account the user does not own", async () => {
        (managementAccount().getAccountWithSecret as jest.Mock).mockResolvedValue(null);

        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId: testStrategyId,
            exchangeAccountId: testExchangeAccountId,
            notionalAmount: 1000.5,
          });

        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
      });

      it("should reject an account that is not ACTIVE", async () => {
        mockBoundAccount("PENDING");

        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId: testStrategyId,
            exchangeAccountId: testExchangeAccountId,
            notionalAmount: 1000.5,
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      });

      it("should return 404 when the strategy is not found", async () => {
        const notFoundError = new Error("Strategy not found");
        (notFoundError as Error & { statusCode?: number }).statusCode = 404;

        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");
        botLifecycleService.createAndStart.mockRejectedValueOnce(notFoundError);

        mockBoundAccount();

        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId: testStrategyId,
            exchangeAccountId: testExchangeAccountId,
            notionalAmount: 1000.5,
          });

        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
      });

      it("surfaces the service's validation message on 400 (L20 symbol gate)", async () => {
        const validationError = new Error(
          'Symbol "PERP_BTC_USDC" is not listed on lighter (testnet). Supported symbols: BTC, SOL.'
        );
        (validationError as Error & { statusCode?: number }).statusCode = 400;

        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");
        botLifecycleService.createAndStart.mockRejectedValueOnce(
          validationError
        );

        mockBoundAccount();

        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId: testStrategyId,
            exchangeAccountId: testExchangeAccountId,
            notionalAmount: 1000.5,
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain("not listed on lighter");
      });
    });

    // X4 (D1/D3): the wallet-owner proof gate on start/stop/resume/runs,
    // with emergency-stop exempt. The proof service is mocked; `enabled`
    // mirrors WALLET_PROOF_REQUIRED.
    describe("X4 — wallet-proof gate (start/stop/resume/runs)", () => {
      const proof = {
        nonce: "11111111-1111-4111-8111-111111111111",
        address: "0x1234567890abcdef1234567890abcdef12345678",
        signature: "0xsignature",
      };
      const testBotId = "c1d2e3f4-9f41-4b1d-8b62-b3b42b7a5f8d";
      const accountId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
      const strategyId = "d290f1ee-6c54-4b01-90e6-d701748f0851";

      const proofService = () =>
        require("../../../src/core/wallet/wallet-proof.service");
      const lifecycle = () =>
        require("../../../src/core/bots/bot-lifecycle.service")
          .botLifecycleService;
      const query = () => require("../../../src/database/pool").query;
      const accountRepo = () =>
        require("../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter")
          .exchangeAccountRepositoryAdapter;

      beforeEach(() => {
        proofService().walletProofEnabled.mockReturnValue(true);
        proofService().consumeProof.mockResolvedValue({
          address: proof.address,
        });
        proofService().checkAccountWalletBinding.mockResolvedValue({
          ok: true,
        });
        query().mockResolvedValue({
          rows: [{ exchange_account_id: accountId }],
        });
        (managementAccount().getAccountWithSecret as jest.Mock).mockResolvedValue({
          id: accountId,
          userId: "user-123",
          exchange: "kodiak",
          environment: "testnet",
          accountRef: "kodiak-account-id",
          status: "ACTIVE",
          verifiedAt: null,
          lastVerifiedAt: null,
          meta: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        lifecycle().createAndStart.mockResolvedValue({
          botId: testBotId,
          desiredState: "RUNNING",
          actualState: "STARTING",
          correlationId: "cid",
        });
        lifecycle().stop.mockResolvedValue({
          botId: testBotId,
          desiredState: "STOPPED",
          actualState: "STOPPING",
          correlationId: "cid",
        });
        lifecycle().start.mockResolvedValue({
          botId: testBotId,
          desiredState: "RUNNING",
          actualState: "STARTING",
          correlationId: "cid",
        });
        lifecycle().attachStrategyRun.mockResolvedValue("run-1");
        lifecycle().emergencyStop.mockResolvedValue({
          botId: testBotId,
          status: "FORCE_STOPPING",
          desiredState: "STOPPED",
          actualState: "STOPPING",
          action: "FULL_SHUTDOWN",
          correlationId: "cid",
        });
      });

      afterEach(() => {
        proofService().walletProofEnabled.mockReturnValue(false);
      });

      it("403s /start with no proof", async () => {
        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId,
            exchangeAccountId: accountId,
            notionalAmount: 1000.5,
          });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("PROOF_REQUIRED");
        expect(lifecycle().createAndStart).not.toHaveBeenCalled();
      });

      it("403s /stop with no proof", async () => {
        const response = await request(app)
          .post("/api/bot/management/stop")
          .send({ botId: testBotId });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("PROOF_REQUIRED");
        expect(lifecycle().stop).not.toHaveBeenCalled();
      });

      it("403s /resume with no proof", async () => {
        const response = await request(app)
          .post("/api/bot/management/resume")
          .send({ botId: testBotId });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("PROOF_REQUIRED");
        expect(lifecycle().start).not.toHaveBeenCalled();
      });

      it("403s /runs with no proof", async () => {
        const response = await request(app)
          .post("/api/bot/management/runs")
          .send({ botId: testBotId, strategyId, notionalAmount: 1000.5 });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("PROOF_REQUIRED");
        expect(lifecycle().attachStrategyRun).not.toHaveBeenCalled();
      });

      it("passes /start with a valid proof (202) and consumes the proof", async () => {
        const response = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId,
            exchangeAccountId: accountId,
            notionalAmount: 1000.5,
            walletProof: proof,
          });
        expect(response.status).toBe(202);
        expect(proofService().consumeProof).toHaveBeenCalledWith(
          "user-123",
          "bot:start",
          proof
        );
      });

      it("passes /stop and /resume with a valid proof", async () => {
        const stop = await request(app)
          .post("/api/bot/management/stop")
          .send({ botId: testBotId, walletProof: proof });
        expect(stop.status).toBe(202);

        const resume = await request(app)
          .post("/api/bot/management/resume")
          .send({ botId: testBotId, walletProof: proof });
        expect(resume.status).toBe(202);
      });

      it("403s a binding mismatch (fail-closed, D2)", async () => {
        proofService().checkAccountWalletBinding.mockResolvedValue({
          ok: false,
          error: "wallet does not match bound account",
        });
        const response = await request(app)
          .post("/api/bot/management/stop")
          .send({ botId: testBotId, walletProof: proof });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("WALLET_BINDING_MISMATCH");
        expect(lifecycle().stop).not.toHaveBeenCalled();
      });

      it("passes start/stop with no proof when the flag is OFF (D3 harness)", async () => {
        proofService().walletProofEnabled.mockReturnValue(false);
        const start = await request(app)
          .post("/api/bot/management/start")
          .send({
            strategyId,
            exchangeAccountId: accountId,
            notionalAmount: 1000.5,
          });
        expect(start.status).toBe(202);

        const stop = await request(app)
          .post("/api/bot/management/stop")
          .send({ botId: testBotId });
        expect(stop.status).toBe(202);
      });

      it("emergency-stop needs NO proof even when the gate is ON", async () => {
        proofService().consumeProof.mockClear();
        const response = await request(app)
          .post("/api/bot/management/emergency-stop")
          .send({ botId: testBotId });
        expect(response.status).toBe(202);
        expect(proofService().consumeProof).not.toHaveBeenCalled();
      });
    });

    describe("POST /api/bot/management/stop", () => {
      // P0 (2026-10-05): /resume is the only by-botId recovery path. /start always
      // INSERTS a new bot, so a crashed bot must be recovered through the
      // existing service instance rather than a second one being created.
      it("should resume a parked bot for the SAME bot id and return 202", async () => {
        const testBotId = "c1d2e3f4-9f41-4b1d-8b62-b3b42b7a5f8d";
        const mockLifecycleResult = {
          botId: testBotId,
          desiredState: "RUNNING",
          actualState: "STARTING",
          correlationId: "resume-correlation-id",
        };

        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");
        botLifecycleService.start.mockResolvedValue(mockLifecycleResult);

        const response = await request(app)
          .post("/api/bot/management/resume")
          .send({ botId: testBotId })
          .expect(202);

        expect(response.body.success).toBe(true);
        expect(response.body.data.botId).toEqual(testBotId);
        expect(response.body.data.actualState).toEqual("STARTING");
        expect(botLifecycleService.start).toHaveBeenCalledWith(
          testBotId,
          "user-123"
        );
        // The whole point: no second instance was created.
        expect(botLifecycleService.createAndStart).not.toHaveBeenCalled();
      });

      it("should surface 409 when the bot cannot be resumed", async () => {
        const testBotId = "d1e2f3a4-9f41-4b1d-8b62-b3b42b7a5f8d";
        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");
        const conflict = Object.assign(new Error("illegal transition"), {
          statusCode: 409,
        });
        botLifecycleService.start.mockRejectedValue(conflict);

        const response = await request(app)
          .post("/api/bot/management/resume")
          .send({ botId: testBotId })
          .expect(409);

        expect(response.body.success).toBe(false);
      });

      it("should stop a running bot instance", async () => {
        const testBotId = "b0b1e9d6-9f41-4b1d-8b62-b3b42b7a5f8d";
        const mockLifecycleResult = {
          botId: testBotId,
          desiredState: "STOPPED",
          actualState: "STOPPING",
          correlationId: "test-correlation-id",
        };

        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");
        botLifecycleService.stop.mockResolvedValue(mockLifecycleResult);

        const response = await request(app)
          .post("/api/bot/management/stop")
          .send({
            botId: testBotId,
          })
          .expect(202);

        expect(response.body.success).toBe(true);
        expect(response.body.data.botId).toEqual(testBotId);
        expect(response.body.data.desiredState).toEqual("STOPPED");
        expect(response.body.data.actualState).toEqual("STOPPING");
        expect(response.body.data.correlationId).toEqual("test-correlation-id");
        expect(botLifecycleService.stop).toHaveBeenCalledWith(
          testBotId,
          "user-123"
        );
      });

      it("should return 404 when the bot is not found", async () => {
        const testBotId = "b0b1e9d6-9f41-4b1d-8b62-b3b42b7a5f8d";
        const notFoundError = new Error("Bot not found");
        (notFoundError as Error & { statusCode?: number }).statusCode = 404;

        const {
          botLifecycleService,
        } = require("../../../src/core/bots/bot-lifecycle.service");
        botLifecycleService.stop.mockRejectedValueOnce(notFoundError);

        const response = await request(app)
          .post("/api/bot/management/stop")
          .send({
            botId: testBotId,
          });

        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
      });
    });

    describe("GET /api/bot/management/status/:botId", () => {
      it("should return bot status", async () => {
        const mockBot = {
          id: "bot-1",
          user_id: "user-123",
          strategy_id: "strategy-1",
          status: "RUNNING",
          last_heartbeat: new Date(),
          last_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const serviceProvider =
          require("../../../src/core/service-provider").serviceProvider;
        serviceProvider
          .getBotManagementService()
          .getBotInstance.mockResolvedValue(mockBot);

        const response = await request(app)
          .get("/api/bot/management/status/bot-1")
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(
          expect.objectContaining({
            id: "bot-1",
            status: "RUNNING",
          })
        );
        expect(
          serviceProvider.getBotManagementService().getBotInstance
        ).toHaveBeenCalledWith("bot-1");
      });

      it("should handle bot not found", async () => {
        const serviceProvider =
          require("../../../src/core/service-provider").serviceProvider;
        serviceProvider
          .getBotManagementService()
          .getBotInstance.mockResolvedValue(null);

        const response = await request(app)
          .get("/api/bot/management/status/nonexistent-bot")
          .expect(404);

        expect(response.body.success).toBe(false);
      });
    });

    describe("GET /api/bot/management/performance/:botId", () => {
      it("should return bot performance", async () => {
        const mockPerformance = {
          total_trades: 150,
          total_pnl: 1250.5,
        };

        const serviceProvider =
          require("../../../src/core/service-provider").serviceProvider;
        serviceProvider
          .getBotManagementService()
          .getBotPerformance.mockResolvedValue(mockPerformance);

        const response = await request(app)
          .get("/api/bot/management/performance/bot-1")
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(mockPerformance);
        expect(
          serviceProvider.getBotManagementService().getBotPerformance
        ).toHaveBeenCalledWith("bot-1");
      });
    });

    it("should 404 the retired duplicate management engine-status (L1)", async () => {
      // Single canonical engine-status lives at /api/bot/engine/status.
      const response = await request(app)
        .get("/api/bot/management/engine/status")
        .expect(404);

      expect(response.body.success).toBeFalsy();
    });
  });

  describe("Bot Engine Routes", () => {
    describe("GET /api/bot/engine/credentials/:botId", () => {
      /**
       * Queues the route's own queries: bot lookup, marker check, marker insert.
       * Also hands back the mocked binding resolver so a test can set it up
       * without a second inline `require()`.
       */
      const queueRouteQueries = (
        markerInsert: { rows: unknown[]; rowCount: number } = {
          rows: [{ id: "marker-1" }],
          rowCount: 1,
        }
      ) => {
        const { query } = require("../../../src/database/pool");
        const db = engineDb();
        const account = engineAccount();
        const { getBoundAccountSecrets } = account;
        (db.selectBot as jest.Mock).mockResolvedValueOnce({
          user_id: "user-123",
          desired_state: "RUNNING",
          actual_state: "STARTING",
        });
        (db.selectIssuedMarker as jest.Mock).mockResolvedValueOnce([]);
        (db.insertCredentialsIssuedMarker as jest.Mock).mockResolvedValueOnce(
          markerInsert
        );
        return { query, getBoundAccountSecrets };
      };

      it("should issue the bound account's exchange-agnostic kodiak envelope", async () => {
        const { query, getBoundAccountSecrets } = queueRouteQueries();
        (getBoundAccountSecrets as jest.Mock).mockResolvedValue({
          account: { environment: "testnet", accountRef: "kodiak-account-id" },
          request: {
            exchange: "kodiak",
            environment: "testnet",
            accountId: "kodiak-account-id",
            apiKey: "api-key",
            secretKey: "secret-key",
          },
        });

        const response = await request(app)
          .get("/api/bot/engine/credentials/bot-1?correlationId=corr-1")
          .set("x-bot-engine-key", "test-engine-key")
          .expect(200);

        expect(response.body.success).toBe(true);
        // Workstream A envelope, built from the bot's BOUND account (C3a) —
        // not the user's first kodiak row.
        expect(response.body.data).toEqual({
          exchange: "kodiak",
          environment: "testnet",
          accountRef: "kodiak-account-id",
          credentials: {
            accountId: "kodiak-account-id",
            accessKey: "api-key",
            secretKey: "secret-key",
          },
        });
        expect((getBoundAccountSecrets as jest.Mock)).toHaveBeenCalledWith(
          "bot-1"
        );
        // The at-most-once marker is still written after a successful issue,
        // now atomically: the INSERT must carry the ON CONFLICT arbiter of
        // the partial unique index (migration 015), not a bare INSERT.
        expect((engineDb().insertCredentialsIssuedMarker as jest.Mock)).toHaveBeenCalledWith(
          "bot-1",
          "corr-1"
        );
      });

      it("should issue a lighter envelope from a lighter-bound bot", async () => {
        const { getBoundAccountSecrets } = queueRouteQueries();
        (getBoundAccountSecrets as jest.Mock).mockResolvedValue({
          account: { environment: "testnet", accountRef: "7" },
          request: {
            exchange: "lighter",
            environment: "testnet",
            accountIndex: 7,
            apiKeyIndex: 3,
            privateKey: "0xdeadbeef",
          },
        });

        const response = await request(app)
          .get("/api/bot/engine/credentials/bot-2?correlationId=corr-2")
          .set("x-bot-engine-key", "test-engine-key")
          .expect(200);

        expect(response.body.data).toEqual({
          exchange: "lighter",
          environment: "testnet",
          accountRef: "7",
          credentials: {
            accountIndex: 7,
            apiKeyIndex: 3,
            privateKey: "0xdeadbeef",
          },
        });
      });

      it("should 409 an unbound legacy bot instead of trading the wrong account", async () => {
        const db = engineDb();
        (db.selectBot as jest.Mock).mockResolvedValueOnce({
          user_id: "user-123",
          desired_state: "RUNNING",
          actual_state: "RUNNING",
        });
        (db.selectIssuedMarker as jest.Mock).mockResolvedValueOnce([]);

        const account = engineAccount();
        (account.getBoundAccountSecrets as jest.Mock).mockResolvedValue(null);

        const response = await request(app)
          .get("/api/bot/engine/credentials/bot-3?correlationId=corr-3")
          .set("x-bot-engine-key", "test-engine-key")
          .expect(409);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain("no verified exchange account");
      });

      it("should 409 when the marker insert loses the concurrent-fetch race", async () => {
        // The SELECT fast path passes for both fetches; only the index
        // arbitration decides, and the loser must not receive the envelope.
        const { query, getBoundAccountSecrets } = queueRouteQueries({
          rows: [],
          rowCount: 0,
        });
        (getBoundAccountSecrets as jest.Mock).mockResolvedValue({
          account: { environment: "testnet", accountRef: "kodiak-account-id" },
          request: {
            exchange: "kodiak",
            environment: "testnet",
            accountId: "kodiak-account-id",
            apiKey: "api-key",
            secretKey: "secret-key",
          },
        });

        const response = await request(app)
          .get("/api/bot/engine/credentials/bot-race?correlationId=corr-race")
          .set("x-bot-engine-key", "test-engine-key")
          .expect(409);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain("already issued");
        // The envelope the losing fetch built must never be sent.
        expect(response.body.data).toBeUndefined();
        // The insert still went through the index-arbitrated statement.
        const db = engineDb();
        expect((db.insertCredentialsIssuedMarker as jest.Mock)).toHaveBeenCalledWith(
          "bot-race",
          "corr-race"
        );
      });
    });

    describe("GET /api/bot/engine/status", () => {
      const { engineRegistryService } = jest.requireMock(
        "../../../src/core/bots/engine-registry.service"
      );
      const { query } = jest.requireMock("../../../src/database/pool");

      it("reports the engine running from the registry even with zero running bots", async () => {
        const db = engineDb();
        (db.getBotStats as jest.Mock).mockResolvedValueOnce({
          total_bots: "5",
          running_bots: "0",
          stopped_bots: "5",
          error_bots: "0",
        });
        engineRegistryService.getEngineLiveness.mockResolvedValue({
          running: true,
          engines: [
            {
              engineId: "engine-1",
              status: "ONLINE",
              lastSeenAt: new Date(),
              live: true,
              journalIntegrity: "UNKNOWN",
              journalIntegrityAlert: true,
              pendingFills: 2,
            },
          ],
        });

        const response = await request(app)
          .get("/api/bot/engine/status")
          .expect(200);

        expect(response.body.success).toBe(true);
        // Idle engine: zero running bots, registry alive — the old bot-row
        // heuristic said running:false here and showed a false banner.
        expect(response.body.data.running).toBe(true);
        expect(response.body.data.status).toBe("idle");
        expect(response.body.data.activeBots).toBe(0);
        expect(response.body.data.totalBots).toBe(5);
        expect(response.body.data.engines).toHaveLength(1);
        // F4: journal integrity surfaces alongside liveness; `running` is
        // unchanged. Live aggregate is UNKNOWN, sticky alert true, count summed.
        expect(response.body.data.journalIntegrity).toBe("UNKNOWN");
        expect(response.body.data.journalIntegrityAlert).toBe(true);
        expect(response.body.data.pendingFills).toBe(2);
      });

      it("reports offline when no live engine is registered, even with RUNNING bot rows", async () => {
        const db = engineDb();
        (db.getBotStats as jest.Mock).mockResolvedValueOnce({
          total_bots: "5",
          running_bots: "3",
          stopped_bots: "2",
          error_bots: "0",
        });
        engineRegistryService.getEngineLiveness.mockResolvedValue({
          running: false,
          engines: [],
        });

        const response = await request(app)
          .get("/api/bot/engine/status")
          .expect(200);

        // Rows stay informational: a crashed engine with rows still RUNNING
        // must read as offline, not running.
        expect(response.body.data.running).toBe(false);
        expect(response.body.data.status).toBe("offline");
        expect(response.body.data.activeBots).toBe(3);
        expect(response.body.data.engines).toEqual([]);
      });

      it("ignores dead OFFLINE ghost rows when aggregating journal integrity", async () => {
        // Prod 2026-10-12: one live OK engine + two stale pre-025 OFFLINE
        // ghosts stuck at UNVERIFIED. The aggregate must read the live fleet
        // (OK), while `engines[]` keeps all rows for operator visibility.
        const db = engineDb();
        (db.getBotStats as jest.Mock).mockResolvedValueOnce({
          total_bots: "2",
          running_bots: "0",
          stopped_bots: "2",
          error_bots: "0",
        });
        engineRegistryService.getEngineLiveness.mockResolvedValue({
          running: true,
          engines: [
            {
              engineId: "engine-live",
              status: "ONLINE",
              lastSeenAt: new Date(),
              live: true,
              journalIntegrity: "OK",
              journalIntegrityAlert: false,
              pendingFills: 0,
            },
            {
              engineId: "engine-ghost-1",
              status: "OFFLINE",
              lastSeenAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
              live: false,
              journalIntegrity: "UNVERIFIED",
              journalIntegrityAlert: false,
              pendingFills: 0,
            },
            {
              engineId: "engine-ghost-2",
              status: "OFFLINE",
              lastSeenAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
              live: false,
              journalIntegrity: "UNVERIFIED",
              journalIntegrityAlert: false,
              pendingFills: 0,
            },
          ],
        });

        const response = await request(app)
          .get("/api/bot/engine/status")
          .expect(200);

        expect(response.body.data.running).toBe(true);
        expect(response.body.data.journalIntegrity).toBe("OK");
        expect(response.body.data.journalIntegrityAlert).toBe(false);
        expect(response.body.data.pendingFills).toBe(0);
        // Ghosts stay visible per-engine — only the aggregate ignores them.
        expect(response.body.data.engines).toHaveLength(3);
      });

      it("reads UNVERIFIED (never fake OK) when no engine is live", async () => {
        const db = engineDb();
        (db.getBotStats as jest.Mock).mockResolvedValueOnce({
          total_bots: "0",
          running_bots: "0",
          stopped_bots: "0",
          error_bots: "0",
        });
        engineRegistryService.getEngineLiveness.mockResolvedValue({
          running: false,
          engines: [
            {
              engineId: "engine-dead",
              status: "OFFLINE",
              lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
              live: false,
              journalIntegrity: "OK",
              journalIntegrityAlert: false,
              pendingFills: 0,
            },
          ],
        });

        const response = await request(app)
          .get("/api/bot/engine/status")
          .expect(200);

        // A dead row's last OK must not certify a fleet with nothing alive.
        expect(response.body.data.journalIntegrity).toBe("UNVERIFIED");
        expect(response.body.data.journalIntegrityAlert).toBe(false);
      });
    });

    describe("POST /api/bot/management/engine/journal/recover", () => {
      const { engineRegistryService } = jest.requireMock(
        "../../../src/core/bots/engine-registry.service"
      );
      const { serviceProvider } = jest.requireMock(
        "../../../src/core/service-provider"
      );

      it("clears the alert for an admin and records the operator + reference", async () => {
        engineRegistryService.recoverJournalIntegrity.mockResolvedValue({
          recovered: true,
        });

        const response = await request(app)
          .post("/api/bot/management/engine/journal/recover")
          .send({
            engineId: "engine-1",
            reconciled: true,
            reconciliationRef: "INC-1234",
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Admin identity comes from the authenticated request (user-123), never
        // the body; the reference is forwarded for the audit trail.
        expect(
          engineRegistryService.recoverJournalIntegrity
        ).toHaveBeenCalledWith("engine-1", "user-123", "INC-1234");
      });

      it("returns 409 when the precondition is unmet (not OK / not drained)", async () => {
        engineRegistryService.recoverJournalIntegrity.mockResolvedValue({
          recovered: false,
          reason:
            "no active alert, or journal not currently OK and fully drained",
        });

        const response = await request(app)
          .post("/api/bot/management/engine/journal/recover")
          .send({
            engineId: "engine-1",
            reconciled: true,
            reconciliationRef: "INC-1234",
          })
          .expect(409);

        expect(response.body.success).toBe(false);
      });

      it("returns 403 for a non-admin", async () => {
        serviceProvider
          .getRoleManagementService()
          .isAdminUser.mockResolvedValueOnce(false);

        await request(app)
          .post("/api/bot/management/engine/journal/recover")
          .send({
            engineId: "engine-1",
            reconciled: true,
            reconciliationRef: "INC-1234",
          })
          .expect(403);

        expect(
          engineRegistryService.recoverJournalIntegrity
        ).not.toHaveBeenCalled();
      });
    });

    describe("GET /api/bot/engine/health", () => {
      it("should return engine health", async () => {
        const db = engineDb();
        (db.getBotStats as jest.Mock).mockResolvedValueOnce({
          total_bots: "5",
          running_bots: "2",
          stopped_bots: "0",
          error_bots: "0",
        });
        (db.ping as jest.Mock).mockResolvedValueOnce(undefined);

        const response = await request(app)
          .get("/api/bot/engine/health")
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(
          expect.objectContaining({
            status: "healthy",
            botStats: {
              total_bots: "5",
              running_bots: "2",
              stopped_bots: "0",
              error_bots: "0",
            },
            database: "connected",
          })
        );
        expect(db.getBotStats).toHaveBeenCalled();
        expect(db.ping).toHaveBeenCalled();
      });
    });
  });
});
