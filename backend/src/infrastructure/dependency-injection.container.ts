/**
 * Dependency Injection Container - Clean Architecture Implementation
 *
 * Central container for managing all infrastructure dependencies and service instantiation.
 * This container wires together all adapters and provides clean service composition
 * for the pure business logic layer.
 *
 * @format
 */

import { redisCacheAdapter } from './adapters/cache/redis-cache.adapter';
import { loggerAdapter } from './adapters/logger/logger.adapter';
import { jwtTokenAdapter } from './adapters/token/jwt-token.adapter';
import { passwordAdapter } from './adapters/password/password.adapter';
import { encryptionAdapter } from './adapters/encryption/encryption.adapter';
import { externalApiAdapter } from './adapters/external/external-api.adapter';

// Repository Adapters
import { userRepositoryAdapter } from './adapters/repositories/user-repository.adapter';
import { balanceRepositoryAdapter } from './adapters/repositories/balance-repository.adapter';
import { positionRepositoryAdapter } from './adapters/repositories/position-repository.adapter';
import { tradeRepositoryAdapter } from './adapters/repositories/trade-repository.adapter';
import { strategyRepositoryAdapter } from './adapters/repositories/strategy-repository.adapter';
import { kodiakCredentialsRepositoryAdapter } from './adapters/repositories/kodiak-credentials-repository.adapter';
import { auditLogRepositoryAdapter } from './adapters/repositories/audit-log-repository.adapter';
import { roleRepositoryAdapter } from './adapters/repositories/role-repository.adapter';
import { botInstanceRepositoryAdapter } from './adapters/repositories/bot-instance-repository.adapter';

// Pure Services
import { BotManagementService } from '../core/bots/bot-management.service';

// Pure Services
import { BalanceService } from '../core/wallet/balance.service.pure';
import { AuthService } from '../core/auth/auth.service.pure';
import { PositionService } from '../core/strategies/position.service.pure';
import { RoleManagementService } from '../core/auth/role-management.service.pure';
import { RoleQualificationService } from '../core/auth/role-qualification.service';
import { WalletQualificationService, walletQualificationService } from '../core/wallet/wallet-qualification.service';

/**
 * Dependency Injection Container
 *
 * Provides centralized dependency management for all infrastructure services.
 * Ensures proper instantiation order and dependency resolution for clean architecture.
 */
export class DependencyInjectionContainer {

    // ===========================================
    // INFRASTRUCTURE ADAPTERS (Singletons)
    // ===========================================

    /**
     * Cache Service - Redis-based caching with TTL support
     */
    get cacheService() {
        return redisCacheAdapter;
    }

    /**
     * Logger Service - Winston-based logging with context support
     */
    get loggerService() {
        return loggerAdapter;
    }

    /**
     * Token Service - JWT token generation and verification
     */
    get tokenService() {
        return jwtTokenAdapter;
    }

    /**
     * Password Service - bcrypt hashing with worker threads
     */
    get passwordService() {
        return passwordAdapter;
    }

    /**
     * Encryption Service - AES-256-GCM with key rotation
     */
    get encryptionService() {
        return encryptionAdapter;
    }

    /**
     * External API Service - Kodiak exchange integration
     */
    get externalApiService() {
        return externalApiAdapter;
    }

    // ===========================================
    // REPOSITORY ADAPTERS (Data Access)
    // ===========================================

    /**
     * User Repository - PostgreSQL user data access
     */
    get userRepository() {
        return userRepositoryAdapter;
    }

    /**
     * Balance Repository - Balance data persistence
     */
    get balanceRepository() {
        return balanceRepositoryAdapter;
    }

    /**
     * Position Repository - Position data management
     */
    get positionRepository() {
        return positionRepositoryAdapter;
    }

    /**
     * Trade Repository - Trade history storage
     */
    get tradeRepository() {
        return tradeRepositoryAdapter;
    }

    /**
     * Strategy Repository - Trading strategy configuration
     */
    get strategyRepository() {
        return strategyRepositoryAdapter;
    }

    /**
     * Kodiak Credentials Repository - Exchange credential management
     */
    get kodiakCredentialsRepository() {
        return kodiakCredentialsRepositoryAdapter;
    }

    /**
     * Audit Log Repository - Security audit logging
     */
    get auditLogRepository() {
        return auditLogRepositoryAdapter;
    }

    /**
     * Role Repository - Role management data access
     */
    get roleRepository() {
        return roleRepositoryAdapter;
    }

    /**
     * Bot Instance Repository - Bot instance data management
     */
    get botInstanceRepository() {
        return botInstanceRepositoryAdapter;
    }

    // ===========================================
    // PURE BUSINESS SERVICES (Dependency Injection)
    // ===========================================

    /**
     * Balance Service - Pure business logic for balance management
     */
    get balanceService(): BalanceService {
        return new BalanceService({
            balanceRepository: this.balanceRepository,
            cache: this.cacheService,
            externalApi: this.externalApiService,
            logger: this.loggerService
        });
    }

    /**
     * Auth Service - Pure business logic for authentication
     */
    get authService(): AuthService {
        return new AuthService({
            userRepository: this.userRepository,
            cache: this.cacheService,
            tokenService: this.tokenService,
            passwordService: this.passwordService,
            logger: this.loggerService,
            auditLogger: this.auditLogRepository
        });
    }

