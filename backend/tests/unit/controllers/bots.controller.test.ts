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
    handleEngineEvent: jest.fn(),
    sweepTimedOutCommands: jest.fn(),
    setSocketServer: jest.fn(),
  },
}));

// C3a: the start route validates the caller's bound ACTIVE account through the
// adapter, and the credentials route resolves the bot's binding through
// getBotBoundAccountSecrets. Both are mocked so the suites assert the routing,
// not the SQL (which the adapter's own suite covers).
jest.mock(
  "../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      getAccountWithSecret: jest.fn(),
    },
    getBotBoundAccountSecrets: jest.fn(),
  })
);

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
        const {
          exchangeAccountRepositoryAdapter,
        } = require("../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter");
        exchangeAccountRepositoryAdapter.getAccountWithSecret.mockResolvedValue(
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
        const {
          exchangeAccountRepositoryAdapter,
        } = require("../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter");
        exchangeAccountRepositoryAdapter.getAccountWithSecret.mockResolvedValue(
          null
        );

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

    describe("POST /api/bot/management/stop", () => {
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
      /** Queues the route's own queries: bot lookup, marker check, marker insert. */
      const queueRouteQueries = () => {
        const query = require("../../../src/database/pool").query;
        query
          .mockResolvedValueOnce({
            rows: [
              {
                user_id: "user-123",
                desired_state: "RUNNING",
                actual_state: "STARTING",
              },
            ],
          }) // bot lookup
          .mockResolvedValueOnce({ rows: [] }) // no prior issuance
          .mockResolvedValueOnce({}); // issuance marker insert
        return query;
      };

      it("should issue the bound account's exchange-agnostic kodiak envelope", async () => {
        const query = queueRouteQueries();
        const {
          getBotBoundAccountSecrets,
        } = require("../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter");
        getBotBoundAccountSecrets.mockResolvedValue({
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
        expect(getBotBoundAccountSecrets).toHaveBeenCalledWith(
          "bot-1",
          expect.any(Object)
        );
        // The at-most-once marker is still written after a successful issue.
        expect(query).toHaveBeenCalledWith(
          expect.stringContaining("CREDENTIALS_ISSUED"),
          ["bot-1", "corr-1"]
        );
      });

      it("should issue a lighter envelope from a lighter-bound bot", async () => {
        queueRouteQueries();
        const {
          getBotBoundAccountSecrets,
        } = require("../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter");
        getBotBoundAccountSecrets.mockResolvedValue({
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
        const query = require("../../../src/database/pool").query;
        query
          .mockResolvedValueOnce({
            rows: [
              {
                user_id: "user-123",
                desired_state: "RUNNING",
                actual_state: "RUNNING",
              },
            ],
          }) // bot lookup
          .mockResolvedValueOnce({ rows: [] }); // no prior issuance

        const {
          getBotBoundAccountSecrets,
        } = require("../../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter");
        getBotBoundAccountSecrets.mockResolvedValue(null);

        const response = await request(app)
          .get("/api/bot/engine/credentials/bot-3?correlationId=corr-3")
          .set("x-bot-engine-key", "test-engine-key")
          .expect(409);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain("no verified exchange account");
      });
    });

    describe("POST /api/bot/engine/engine-status", () => {
      it("should process engine status update", async () => {
        const response = await request(app)
          .post("/api/bot/engine/engine-status")
          .set("x-bot-engine-key", "test-engine-key")
          .send({
            status: "running",
            activeBots: 2,
            totalBots: 5,
            uptime: 3600,
            memoryUsage: { rss: 100000000 },
            cpuUsage: 0.1,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.acknowledged).toBe(true);
      });
    });

    describe("GET /api/bot/engine/health", () => {
      it("should return engine health", async () => {
        const query = require("../../../src/database/pool").query;
        query
          .mockResolvedValueOnce({
            rows: [{ total_bots: 5, running_bots: 2, error_bots: 0 }],
          }) // Get bot stats
          .mockResolvedValueOnce({}); // Check database connectivity

        const response = await request(app)
          .get("/api/bot/engine/health")
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(
          expect.objectContaining({
            status: "healthy",
            botStats: {
              total_bots: 5,
              running_bots: 2,
              error_bots: 0,
            },
            database: "connected",
          })
        );
        expect(query).toHaveBeenCalled();
      });
    });
  });
});
