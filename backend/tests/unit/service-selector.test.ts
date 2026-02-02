import {
    selectBalanceService,
    selectAuthService,
    selectPositionService,
    selectBotManagementService,
    getServiceStatus,
    emergencyRollback,
    validateRolloutOrder
} from '../../src/core/service-selector';

describe('Service Selector Tests', () => {
    describe('Service Selection Functions with Logger', () => {
        test('selectBalanceService logs info when logger is available', () => {
            jest.resetModules();
            const infoSpy = jest.fn();
            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    loggerService: {
                        info: infoSpy
                    },
                    balanceService: {}
                }
            }));
            const { selectBalanceService } = require('../../src/core/service-selector');
            selectBalanceService();
            expect(infoSpy).toHaveBeenCalledWith(
                'Using pure BalanceService implementation',
                expect.objectContaining({ implementation: 'pure', phase: 'post-migration' })
            );
        });

        test('selectAuthService logs info when logger is available', () => {
            jest.resetModules();
            const infoSpy = jest.fn();
            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    loggerService: {
                        info: infoSpy
                    },
                    authService: {}
                }
            }));
            const { selectAuthService } = require('../../src/core/service-selector');
            selectAuthService();
            expect(infoSpy).toHaveBeenCalledWith(
                'Using pure AuthService implementation',
                expect.objectContaining({ implementation: 'pure', phase: 'post-migration' })
            );
        });

        describe('selectPositionService', () => {
            test('logs info when USE_PURE_POSITION_SERVICE is true and logger is available', () => {
                jest.resetModules();
                process.env.USE_PURE_POSITION_SERVICE = 'true';
                const infoSpy = jest.fn();
                jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                    diContainer: {
                        loggerService: {
                            info: infoSpy
                        },
                        positionService: {}
                    }
                }));
                const { selectPositionService } = require('../../src/core/service-selector');
                selectPositionService();
                expect(infoSpy).toHaveBeenCalledWith(
                    'Using pure PositionService implementation',
                    expect.objectContaining({
                        featureFlag: 'USE_PURE_POSITION_SERVICE',
                        implementation: 'pure'
                    })
                );
            });

            test('logs warning when USE_PURE_POSITION_SERVICE is false and logger is available', () => {
                jest.resetModules();
                process.env.USE_PURE_POSITION_SERVICE = 'false';
                const warnSpy = jest.fn();
                jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                    diContainer: {
                        loggerService: {
                            warn: warnSpy
                        },
                        positionService: {}
                    }
                }));
                const { selectPositionService } = require('../../src/core/service-selector');
                selectPositionService();
                expect(warnSpy).toHaveBeenCalledWith(
                    'Position service not yet migrated - using pure implementation only',
                    expect.objectContaining({
                        featureFlag: 'USE_PURE_POSITION_SERVICE',
                        implementation: 'pure'
                    })
                );
            });
        });

        test('selectBotManagementService logs info when logger is available', () => {
            jest.resetModules();
            const infoSpy = jest.fn();
            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    loggerService: {
                        info: infoSpy
                    },
                    botManagementService: {}
                }
            }));
            const { selectBotManagementService } = require('../../src/core/service-selector');
            selectBotManagementService();
            expect(infoSpy).toHaveBeenCalledWith(
                'Using BotManagementService implementation',
                expect.objectContaining({ implementation: 'pure', phase: 'post-migration' })
            );
        });

        test('emergencyRollback logs error when logger is available', () => {
            jest.resetModules();
            const errorSpy = jest.fn();
            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    loggerService: {
                        error: errorSpy
                    }
                }
            }));
            const { emergencyRollback } = require('../../src/core/service-selector');
            emergencyRollback();
            expect(errorSpy).toHaveBeenCalledWith(
                'EMERGENCY ROLLBACK: Disabling all pure services',
                expect.objectContaining({ action: 'emergency_rollback' })
            );
        });
    });

    describe('Service Selection Functions without Logger', () => {
        test('selectBalanceService returns balance service from container when logger is not available', () => {
            jest.resetModules();
            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    balanceService: {}
                }
            }));
            const { selectBalanceService } = require('../../src/core/service-selector');
            const service = selectBalanceService();
            expect(service).toBeDefined();
        });

        test('selectAuthService returns auth service from container when logger is not available', () => {
            jest.resetModules();
            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    authService: {}
                }
            }));
            const { selectAuthService } = require('../../src/core/service-selector');
            const service = selectAuthService();
            expect(service).toBeDefined();
        });

        describe('selectPositionService', () => {
            test('returns position service from container when USE_PURE_POSITION_SERVICE is true and logger is not available', () => {
                jest.resetModules();
                process.env.USE_PURE_POSITION_SERVICE = 'true';
                jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                    diContainer: {
                        positionService: {}
                    }
                }));
                const { selectPositionService } = require('../../src/core/service-selector');
                const service = selectPositionService();
                expect(service).toBeDefined();
            });

            test('returns position service from container when USE_PURE_POSITION_SERVICE is false and logger is not available', () => {
                jest.resetModules();
                process.env.USE_PURE_POSITION_SERVICE = 'false';
                jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                    diContainer: {
                        positionService: {}
                    }
                }));
                const { selectPositionService } = require('../../src/core/service-selector');
                const service = selectPositionService();
                expect(service).toBeDefined();
            });
        });

        test('selectBotManagementService returns bot management service from container when logger is not available', () => {
            jest.resetModules();
            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    botManagementService: {}
                }
            }));
            const { selectBotManagementService } = require('../../src/core/service-selector');
            const service = selectBotManagementService();
            expect(service).toBeDefined();
        });
    });

    test('services handle diContainer being undefined', () => {
        jest.resetModules();
        jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
            diContainer: undefined
        }));
        const { selectBalanceService, selectAuthService, selectPositionService, selectBotManagementService, emergencyRollback } = require('../../src/core/service-selector');

        expect(() => selectBalanceService()).toThrow();
        expect(() => selectAuthService()).toThrow();
        expect(() => selectPositionService()).toThrow();
        expect(() => selectBotManagementService()).toThrow();
        expect(() => emergencyRollback()).toThrow();
    });

    describe('Service Status Reporting', () => {
        test('getServiceStatus returns correct status for all services when all flags are true', () => {
            process.env.USE_PURE_BALANCE_SERVICE = 'true';
            process.env.USE_PURE_AUTH_SERVICE = 'true';
            process.env.USE_PURE_POSITION_SERVICE = 'true';
            process.env.USE_PURE_BOT_STATUS_SERVICE = 'true';
            process.env.USE_PURE_TRADING_SERVICES = 'true';

            const status = getServiceStatus();

            expect(status).toEqual({
                balance: { implementation: 'pure', enabled: true },
                auth: { implementation: 'pure', enabled: true },
                position: { implementation: 'pure', enabled: true },
                botStatus: { implementation: 'pure', enabled: true },
                trading: { implementation: 'pure', enabled: true },
                botManagement: { implementation: 'pure', enabled: true }
            });
        });

        test('getServiceStatus returns correct status for all services when all flags are false', () => {
            process.env.USE_PURE_BALANCE_SERVICE = 'false';
            process.env.USE_PURE_AUTH_SERVICE = 'false';
            process.env.USE_PURE_POSITION_SERVICE = 'false';
            process.env.USE_PURE_BOT_STATUS_SERVICE = 'false';
            process.env.USE_PURE_TRADING_SERVICES = 'false';

            const status = getServiceStatus();

            expect(status).toEqual({
                balance: { implementation: 'legacy', enabled: false },
                auth: { implementation: 'legacy', enabled: false },
                position: { implementation: 'legacy', enabled: false },
                botStatus: { implementation: 'legacy', enabled: false },
                trading: { implementation: 'legacy', enabled: false },
                botManagement: { implementation: 'pure', enabled: true }
            });
        });
    });

    describe('Emergency Rollback', () => {
        test('emergencyRollback disables all pure services', () => {
            jest.resetModules();
            process.env.USE_PURE_BALANCE_SERVICE = 'true';
            process.env.USE_PURE_AUTH_SERVICE = 'true';
            process.env.USE_PURE_POSITION_SERVICE = 'true';
            process.env.USE_PURE_TRADING_SERVICES = 'true';

            jest.doMock('../../src/infrastructure/dependency-injection.container', () => ({
                diContainer: {
                    loggerService: {
                        error: jest.fn()
                    }
                }
            }));

            const { emergencyRollback } = require('../../src/core/service-selector');
            emergencyRollback();

            expect(process.env.USE_PURE_BALANCE_SERVICE).toBe('false');
            expect(process.env.USE_PURE_AUTH_SERVICE).toBe('false');
            expect(process.env.USE_PURE_POSITION_SERVICE).toBe('false');
            expect(process.env.USE_PURE_TRADING_SERVICES).toBe('false');
        });
    });

    describe('Rollout Validation', () => {
        test('validateRolloutOrder returns valid when position is enabled before trading', () => {
            process.env.USE_PURE_POSITION_SERVICE = 'true';
            process.env.USE_PURE_TRADING_SERVICES = 'true';

            const result = validateRolloutOrder();

            expect(result.valid).toBe(true);
            expect(result.violations).toEqual([]);
        });

        test('validateRolloutOrder returns violation when trading is enabled before position', () => {
            process.env.USE_PURE_POSITION_SERVICE = 'false';
            process.env.USE_PURE_TRADING_SERVICES = 'true';

            const result = validateRolloutOrder();

            expect(result.valid).toBe(false);
            expect(result.violations).toEqual(['Trading services enabled before position services']);
        });

        test('validateRolloutOrder returns valid when neither service is enabled', () => {
            process.env.USE_PURE_POSITION_SERVICE = 'false';
            process.env.USE_PURE_TRADING_SERVICES = 'false';

            const result = validateRolloutOrder();

            expect(result.valid).toBe(true);
            expect(result.violations).toEqual([]);
        });

        test('validateRolloutOrder works correctly in production environment', () => {
            process.env.NODE_ENV = 'production';
            process.env.USE_PURE_POSITION_SERVICE = 'true';
            process.env.USE_PURE_TRADING_SERVICES = 'true';

            const result = validateRolloutOrder();

            expect(result.valid).toBe(true);
            expect(result.violations).toEqual([]);
        });

        test('validateRolloutOrder works correctly in development environment', () => {
            process.env.NODE_ENV = 'development';
            process.env.USE_PURE_POSITION_SERVICE = 'true';
            process.env.USE_PURE_TRADING_SERVICES = 'true';

            const result = validateRolloutOrder();

            expect(result.valid).toBe(true);
            expect(result.violations).toEqual([]);
        });
    });

    describe('Edge Cases', () => {
        test('getServiceStatus handles missing environment variables', () => {
            delete process.env.USE_PURE_BALANCE_SERVICE;
            delete process.env.USE_PURE_AUTH_SERVICE;
            delete process.env.USE_PURE_POSITION_SERVICE;
            delete process.env.USE_PURE_BOT_STATUS_SERVICE;
            delete process.env.USE_PURE_TRADING_SERVICES;

            const status = getServiceStatus();

            expect(status.balance.implementation).toBe('legacy');
            expect(status.balance.enabled).toBe(false);
            expect(status.auth.implementation).toBe('legacy');
            expect(status.auth.enabled).toBe(false);
            expect(status.position.implementation).toBe('legacy');
            expect(status.position.enabled).toBe(false);
            expect(status.botStatus.implementation).toBe('legacy');
            expect(status.botStatus.enabled).toBe(false);
            expect(status.trading.implementation).toBe('legacy');
            expect(status.trading.enabled).toBe(false);
        });
    });
});