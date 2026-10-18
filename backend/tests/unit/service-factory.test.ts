/**
 * ServiceFactory tests focus on delegation and singleton wiring.
 */

import {
  ServiceFactory,
  assertServiceFactoryWired,
  getServiceFactory,
  serviceFactory,
} from "../../src/core/service-factory";
import {
  resetServiceFactoryDepsForTests,
  setServiceFactoryDeps,
  type ServiceFactoryDeps,
} from "../../src/core/service-factory.ports";
import { contextLogger } from "../../src/core/logging";

jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("@noble/ed25519", () => ({
  sign: jest.fn(),
  verify: jest.fn(),
  getPublicKey: jest.fn(),
  keygen: jest.fn(),
  etc: jest.fn(),
  getPublicKeyAsync: jest.fn(),
  hash: jest.fn(),
  hashes: jest.fn(),
  keygenAsync: jest.fn(),
  Point: jest.fn(),
  signAsync: jest.fn(),
  utils: jest.fn(),
  verifyAsync: jest.fn(),
}));

const createDeps = (): ServiceFactoryDeps => ({
  authService: { id: "auth" } as any,
  balanceService: { id: "balance" } as any,
  positionService: { id: "position" } as any,
  roleManagementService: { id: "role-management" } as any,
  roleQualificationService: { id: "role-qualification" } as any,
  walletQualificationService: { id: "wallet-qualification" } as any,
  userProfileService: {
    id: "user-profile",
    invalidateUserProfileCache: jest.fn(),
  } as any,
  exchangeAccountService: { id: "exchange-account" } as any,
  botManagementService: { id: "bot-management" } as any,
  strategyService: { id: "strategy" } as any,
  marketService: { id: "market" } as any,
  positionValidatorService: { id: "position-validator" } as any,
  positionSyncService: { id: "position-sync" } as any,
  healthService: { id: "health" } as any,
  engineManager: { id: "engine-manager" } as any,
});

describe("ServiceFactory dependency injection", () => {
  let deps: ServiceFactoryDeps;
  let factory: ServiceFactory;
  const logger = contextLogger as jest.Mocked<typeof contextLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceFactoryDepsForTests();
    deps = createDeps();
    factory = new ServiceFactory(deps);
  });

  afterEach(() => {
    resetServiceFactoryDepsForTests();
  });

  test("delegates every getter to its injected service instance", () => {
    expect(factory.getAuthService()).toBe(deps.authService);
    expect(factory.getBalanceService()).toBe(deps.balanceService);
    expect(factory.getPositionService()).toBe(deps.positionService);
    expect(factory.getRoleManagementService()).toBe(deps.roleManagementService);
    expect(factory.getRoleQualificationService()).toBe(
      deps.roleQualificationService
    );
    expect(factory.getWalletQualificationService()).toBe(
      deps.walletQualificationService
    );
    expect(factory.getUserProfileService()).toBe(deps.userProfileService);
    expect(factory.getExchangeAccountService()).toBe(
      deps.exchangeAccountService
    );
    expect(factory.getBotManagementService()).toBe(deps.botManagementService);
    expect(factory.getStrategyService()).toBe(deps.strategyService);
    expect(factory.getMarketService()).toBe(deps.marketService);
    expect(factory.getPositionValidatorService()).toBe(
      deps.positionValidatorService
    );
    expect(factory.getPositionSyncService()).toBe(deps.positionSyncService);
    expect(factory.getHealthService()).toBe(deps.healthService);
    expect(factory.getEngineManager()).toBe(deps.engineManager);
  });

  test("returns stable user-profile and exchange-account instances", () => {
    expect(factory.getUserProfileService()).toBe(factory.getUserProfileService());
    expect(factory.getExchangeAccountService()).toBe(
      factory.getExchangeAccountService()
    );
  });

  test("keeps the public IServiceFactory surface available", () => {
    expect(factory.getAllServices).toBeDefined();
    expect(factory.healthCheck).toBeDefined();
    expect(factory.getAllServices().authService).toBe(deps.authService);
    expect(factory.getAllServices().exchangeAccountService).toBe(
      deps.exchangeAccountService
    );
  });

  test("returns undefined and logs when a getter is called before wiring", () => {
    const unwired = new ServiceFactory();

    expect(unwired.getAuthService()).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to get Auth Service",
      expect.any(Error),
      { service: "AuthService" }
    );
  });

  test("fails the startup assertion if dependencies have not been wired", () => {
    expect(() => new ServiceFactory().assertDepsConfigured()).toThrow(
      "Service Factory dependencies have not been configured"
    );
    expect(() => assertServiceFactoryWired()).toThrow(
      "Service Factory dependencies have not been configured"
    );
  });

  test("asserts the full dependency set after wiring", () => {
    factory.assertDepsConfigured();
    expect(() => {
      setServiceFactoryDeps(deps);
      assertServiceFactoryWired();
    }).not.toThrow();
  });

  test("the module setter and exported singleton share one factory instance", () => {
    setServiceFactoryDeps(deps);

    expect(getServiceFactory()).toBe(serviceFactory);
    expect(getServiceFactory().getAuthService()).toBe(deps.authService);
    expect(getServiceFactory().getExchangeAccountService()).toBe(
      deps.exchangeAccountService
    );
  });

  test("reset deterministically clears singleton dependency state", () => {
    setServiceFactoryDeps(deps);
    expect(getServiceFactory().getAuthService()).toBe(deps.authService);

    resetServiceFactoryDepsForTests();

    expect(getServiceFactory()).toBe(serviceFactory);
    expect(getServiceFactory().getAuthService()).toBeUndefined();
  });

  test("health check reports injected services", async () => {
    const result = await factory.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.services.authService).toBe(true);
    expect(result.services.exchangeAccountService).toBe(true);
  });
});
