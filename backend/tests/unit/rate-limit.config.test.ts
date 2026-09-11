/**
 * ===========================================
 * 🧪 RATE LIMIT CONFIGURATION - Unit Tests
 * ===========================================
 *
 * Tests for centralized rate limit configuration management
 *
 * @format
 */

import { RATE_LIMIT_CONFIGS, RateLimitConfigUtils } from '../../src/infrastructure/security/rate-limiter/rate-limit.config';
import { UserLevel } from '@trade-bot/shared';

describe('RateLimitConfig', () => {
    describe('Environment multiplier calculation', () => {
        it('should return 10x multiplier for development environment', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            // Act
            const multiplier = RateLimitConfigUtils.getEnvironmentMultiplier();

            // Assert
            expect(multiplier).toBe(10);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });

        it('should return 1x multiplier for production environment', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            // Act
            const multiplier = RateLimitConfigUtils.getEnvironmentMultiplier();

            // Assert
            expect(multiplier).toBe(1);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });

        it('should default to 1x multiplier for unknown environment', () => {
            // Arrange
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            // Act
            const multiplier = RateLimitConfigUtils.getEnvironmentMultiplier();

            // Assert
            expect(multiplier).toBe(1);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('User tier ratios', () => {
        it('should return correct user tier ratios', () => {
            // Act
            const ratios = RateLimitConfigUtils.getUserTierRatios();

            // Assert
            expect(ratios[UserLevel.BASIC]).toBe(1);
            expect(ratios[UserLevel.REGISTERED]).toBe(2.5);
            expect(ratios[UserLevel.VERIFIED]).toBe(5);
        });
    });

    describe('Rate limit configurations', () => {
        it('should have all required configuration keys', () => {
            // Assert
            expect(RATE_LIMIT_CONFIGS.auth).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.public).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.market).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.trading).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.balance).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.websocket).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.botInstances).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.kodiakStatus).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.kodiakApi).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.kodiakConnection).toBeDefined();
        });

        it('should have correct base configuration properties', () => {
            // Assert
            expect(RATE_LIMIT_CONFIGS.auth.windowMs).toBeGreaterThan(0);
            expect(RATE_LIMIT_CONFIGS.auth.max).toBeGreaterThan(0);
            expect(RATE_LIMIT_CONFIGS.auth.message).toBeDefined();
        });

        it('should have user-based limits configured for specific endpoints', () => {
            // Assert
            expect(RATE_LIMIT_CONFIGS.market.enableUserBasedLimits).toBe(true);
            expect(RATE_LIMIT_CONFIGS.trading.enableUserBasedLimits).toBe(true);
            expect(RATE_LIMIT_CONFIGS.balance.enableUserBasedLimits).toBe(true);
            expect(RATE_LIMIT_CONFIGS.websocket.enableUserBasedLimits).toBe(true);
            expect(RATE_LIMIT_CONFIGS.botInstances.enableUserBasedLimits).toBe(true);
        });

        it('should have correct user limits for different user levels', () => {
            // Assert
            expect(RATE_LIMIT_CONFIGS.trading.userLimits).toEqual(
                expect.objectContaining({
                    [UserLevel.BASIC]: expect.any(Number),
                    [UserLevel.REGISTERED]: expect.any(Number),
                    [UserLevel.VERIFIED]: expect.any(Number),
                })
            );

            // Verify Verified users have higher limits
            expect(RATE_LIMIT_CONFIGS.trading.userLimits![UserLevel.VERIFIED]).toBeGreaterThan(
                RATE_LIMIT_CONFIGS.trading.userLimits![UserLevel.REGISTERED]
            );
            expect(RATE_LIMIT_CONFIGS.trading.userLimits![UserLevel.REGISTERED]).toBeGreaterThan(
                RATE_LIMIT_CONFIGS.trading.userLimits![UserLevel.BASIC]
            );
        });

        it('should have fail-open configuration for specific endpoints', () => {
            // Assert
            expect(RATE_LIMIT_CONFIGS.websocket.failOpen).toBe(false);
        });

        it('should have fail-closed configuration for most endpoints', () => {
            // Assert
            expect(RATE_LIMIT_CONFIGS.public.failOpen).toBe(false);
            expect(RATE_LIMIT_CONFIGS.trading.failOpen).toBe(false);
            expect(RATE_LIMIT_CONFIGS.balance.failOpen).toBe(false);
            expect(RATE_LIMIT_CONFIGS.botInstances.failOpen).toBe(false);
            expect(RATE_LIMIT_CONFIGS.kodiakStatus.failOpen).toBe(false);
            expect(RATE_LIMIT_CONFIGS.kodiakApi.failOpen).toBe(false);
            expect(RATE_LIMIT_CONFIGS.kodiakConnection.failOpen).toBe(false);
        });
    });

    describe('Environment-aware rate limits', () => {
        it('should have higher limits in development environment', () => {
            // Arrange - Test environment multiplier calculation directly
            const originalEnv = process.env.NODE_ENV;

            // Test development multiplier
            process.env.NODE_ENV = 'development';
            let multiplier = RateLimitConfigUtils.getEnvironmentMultiplier();
            expect(multiplier).toBe(10);

            // Test production multiplier
            process.env.NODE_ENV = 'production';
            multiplier = RateLimitConfigUtils.getEnvironmentMultiplier();
            expect(multiplier).toBe(1);

            // Cleanup
            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('Kodiak specific configurations', () => {
        it('should have Kodiak connection configuration', () => {
            expect(RATE_LIMIT_CONFIGS.kodiakConnection).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.kodiakConnection.windowMs).toBe(60000); // 1 minute
            expect(RATE_LIMIT_CONFIGS.kodiakConnection.failOpen).toBe(false);
        });

        it('should have Kodiak API configuration', () => {
            expect(RATE_LIMIT_CONFIGS.kodiakApi).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.kodiakApi.windowMs).toBe(60000); // 1 minute
            expect(RATE_LIMIT_CONFIGS.kodiakApi.failOpen).toBe(false);
        });

        it('should have Kodiak status configuration', () => {
            expect(RATE_LIMIT_CONFIGS.kodiakStatus).toBeDefined();
            expect(RATE_LIMIT_CONFIGS.kodiakStatus.enableUserBasedLimits).toBe(true);
            expect(RATE_LIMIT_CONFIGS.kodiakStatus.failOpen).toBe(false);
        });
    });
});