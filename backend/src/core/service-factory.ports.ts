/**
 * Service factory dependency contract.
 *
 * This module is intentionally core-only: it describes the already-composed
 * services consumed by ServiceFactory without importing infrastructure.
 */

import type { AuthService } from "./auth/auth.service.pure";
import type { RoleManagementService } from "./auth/role-management.service.pure";
import type { RoleQualificationService } from "./auth/role-qualification.service";
import type { WalletQualificationService } from "./wallet/wallet-qualification.service.pure";
import type { BalanceService } from "./wallet/balance.service.pure";
import type { PositionService } from "./strategies/position.service.pure";
import type { PositionValidatorService } from "./strategies/position-validator.service.pure";
import type { PositionSyncService } from "./strategies/position-sync.service.pure";
import type { EngineManager } from "./strategies/engine-manager.service.pure";
import type { StrategyService } from "./strategies/strategy.service";
import type { BotManagementService } from "./bots/bot-management.service";
import type { MarketService } from "./market/market.service";
import type { HealthService } from "./system/health.service.pure";
import type { UserProfileService } from "./user/user-profile.service";
import type { ExchangeAccountService } from "./user/exchange-account.service";

/**
 * Prebuilt service instances supplied by the infrastructure composition root.
 * Services are captured once at startup and then delegated to by the factory.
 */
export interface ServiceFactoryDeps {
  authService: AuthService;
  balanceService: BalanceService;
  positionService: PositionService;
  roleManagementService: RoleManagementService;
  roleQualificationService: RoleQualificationService;
  walletQualificationService: WalletQualificationService;
  userProfileService: UserProfileService;
  exchangeAccountService: ExchangeAccountService;
  botManagementService: BotManagementService;
  strategyService: StrategyService;
  marketService: MarketService;
  positionValidatorService: PositionValidatorService;
  positionSyncService: PositionSyncService;
  healthService: HealthService;
  engineManager: EngineManager;
}

/**
 * Configure the process-wide ServiceFactory singleton with composed services.
 * Implemented in service-factory.ts to avoid introducing a second singleton.
 */
export function setServiceFactoryDeps(deps: ServiceFactoryDeps): void {
  // Lazy require is intentionally avoided; the factory module owns this forwarder.
  setDepsForwarder(deps);
}

/**
 * Test-only reset for deterministic singleton isolation.
 */
export function resetServiceFactoryDepsForTests(): void {
  resetDepsForwarder();
}

// The factory module registers the forwarders once during module initialization.
let setDepsForwarder: (deps: ServiceFactoryDeps) => void = () => {
  throw new Error("ServiceFactory dependency forwarder has not been registered");
};
let resetDepsForwarder: () => void = () => {
  throw new Error("ServiceFactory dependency reset forwarder has not been registered");
};

export function registerServiceFactoryDepsForwarders(
  setDeps: (deps: ServiceFactoryDeps) => void,
  resetDeps: () => void
): void {
  setDepsForwarder = setDeps;
  resetDepsForwarder = resetDeps;
}