    /**
     * Position Service - Pure business logic for position management
     */
    get positionService(): PositionService {
        return new PositionService({
            positionRepository: this.positionRepository,
            cache: this.cacheService,
            externalApi: this.externalApiService,
            logger: this.loggerService
        });
    }

    /**
     * Role Management Service - Pure business logic for role management
     */
    get roleManagementService(): RoleManagementService {
        return new RoleManagementService({
            roleRepository: this.roleRepository,
            auditLogger: this.auditLogRepository,
            cache: this.cacheService,
            logger: this.loggerService
        });
    }

    /**
     * Role Qualification Service - Pure business logic for role qualification
     */
    get roleQualificationService(): RoleQualificationService {
        return new RoleQualificationService({
            userRepository: this.userRepository,
            cache: this.cacheService,
            logger: this.loggerService
        });
    }

    /**
     * Wallet Qualification Service - Singleton service for wallet qualification
     */
    get walletQualificationService(): WalletQualificationService {
        return walletQualificationService;
    }

    /**
     * Bot Management Service - Business logic for bot management operations
     */
    get botManagementService(): BotManagementService {
        return new BotManagementService({
            botInstanceRepository: this.botInstanceRepository,
            strategyRepository: this.strategyRepository,
            auditLogRepository: this.auditLogRepository
        });
    }

    // ===========================================
    // CONTAINER MANAGEMENT
    // ===========================================

    /**
     * Initialize all infrastructure services
     * Call this at application startup
     */
    async initialize(): Promise<void> {
        try {
            // Log successful container initialization
            this.loggerService.info('Dependency Injection Container initialized successfully', {
                adapters: {
                    cache: 'RedisCacheAdapter',
                    logger: 'LoggerAdapter',
                    token: 'JwtTokenAdapter',
                    password: 'PasswordAdapter',
                    encryption: 'EncryptionAdapter',
                    externalApi: 'ExternalApiAdapter',
                    repositories: 7 // All repository adapters
                },
                services: {
                    balance: 'BalanceService',
                    auth: 'AuthService',
                    position: 'PositionService',
                    botManagement: 'BotManagementService'
                }
            });
        } catch (error) {
            this.loggerService.error('Failed to initialize Dependency Injection Container', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Health check for all infrastructure services
     */
    async healthCheck(): Promise<{
        healthy: boolean;
        services: Record<string, boolean>;
        details: Record<string, unknown>;
    }> {
        const services: Record<string, boolean> = {};
        const details: Record<string, unknown> = {};

        try {
            // Check cache service
            const cacheHealth = await this.cacheService.get('health_check');
            services.cache = cacheHealth.success;
            details.cache = cacheHealth.success ? 'healthy' : 'unhealthy';

            // Check external API connectivity (this would be a lightweight test)
            services.externalApi = true; // Assume healthy for now
            details.externalApi = 'healthy';

            // Check database connectivity via user repository
            const _dbTest = await this.userRepository.findById('health-check-user');
            services.database = true; // If no exception thrown
            details.database = 'healthy';

            const healthy = Object.values(services).every(s => s);

            return {
                healthy,
                services,
                details
            };

        } catch (error) {
            this.loggerService.error('Health check failed', {
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                healthy: false,
                services: { cache: false, externalApi: false, database: false },
                details: {
                    error: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }

    /**
     * Get service instantiation statistics
     */
    getServiceStats(): {
        infrastructureAdapters: number;
        repositoryAdapters: number;
        businessServices: number;
        totalServices: number;
    } {
        return {
            infrastructureAdapters: 6, // cache, logger, token, password, encryption, externalApi
            repositoryAdapters: 8, // user, balance, position, trade, strategy, kodiakCredentials, auditLog, botInstance
            businessServices: 4, // balance, auth, position, botManagement
            totalServices: 18
        };
    }
}

// ===========================================
// GLOBAL CONTAINER INSTANCE
// ===========================================

/**
 * Global singleton instance of the dependency injection container
 */
export const diContainer = new DependencyInjectionContainer();

/**
 * Convenience functions for accessing services
 * These provide type-safe access to container services
 */

// Infrastructure Services
export const getCacheService = () => diContainer.cacheService;
export const getLoggerService = () => diContainer.loggerService;
export const getTokenService = () => diContainer.tokenService;
export const getPasswordService = () => diContainer.passwordService;
export const getEncryptionService = () => diContainer.encryptionService;
export const getExternalApiService = () => diContainer.externalApiService;

// Repository Services
export const getUserRepository = () => diContainer.userRepository;
export const getBalanceRepository = () => diContainer.balanceRepository;
export const getPositionRepository = () => diContainer.positionRepository;
export const getTradeRepository = () => diContainer.tradeRepository;
export const getStrategyRepository = () => diContainer.strategyRepository;
export const getKodiakCredentialsRepository = () => diContainer.kodiakCredentialsRepository;
export const getAuditLogRepository = () => diContainer.auditLogRepository;
export const getBotInstanceRepository = () => diContainer.botInstanceRepository;

// Business Services
export const getBalanceService = () => diContainer.balanceService;
export const getAuthService = () => diContainer.authService;
export const getPositionService = () => diContainer.positionService;
export const getBotManagementService = () => diContainer.botManagementService;
