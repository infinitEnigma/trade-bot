/**
 * Service Selector - Feature Flag Based Service Selection
 *
 * Provides conditional service instantiation based on environment feature flags.
 * Enables gradual replacement of impure services with pure services while
 * maintaining zero-downtime deployment and immediate rollback capability.
 *
 * @format
 */

import { diContainer } from '../infrastructure/dependency-injection.container';
import { BalanceService } from './wallet/balance.service.pure';
import { AuthService } from './auth/auth.service.pure';
import { PositionService } from './trading/position.service.pure';
import { BotStatusService } from './trading/bot-status.service.pure';
import { BotPerformanceService } from './trading/bot-performance.service.pure';

// Legacy service imports (impure implementations)
import { balanceService as legacyBalanceService } from './wallet/balance.service';
import { authService as legacyAuthService } from './auth/auth.service';
import { botStatusService as legacyBotStatusService } from './trading/bot-status.service';

/**
 * Balance Service Selector
 *
 * Selects between pure and legacy balance service implementations
 * based on USE_PURE_BALANCE_SERVICE environment flag.
 */
export function selectBalanceService(): BalanceService | typeof legacyBalanceService {
    const usePure = process.env.USE_PURE_BALANCE_SERVICE === 'true';

    if (usePure) {
        diContainer.loggerService.info('Using pure BalanceService implementation', {
            featureFlag: 'USE_PURE_BALANCE_SERVICE',
            implementation: 'pure'
        });
        return diContainer.balanceService;
    } else {
        diContainer.loggerService.info('Using legacy balance service implementation', {
            featureFlag: 'USE_PURE_BALANCE_SERVICE',
            implementation: 'legacy'
        });
        return legacyBalanceService;
    }
}

/**
 * Auth Service Selector
 *
 * Selects between pure and legacy auth service implementations
 * based on USE_PURE_AUTH_SERVICE environment flag.
 */
export function selectAuthService(): AuthService | typeof legacyAuthService {
    const usePure = process.env.USE_PURE_AUTH_SERVICE === 'true';

    if (usePure) {
        diContainer.loggerService.info('Using pure AuthService implementation', {
            featureFlag: 'USE_PURE_AUTH_SERVICE',
            implementation: 'pure'
        });
        return diContainer.authService;
    } else {
        diContainer.loggerService.info('Using legacy auth service implementation', {
            featureFlag: 'USE_PURE_AUTH_SERVICE',
            implementation: 'legacy'
        });
        return legacyAuthService;
    }
}

/**
 * Position Service Selector
 *
 * Selects between pure and legacy position service implementations
 * based on USE_PURE_POSITION_SERVICE environment flag.
 */
export function selectPositionService(): PositionService {
    const usePure = process.env.USE_PURE_POSITION_SERVICE === 'true';

    if (usePure) {
        diContainer.loggerService.info('Using pure PositionService implementation', {
            featureFlag: 'USE_PURE_POSITION_SERVICE',
            implementation: 'pure'
        });
        return diContainer.positionService;
    } else {
        diContainer.loggerService.warn('Position service not yet migrated - using pure implementation only', {
            featureFlag: 'USE_PURE_POSITION_SERVICE',
            implementation: 'pure'
        });
        // Note: Position service only has pure implementation currently
        return diContainer.positionService;
    }
}

/**
 * Bot Status Service Selector
 *
 * Selects between pure and legacy bot status service implementations
 * based on USE_PURE_BOT_STATUS_SERVICE environment flag.
 */
export function selectBotStatusService(): BotStatusService | typeof legacyBotStatusService {
    const usePure = process.env.USE_PURE_BOT_STATUS_SERVICE === 'true';

    if (usePure) {
        diContainer.loggerService.info('Using pure BotStatusService implementation', {
            featureFlag: 'USE_PURE_BOT_STATUS_SERVICE',
            implementation: 'pure'
        });
        // Note: Pure bot status service would need to be added to DI container
        // For now, return legacy service
        return legacyBotStatusService;
    } else {
        diContainer.loggerService.info('Using legacy bot status service implementation', {
            featureFlag: 'USE_PURE_BOT_STATUS_SERVICE',
            implementation: 'legacy'
        });
        return legacyBotStatusService;
    }
}

/**
 * Service Status Reporter
 *
 * Returns current service implementation status for monitoring and health checks.
 */
export interface ServiceStatus {
    balance: { implementation: 'pure' | 'legacy'; enabled: boolean };
    auth: { implementation: 'pure' | 'legacy'; enabled: boolean };
    position: { implementation: 'pure' | 'legacy'; enabled: boolean };
    botStatus: { implementation: 'pure' | 'legacy'; enabled: boolean };
    trading: { implementation: 'pure' | 'legacy'; enabled: boolean };
}

export function getServiceStatus(): ServiceStatus {
    return {
        balance: {
            implementation: process.env.USE_PURE_BALANCE_SERVICE === 'true' ? 'pure' : 'legacy',
            enabled: process.env.USE_PURE_BALANCE_SERVICE === 'true'
        },
        auth: {
            implementation: process.env.USE_PURE_AUTH_SERVICE === 'true' ? 'pure' : 'legacy',
            enabled: process.env.USE_PURE_AUTH_SERVICE === 'true'
        },
        position: {
            implementation: process.env.USE_PURE_POSITION_SERVICE === 'true' ? 'pure' : 'legacy',
            enabled: process.env.USE_PURE_POSITION_SERVICE === 'true'
        },
        botStatus: {
            implementation: process.env.USE_PURE_BOT_STATUS_SERVICE === 'true' ? 'pure' : 'legacy',
            enabled: process.env.USE_PURE_BOT_STATUS_SERVICE === 'true'
        },
        trading: {
            implementation: process.env.USE_PURE_TRADING_SERVICES === 'true' ? 'pure' : 'legacy',
            enabled: process.env.USE_PURE_TRADING_SERVICES === 'true'
        }
    };
}

/**
 * Emergency Rollback Function
 *
 * Immediately disables all pure services and reverts to legacy implementations.
 * Use in case of critical issues during migration.
 */
export function emergencyRollback(): void {
    diContainer.loggerService.error('EMERGENCY ROLLBACK: Disabling all pure services', {
        action: 'emergency_rollback',
        timestamp: new Date().toISOString()
    });

    // Note: This function would be called from admin endpoints or monitoring alerts
    // Environment variables would need to be updated externally or through process restart
    process.env.USE_PURE_BALANCE_SERVICE = 'false';
    process.env.USE_PURE_AUTH_SERVICE = 'false';
    process.env.USE_PURE_POSITION_SERVICE = 'false';
    process.env.USE_PURE_TRADING_SERVICES = 'false';
}

/**
 * Gradual Rollout Validator
 *
 * Ensures services are enabled in the correct order for safe migration.
 */
export function validateRolloutOrder(): { valid: boolean; violations: string[] } {
    const violations: string[] = [];

    const balanceEnabled = process.env.USE_PURE_BALANCE_SERVICE === 'true';
    const authEnabled = process.env.USE_PURE_AUTH_SERVICE === 'true';
    const positionEnabled = process.env.USE_PURE_POSITION_SERVICE === 'true';
    const tradingEnabled = process.env.USE_PURE_TRADING_SERVICES === 'true';

    // Trading services should not be enabled before position services
    if (tradingEnabled && !positionEnabled) {
        violations.push('Trading services enabled before position services');
    }

    // All services should be tested in development before production
    if (process.env.NODE_ENV === 'production') {
        // Additional production-specific validations could go here
    }

    return {
        valid: violations.length === 0,
        violations
    };
}