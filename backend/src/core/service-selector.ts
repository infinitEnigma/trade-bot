/**
 * Service Selector - Feature Flag Based Service Selection
 *
 * Provides conditional service instantiation based on environment feature flags.
 * Enables gradual replacement of impure services with pure services while
 * maintaining zero-downtime deployment and immediate rollback capability.
 *
 * @format
 */

import { BalanceService } from './wallet/balance.service.pure';
import { AuthService } from './auth/auth.service.pure';
import { PositionService } from './strategies/position.service.pure';

// Legacy services have been removed - pure services are now active

/**
 * Balance Service Selector
 *
 * Returns the pure BalanceService implementation.
 * Legacy services have been removed.
 */
export function selectBalanceService(): BalanceService {
    // Import diContainer here to avoid circular dependency issues during module loading
    const { diContainer } = require('../infrastructure/dependency-injection.container');

    // Only log if container is available (avoid issues during testing)
    if (diContainer && diContainer.loggerService) {
        diContainer.loggerService.info('Using pure BalanceService implementation', {
            implementation: 'pure',
            phase: 'post-migration'
        });
    }
    return diContainer.balanceService;
}

/**
 * Auth Service Selector
 *
 * Returns the pure AuthService implementation.
 * Legacy services have been removed.
 */
export function selectAuthService(): AuthService {
    // Import diContainer here to avoid circular dependency issues during module loading
    const { diContainer } = require('../infrastructure/dependency-injection.container');

    // Only log if container is available (avoid issues during testing)
    if (diContainer && diContainer.loggerService) {
        diContainer.loggerService.info('Using pure AuthService implementation', {
            implementation: 'pure',
            phase: 'post-migration'
        });
    }
    return diContainer.authService;
}

/**
 * Position Service Selector
 *
 * Selects between pure and legacy position service implementations
 * based on USE_PURE_POSITION_SERVICE environment flag.
 */
export function selectPositionService(): PositionService {
    // Import diContainer here to avoid circular dependency issues during module loading
    const { diContainer } = require('../infrastructure/dependency-injection.container');

    const usePure = process.env.USE_PURE_POSITION_SERVICE === 'true';

    if (usePure) {
        // Only log if container is available (avoid issues during testing)
        if (diContainer && diContainer.loggerService) {
            diContainer.loggerService.info('Using pure PositionService implementation', {
                featureFlag: 'USE_PURE_POSITION_SERVICE',
                implementation: 'pure'
            });
        }
        return diContainer.positionService;
    } else {
        // Only log if container is available (avoid issues during testing)
        if (diContainer && diContainer.loggerService) {
            diContainer.loggerService.warn('Position service not yet migrated - using pure implementation only', {
                featureFlag: 'USE_PURE_POSITION_SERVICE',
                implementation: 'pure'
            });
        }
        // Note: Position service only has pure implementation currently
        return diContainer.positionService;
    }
}

// Bot status service selector removed - not currently used in application

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
    // Import diContainer here to avoid circular dependency issues during module loading
    const { diContainer } = require('../infrastructure/dependency-injection.container');

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

    //const balanceEnabled = process.env.USE_PURE_BALANCE_SERVICE === 'true';
    //const authEnabled = process.env.USE_PURE_AUTH_SERVICE === 'true';
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