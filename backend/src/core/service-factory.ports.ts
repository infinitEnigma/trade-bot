/**
 * Service factory dependency contract.
 *
 * This module is intentionally core-only: it describes the already-composed
 * services consumed by ServiceFactory without importing infrastructure.
 */

import { getServiceFactory as getFactory } from "./service-factory";
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
 * Configure the process-wide factory with services composed by the container.
 */
export function setServiceFactoryDeps(deps: ServiceFactoryDeps): void {
  // Runtime import is safe: service-factory imports this module type-only.
  getFactory().setDeps(deps);
}

/**
 * Clear singleton dependencies between tests.
 */
export function resetServiceFactoryDepsForTests(): void {
  getFactory().resetDepsForTests();
}
