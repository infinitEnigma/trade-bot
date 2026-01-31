/**
 * ===========================================
 * 🧪 RATE LIMITER SERVICE - Unit Tests
 * ===========================================
 *
 * Tests for main rate limiter service
 *
 * @format
 */

import { createRateLimiter, RateLimiters } from '../../src/infrastructure/security/rate-limiter.service';
import { RATE_LIMIT_CONFIGS } from '../../src/infrastructure/security/rate-limiter/rate-limit.config';
import { redisService } from '../../src/infrastructure';
import { Request, Response, NextFunction } from 'express';

// Mock Redis service
jest.mock('../../src/infrastructure', () => ({
    ...jest.requireActual('../../src/infrastructure'),
    redisService: {
        isHealthy: jest.fn(),
        atomicIncrementWithExpiry: jest.fn(),
    },
}));

describe('RateLimiterService', () => {
    describe('Rate limiters creation', () => {
        it('should create rate limiter instances', () => {
            // Assert
            expect(RateLimiters.auth).toBeDefined();
            expect(RateLimiters.public).toBeDefined();
            expect(RateLimiters.market).toBeDefined();
            expect(RateLimiters.trading).toBeDefined();
            expect(RateLimiters.balance).toBeDefined();
            expect(RateLimiters.websocket).toBeDefined();
            expect(RateLimiters.botInstances).toBeDefined();
            expect(RateLimiters.kodiakStatus).toBeDefined();
            expect(RateLimiters.kodiakApi).toBeDefined();
        });

        it('should create custom rate limiter', () => {
            // Arrange
            const customConfig = {
                windowMs: 60000,
                max: 100,
                message: 'Custom limit exceeded',
                failOpen: true,
                enableUserBasedLimits: false,
            };

            // Act
            const limiter = createRateLimiter('custom', customConfig);

            // Assert
            expect(limiter).toBeInstanceOf(Function);
            expect(typeof limiter).toBe('function');
        });
    });

    describe('Rate limiter functionality', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should allow OPTIONS requests without rate limiting', async () => {
            // Arrange
            const limiter = RateLimiters.public;
            const req = { method: 'OPTIONS', ip: '192.168.1.1' } as unknown as Request;
            const res = {} as Response;
            const next = jest.fn();

            // Act
            await limiter(req, res, next);

            // Assert
            expect(next).toHaveBeenCalled();
        });

        it('should allow requests when rate limiting is disabled', async () => {
            // Arrange
            const originalEnv = process.env.RATE_LIMITING_ENABLED;
            process.env.RATE_LIMITING_ENABLED = 'false';

            const limiter = RateLimiters.public;
            const req = { method: 'GET', ip: '192.168.1.1' } as unknown as Request;
            const res = {} as Response;
            const next = jest.fn();

            // Act
            await limiter(req, res, next);

            // Assert
            expect(next).toHaveBeenCalled();

            // Cleanup
            process.env.RATE_LIMITING_ENABLED = originalEnv;
        });

        it('should handle Redis unavailability with fallback', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(false);

            const limiter = RateLimiters.public;
            const req = { method: 'GET', ip: '192.168.1.1' } as unknown as Request;
            const res = {
                set: jest.fn(),
            } as unknown as Response;
            const next = jest.fn();

            // Act
            await limiter(req, res, next);

            // Assert
            expect(next).toHaveBeenCalled();
        });
    });

    describe('Rate limiter configuration', () => {
        it('should have correct configurations', () => {
            // Assert
            expect(RATE_LIMIT_CONFIGS.auth).toEqual(
                expect.objectContaining({
                    windowMs: expect.any(Number),
                    max: expect.any(Number),
                    message: expect.any(String),
                })
            );

            expect(RATE_LIMIT_CONFIGS.public).toEqual(
                expect.objectContaining({
                    windowMs: expect.any(Number),
                    max: expect.any(Number),
                    message: expect.any(String),
                    failOpen: expect.any(Boolean),
                })
            );
        });

        it('should have appropriate window durations', () => {
            // Assert - All configurations should have window duration > 0
            Object.values(RATE_LIMIT_CONFIGS).forEach((config) => {
                expect(config.windowMs).toBeGreaterThan(0);
                expect(config.max).toBeGreaterThan(0);
            });
        });
    });

    describe('Redis integration', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should use Redis for rate limiting when available', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);
            (redisService.atomicIncrementWithExpiry as jest.Mock).mockResolvedValue({
                success: true,
                newValue: 1,
            });

            const limiter = RateLimiters.public;
            const req = { method: 'GET', ip: '192.168.1.1' } as unknown as Request;
            const res = {
                set: jest.fn(),
            } as unknown as Response;
            const next = jest.fn();

            // Act
            await limiter(req, res, next);

            // Assert
            expect(redisService.atomicIncrementWithExpiry).toHaveBeenCalled();
            expect(next).toHaveBeenCalled();
        });

        it('should use memory fallback when Redis fails', async () => {
            // Arrange
            (redisService.isHealthy as jest.Mock).mockResolvedValue(true);
            (redisService.atomicIncrementWithExpiry as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Connection failed',
            });

            const limiter = RateLimiters.public;
            const req = { method: 'GET', ip: '192.168.1.1' } as unknown as Request;
            const res = {
                set: jest.fn(),
            } as unknown as Response;
            const next = jest.fn();

            // Act
            await limiter(req, res, next);

            // Assert
            expect(next).toHaveBeenCalled();
        });
    });
});