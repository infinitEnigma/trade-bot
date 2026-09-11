/**
 * ===========================================
 * 🧪 PROGRESSIVE AUTH LIMITER - Unit Tests
 * ===========================================
 *
 * Tests for exponential backoff implementation for failed authentication
 *
 * @format
 */

import { ProgressiveAuthLimiter, progressiveAuthLimiter } from '../../src/infrastructure/security/rate-limiter/progressive-auth-limiter';
import { redisService } from '../../src/infrastructure';

// Mock Redis service
jest.mock('../../src/infrastructure', () => ({
    ...jest.requireActual('../../src/infrastructure'),
    redisService: {
        atomicReadModifyWrite: jest.fn(),
        setex: jest.fn(),
        del: jest.fn(),
        get: jest.fn(),
    },
}));

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

describe('ProgressiveAuthLimiter', () => {
    describe('Single instance behavior', () => {
        it('should export a singleton instance', () => {
            // Assert
            expect(progressiveAuthLimiter).toBeDefined();
            expect(progressiveAuthLimiter).toBeInstanceOf(ProgressiveAuthLimiter);
        });
    });

    describe('Failure tracking', () => {
        beforeEach(() => {
            // Clear all mocks
            jest.clearAllMocks();
        });

        it('should record authentication failures', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.atomicReadModifyWrite as jest.Mock).mockResolvedValue({
                success: true,
                newValue: 1,
            });
            (redisService.setex as jest.Mock).mockResolvedValue(true);

            // Act
            const result = await progressiveAuthLimiter.recordFailure(identifier);

            // Assert
            expect(redisService.atomicReadModifyWrite).toHaveBeenCalled();
            expect(redisService.setex).toHaveBeenCalled();
            expect(result.totalFailures).toBe(1);
        });

        it('should return default values when Redis operation fails', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.atomicReadModifyWrite as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Connection failed',
            });

            // Act
            const result = await progressiveAuthLimiter.recordFailure(identifier);

            // Assert
            expect(result.totalFailures).toBe(1);
            expect(result.delayMs).toBeGreaterThan(0);
        });

        it('should record success and reset failure count', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.del as jest.Mock).mockResolvedValue(true);

            // Act
            await progressiveAuthLimiter.recordSuccess(identifier);

            // Assert
            expect(redisService.del).toHaveBeenCalled();
        });

        it('should get failure information', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: '3',
            });

            // Act
            const result = await progressiveAuthLimiter.getFailureInfo(identifier);

            // Assert
            expect(result.totalFailures).toBe(3);
            expect(typeof result.delayMs).toBe('number');
        });

        it('should handle Redis errors when getting failure info', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.get as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Connection failed',
            });

            // Act
            const result = await progressiveAuthLimiter.getFailureInfo(identifier);

            // Assert
            expect(result.totalFailures).toBe(0);
            expect(result.delayMs).toBe(0);
        });
    });

    describe('Progressive backoff calculation', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should have no delay for first failure', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.atomicReadModifyWrite as jest.Mock).mockResolvedValue({
                success: true,
                newValue: 1,
            });
            (redisService.setex as jest.Mock).mockResolvedValue(true);

            // Act
            const result = await progressiveAuthLimiter.recordFailure(identifier);

            // Assert
            expect(result.delayMs).toBe(0);
        });

        it('should calculate progressive delay for multiple failures', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.atomicReadModifyWrite as jest.Mock).mockResolvedValue({
                success: true,
                newValue: 5,
            });
            (redisService.setex as jest.Mock).mockResolvedValue(true);

            // Act
            const result = await progressiveAuthLimiter.recordFailure(identifier);

            // Assert - Should be between ~16000ms (16 seconds) with jitter
            expect(result.delayMs).toBeGreaterThan(14000); // ~14 seconds min
            expect(result.delayMs).toBeLessThan(18000); // ~18 seconds max
        });

        it('should cap delay at maximum limit', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.atomicReadModifyWrite as jest.Mock).mockResolvedValue({
                success: true,
                newValue: 10,
            });
            (redisService.setex as jest.Mock).mockResolvedValue(true);

            // Act
            const result = await progressiveAuthLimiter.recordFailure(identifier);

            // Assert - Max delay is 300000ms (5 minutes)
            expect(result.delayMs).toBeLessThanOrEqual(300000);
        });

        it('should increase delay with each failure', async () => {
            // Arrange
            const identifier = 'test:user123';
            const delays = [];

            // Mock different failure counts
            for (let count = 1; count <= 6; count++) {
                (redisService.atomicReadModifyWrite as jest.Mock).mockResolvedValue({
                    success: true,
                    newValue: count,
                });
                (redisService.setex as jest.Mock).mockResolvedValue(true);

                // Act
                const result = await progressiveAuthLimiter.recordFailure(identifier);
                delays.push(result.delayMs);
            }

            // Assert - Each delay should be larger than previous (with jitter tolerance)
            for (let i = 1; i < delays.length; i++) {
                expect(delays[i]).toBeGreaterThan(delays[i - 1] * 0.8); // Allow 20% jitter tolerance
            }
        });
    });

    describe('Backoff management', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should detect if in backoff period', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: '3',
            });

            // Act
            const isInBackoff = await progressiveAuthLimiter.isInBackoff(identifier);

            // Assert
            expect(isInBackoff).toBe(true);
        });

        it('should not be in backoff for first failure', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: '1',
            });

            // Act
            const isInBackoff = await progressiveAuthLimiter.isInBackoff(identifier);

            // Assert
            expect(isInBackoff).toBe(false);
        });

        it('should get current backoff delay', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.get as jest.Mock).mockResolvedValue({
                success: true,
                data: '4',
            });

            // Act
            const delay = await progressiveAuthLimiter.getCurrentDelay(identifier);

            // Assert
            expect(delay).toBeGreaterThan(0);
        });
    });

    describe('Redis operation failures', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should handle Redis errors when recording failure', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.atomicReadModifyWrite as jest.Mock).mockRejectedValue(
                new Error('Redis connection failed')
            );

            // Act & Assert
            await expect(progressiveAuthLimiter.recordFailure(identifier)).resolves.not.toThrow();
        });

        it('should handle Redis errors when recording success', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.del as jest.Mock).mockRejectedValue(
                new Error('Redis connection failed')
            );

            // Act & Assert
            await expect(progressiveAuthLimiter.recordSuccess(identifier)).resolves.not.toThrow();
        });

        it('should handle Redis errors when getting failure info', async () => {
            // Arrange
            const identifier = 'test:user123';

            (redisService.get as jest.Mock).mockRejectedValue(
                new Error('Redis connection failed')
            );

            // Act & Assert
            await expect(progressiveAuthLimiter.getFailureInfo(identifier)).resolves.not.toThrow();
        });
    });
});