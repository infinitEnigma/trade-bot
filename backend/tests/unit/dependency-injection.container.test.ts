/** @format */

import { DependencyInjectionContainer, diContainer } from '../../src/infrastructure/dependency-injection.container';

// Mock @noble/ed25519 module to avoid Jest parse errors
jest.mock('@noble/ed25519', () => ({
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

describe('Dependency Injection Container', () => {
    describe('Container Instantiation', () => {
        it('should create a valid DependencyInjectionContainer instance', () => {
            const container = new DependencyInjectionContainer();
            expect(container).toBeDefined();
            expect(container).toBeInstanceOf(DependencyInjectionContainer);
        });

        it('should export a singleton instance', () => {
            expect(diContainer).toBeDefined();
            expect(diContainer).toBeInstanceOf(DependencyInjectionContainer);
        });
    });

    describe('Infrastructure Adapters', () => {
        it('should provide cache service', () => {
            expect(diContainer.cacheService).toBeDefined();
            expect(typeof diContainer.cacheService).toBe('object');
            expect(typeof diContainer.cacheService.get).toBe('function');
            expect(typeof diContainer.cacheService.set).toBe('function');
        });

        it('should provide logger service', () => {
            expect(diContainer.loggerService).toBeDefined();
            expect(typeof diContainer.loggerService).toBe('object');
            expect(typeof diContainer.loggerService.info).toBe('function');
            expect(typeof diContainer.loggerService.error).toBe('function');
        });

        it('should provide token service', () => {
            expect(diContainer.tokenService).toBeDefined();
            expect(typeof diContainer.tokenService).toBe('object');
            expect(typeof diContainer.tokenService.generateAccessToken).toBe('function');
            expect(typeof diContainer.tokenService.generateRefreshToken).toBe('function');
            expect(typeof diContainer.tokenService.verifyToken).toBe('function');
        });

        it('should provide password service', () => {
            expect(diContainer.passwordService).toBeDefined();
            expect(typeof diContainer.passwordService).toBe('object');
            expect(typeof diContainer.passwordService.hash).toBe('function');
            expect(typeof diContainer.passwordService.verify).toBe('function');
        });

        it('should provide encryption service', () => {
            expect(diContainer.encryptionService).toBeDefined();
            expect(typeof diContainer.encryptionService).toBe('object');
            expect(typeof diContainer.encryptionService.encryptApiKey).toBe('function');
            expect(typeof diContainer.encryptionService.decryptApiKey).toBe('function');
            expect(typeof diContainer.encryptionService.encryptSecretKey).toBe('function');
            expect(typeof diContainer.encryptionService.decryptSecretKey).toBe('function');
        });

        it('should provide external API service', () => {
            expect(diContainer.externalApiService).toBeDefined();
            expect(typeof diContainer.externalApiService).toBe('object');
        });
    });

    describe('Repository Adapters', () => {
        it('should provide user repository', () => {
            expect(diContainer.userRepository).toBeDefined();
            expect(typeof diContainer.userRepository).toBe('object');
        });

        it('should provide balance repository', () => {
            expect(diContainer.balanceRepository).toBeDefined();
            expect(typeof diContainer.balanceRepository).toBe('object');
        });

        it('should provide position repository', () => {
            expect(diContainer.positionRepository).toBeDefined();
            expect(typeof diContainer.positionRepository).toBe('object');
        });

        it('should provide trade repository', () => {
            expect(diContainer.tradeRepository).toBeDefined();
            expect(typeof diContainer.tradeRepository).toBe('object');
        });

        it('should provide strategy repository', () => {
            expect(diContainer.strategyRepository).toBeDefined();
            expect(typeof diContainer.strategyRepository).toBe('object');
        });

        it('should provide kodiak credentials repository', () => {
            expect(diContainer.kodiakCredentialsRepository).toBeDefined();
            expect(typeof diContainer.kodiakCredentialsRepository).toBe('object');
        });

        it('should provide audit log repository', () => {
            expect(diContainer.auditLogRepository).toBeDefined();
            expect(typeof diContainer.auditLogRepository).toBe('object');
        });

        it('should provide bot instance repository', () => {
            expect(diContainer.botInstanceRepository).toBeDefined();
            expect(typeof diContainer.botInstanceRepository).toBe('object');
        });

        it('should provide role repository', () => {
            expect(diContainer.roleRepository).toBeDefined();
            expect(typeof diContainer.roleRepository).toBe('object');
        });
    });

    describe('Business Services', () => {
        it('should provide balance service', () => {
            expect(diContainer.balanceService).toBeDefined();
            expect(typeof diContainer.balanceService).toBe('object');
        });

        it('should provide auth service', () => {
            expect(diContainer.authService).toBeDefined();
            expect(typeof diContainer.authService).toBe('object');
        });

        it('should provide position service', () => {
            expect(diContainer.positionService).toBeDefined();
            expect(typeof diContainer.positionService).toBe('object');
        });

        it('should provide role management service', () => {
            expect(diContainer.roleManagementService).toBeDefined();
            expect(typeof diContainer.roleManagementService).toBe('object');
        });

        it('should provide role qualification service', () => {
            expect(diContainer.roleQualificationService).toBeDefined();
            expect(typeof diContainer.roleQualificationService).toBe('object');
        });

        it('should provide wallet qualification service', () => {
            expect(diContainer.walletQualificationService).toBeDefined();
            expect(typeof diContainer.walletQualificationService).toBe('object');
        });

        it('should provide strategy service', () => {
            expect(diContainer.strategyService).toBeDefined();
            expect(typeof diContainer.strategyService).toBe('object');
        });

        it('should provide bot management service', () => {
            expect(diContainer.botManagementService).toBeDefined();
            expect(typeof diContainer.botManagementService).toBe('object');
        });

        it('should provide market service', () => {
            expect(diContainer.marketService).toBeDefined();
            expect(typeof diContainer.marketService).toBe('object');
        });

        it('should provide position validator service', () => {
            expect(diContainer.positionValidatorService).toBeDefined();
            expect(typeof diContainer.positionValidatorService).toBe('object');
        });

        it('should provide position sync service', () => {
            expect(diContainer.positionSyncService).toBeDefined();
            expect(typeof diContainer.positionSyncService).toBe('object');
        });

        it('should provide health service', () => {
            expect(diContainer.healthService).toBeDefined();
            expect(typeof diContainer.healthService).toBe('object');
        });

        it('should provide user profile service', () => {
            expect(diContainer.userProfileService).toBeDefined();
            expect(typeof diContainer.userProfileService).toBe('object');
        });

        it('should provide user kodiak service', () => {
            expect(diContainer.userKodiakService).toBeDefined();
            expect(typeof diContainer.userKodiakService).toBe('object');
        });

        it('should provide engine manager', () => {
            expect(diContainer.engineManager).toBeDefined();
            expect(typeof diContainer.engineManager).toBe('object');
        });
    });

    describe('WebSocket Services', () => {
        it('should provide web socket service', () => {
            expect(diContainer.webSocketService).toBeDefined();
            expect(typeof diContainer.webSocketService).toBe('object');
        });

        it('should provide web socket rate limiter', () => {
            expect(diContainer.webSocketRateLimiter).toBeDefined();
            expect(typeof diContainer.webSocketRateLimiter).toBe('object');
        });
    });

    describe('Redis Stream Operations', () => {
        it('should provide redis stream operations', () => {
            expect(diContainer.redisStreamOperations).toBeDefined();
            expect(typeof diContainer.redisStreamOperations).toBe('object');
        });
    });

    describe('Container Management', () => {
        it('should initialize successfully', async () => {
            await expect(diContainer.initialize()).resolves.not.toThrow();
        });

        it('should return service statistics', () => {
            const stats = diContainer.getServiceStats();
            expect(stats).toBeDefined();
            expect(typeof stats).toBe('object');
            expect(stats.infrastructureAdapters).toBeGreaterThan(0);
            expect(stats.repositoryAdapters).toBeGreaterThan(0);
            expect(stats.businessServices).toBeGreaterThan(0);
            expect(stats.totalServices).toBeGreaterThan(0);
        });
    });

    describe('Health Check', () => {
        it('should perform health check successfully', async () => {
            const health = await diContainer.healthCheck();
            expect(health).toBeDefined();
            expect(typeof health).toBe('object');
            expect(typeof health.healthy).toBe('boolean');
            expect(typeof health.services).toBe('object');
            expect(typeof health.details).toBe('object');
        });
    });

    describe('Convenience Functions', () => {
        it('should export infrastructure service convenience functions', async () => {
            const {
                getCacheService,
                getLoggerService,
                getTokenService,
                getPasswordService,
                getEncryptionService,
                getExternalApiService
            } = await import('../../src/infrastructure/dependency-injection.container');

            expect(getCacheService).toBeDefined();
            expect(typeof getCacheService).toBe('function');
            expect(getCacheService()).toEqual(diContainer.cacheService);

            expect(getLoggerService).toBeDefined();
            expect(typeof getLoggerService).toBe('function');
            expect(getLoggerService()).toEqual(diContainer.loggerService);

            expect(getTokenService).toBeDefined();
            expect(typeof getTokenService).toBe('function');
            expect(getTokenService()).toEqual(diContainer.tokenService);

            expect(getPasswordService).toBeDefined();
            expect(typeof getPasswordService).toBe('function');
            expect(getPasswordService()).toEqual(diContainer.passwordService);

            expect(getEncryptionService).toBeDefined();
            expect(typeof getEncryptionService).toBe('function');
            expect(getEncryptionService()).toEqual(diContainer.encryptionService);

            expect(getExternalApiService).toBeDefined();
            expect(typeof getExternalApiService).toBe('function');
            expect(getExternalApiService()).toEqual(diContainer.externalApiService);
        });

        it('should export repository service convenience functions', async () => {
            const {
                getUserRepository,
                getBalanceRepository,
                getPositionRepository,
                getTradeRepository,
                getStrategyRepository,
                getKodiakCredentialsRepository,
                getAuditLogRepository,
                getBotInstanceRepository
            } = await import('../../src/infrastructure/dependency-injection.container');

            expect(getUserRepository).toBeDefined();
            expect(typeof getUserRepository).toBe('function');
            expect(getUserRepository()).toEqual(diContainer.userRepository);

            expect(getBalanceRepository).toBeDefined();
            expect(typeof getBalanceRepository).toBe('function');
            expect(getBalanceRepository()).toEqual(diContainer.balanceRepository);

            expect(getPositionRepository).toBeDefined();
            expect(typeof getPositionRepository).toBe('function');
            expect(getPositionRepository()).toEqual(diContainer.positionRepository);

            expect(getTradeRepository).toBeDefined();
            expect(typeof getTradeRepository).toBe('function');
            expect(getTradeRepository()).toEqual(diContainer.tradeRepository);

            expect(getStrategyRepository).toBeDefined();
            expect(typeof getStrategyRepository).toBe('function');
            expect(getStrategyRepository()).toEqual(diContainer.strategyRepository);

            expect(getKodiakCredentialsRepository).toBeDefined();
            expect(typeof getKodiakCredentialsRepository).toBe('function');
            expect(getKodiakCredentialsRepository()).toEqual(diContainer.kodiakCredentialsRepository);

            expect(getAuditLogRepository).toBeDefined();
            expect(typeof getAuditLogRepository).toBe('function');
            expect(getAuditLogRepository()).toEqual(diContainer.auditLogRepository);

            expect(getBotInstanceRepository).toBeDefined();
            expect(typeof getBotInstanceRepository).toBe('function');
            expect(getBotInstanceRepository()).toEqual(diContainer.botInstanceRepository);
        });

        it('should export business service convenience functions', async () => {
            const {
                getBalanceService,
                getAuthService,
                getPositionService,
                getStrategyService,
                getBotManagementService,
                getMarketService,
                getHealthService,
                getPositionValidatorService,
                getPositionSyncService,
                getEngineManager,
                getUserProfileService,
                getUserKodiakService,
                getRoleManagementService
            } = await import('../../src/infrastructure/dependency-injection.container');

            expect(getBalanceService).toBeDefined();
            expect(typeof getBalanceService).toBe('function');
            expect(getBalanceService()).toEqual(diContainer.balanceService);

            expect(getAuthService).toBeDefined();
            expect(typeof getAuthService).toBe('function');
            expect(getAuthService()).toEqual(diContainer.authService);

            expect(getPositionService).toBeDefined();
            expect(typeof getPositionService).toBe('function');
            expect(getPositionService()).toEqual(diContainer.positionService);

            expect(getStrategyService).toBeDefined();
            expect(typeof getStrategyService).toBe('function');
            expect(getStrategyService()).toEqual(diContainer.strategyService);

            expect(getBotManagementService).toBeDefined();
            expect(typeof getBotManagementService).toBe('function');
            expect(getBotManagementService()).toEqual(diContainer.botManagementService);

            expect(getMarketService).toBeDefined();
            expect(typeof getMarketService).toBe('function');
            expect(getMarketService()).toEqual(diContainer.marketService);

            expect(getHealthService).toBeDefined();
            expect(typeof getHealthService).toBe('function');
            expect(getHealthService()).toEqual(diContainer.healthService);

            expect(getPositionValidatorService).toBeDefined();
            expect(typeof getPositionValidatorService).toBe('function');
            expect(getPositionValidatorService()).toEqual(diContainer.positionValidatorService);

            expect(getPositionSyncService).toBeDefined();
            expect(typeof getPositionSyncService).toBe('function');
            expect(getPositionSyncService()).toEqual(diContainer.positionSyncService);

            expect(getEngineManager).toBeDefined();
            expect(typeof getEngineManager).toBe('function');
            expect(getEngineManager()).toEqual(diContainer.engineManager);

            expect(getUserProfileService).toBeDefined();
            expect(typeof getUserProfileService).toBe('function');
            expect(getUserProfileService()).toEqual(diContainer.userProfileService);

            expect(getUserKodiakService).toBeDefined();
            expect(typeof getUserKodiakService).toBe('function');
            expect(getUserKodiakService()).toBeDefined();
            expect(typeof getUserKodiakService()).toBe('object');

            expect(getRoleManagementService).toBeDefined();
            expect(typeof getRoleManagementService).toBe('function');
            expect(getRoleManagementService()).toEqual(diContainer.roleManagementService);
        });

        it('should export websocket service convenience functions', async () => {
            const { getWebSocketService, getWebSocketRateLimiter } = await import('../../src/infrastructure/dependency-injection.container');

            expect(getWebSocketService).toBeDefined();
            expect(typeof getWebSocketService).toBe('function');
            expect(getWebSocketService()).toBeDefined();
            expect(typeof getWebSocketService()).toBe('object');

            expect(getWebSocketRateLimiter).toBeDefined();
            expect(typeof getWebSocketRateLimiter).toBe('function');
            expect(getWebSocketRateLimiter()).toEqual(diContainer.webSocketRateLimiter);
        });

        it('should export redis stream operations convenience function', async () => {
            const { getRedisStreamOperations } = await import('../../src/infrastructure/dependency-injection.container');

            expect(getRedisStreamOperations).toBeDefined();
            expect(typeof getRedisStreamOperations).toBe('function');
            expect(getRedisStreamOperations()).toEqual(diContainer.redisStreamOperations);
        });
    });
});
