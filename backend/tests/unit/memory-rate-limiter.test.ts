/**
 * ===========================================
 * 🧪 MEMORY RATE LIMITER - Unit Tests
 * ===========================================
 *
 * Tests for in-memory rate limiter fallback implementation
 *
 * @format
 */

import { MemoryRateLimiter, memoryRateLimiter } from '../../src/infrastructure/security/rate-limiter/memory-rate-limiter';

describe('MemoryRateLimiter', () => {
    describe('Single instance behavior', () => {
        it('should export a singleton instance', () => {
            // Assert
            expect(memoryRateLimiter).toBeDefined();
            expect(memoryRateLimiter).toBeInstanceOf(MemoryRateLimiter);
        });
    });

    describe('Rate limiting functionality', () => {
        let limiter: MemoryRateLimiter;

        beforeEach(() => {
            limiter = new MemoryRateLimiter();
            limiter.clear();
        });

        it('should allow requests under the limit', () => {
            // Arrange
            const key = 'test:123';
            const maxRequests = 5;
            const windowMs = 60000;

            // Act
            const firstResult = limiter.check(key, maxRequests, windowMs);
            const secondResult = limiter.check(key, maxRequests, windowMs);

            // Assert
            expect(firstResult.allowed).toBe(true);
            expect(firstResult.remaining).toBe(maxRequests - 1);
            expect(secondResult.allowed).toBe(true);
            expect(secondResult.remaining).toBe(maxRequests - 2);
        });

        it('should block requests over the limit', () => {
            // Arrange
            const key = 'test:123';
            const maxRequests = 3;
            const windowMs = 60000;

            // Act
            limiter.check(key, maxRequests, windowMs);
            limiter.check(key, maxRequests, windowMs);
            limiter.check(key, maxRequests, windowMs);
            const blockedResult = limiter.check(key, maxRequests, windowMs);

            // Assert
            expect(blockedResult.allowed).toBe(false);
            expect(blockedResult.remaining).toBe(0);
        });

        it('should have correct remaining count', () => {
            // Arrange
            const key = 'test:123';
            const maxRequests = 5;
            const windowMs = 60000;

            // Act
            const results = [];
            for (let i = 0; i < maxRequests; i++) {
                results.push(limiter.check(key, maxRequests, windowMs));
            }

            // Assert
            results.forEach((result, index) => {
                expect(result.remaining).toBe(maxRequests - index - 1);
            });
        });

        it('should track reset time correctly', () => {
            // Arrange
            const key = 'test:123';
            const maxRequests = 5;
            const windowMs = 60000;

            // Act
            const result = limiter.check(key, maxRequests, windowMs);

            // Assert
            expect(result.resetTime).toBeGreaterThan(Date.now());
            expect(result.resetTime).toBeLessThan(Date.now() + windowMs + 1000); // Allow 1 second buffer
        });
    });

    describe('Multiple keys isolation', () => {
        let limiter: MemoryRateLimiter;

        beforeEach(() => {
            limiter = new MemoryRateLimiter();
            limiter.clear();
        });

        it('should isolate rate limits between different keys', () => {
            // Arrange
            const key1 = 'test:123';
            const key2 = 'test:456';
            const maxRequests = 3;
            const windowMs = 60000;

            // Act
            limiter.check(key1, maxRequests, windowMs);
            limiter.check(key1, maxRequests, windowMs);
            limiter.check(key1, maxRequests, windowMs); // key1 hits limit

            const key2Result = limiter.check(key2, maxRequests, windowMs);

            // Assert
            expect(key2Result.allowed).toBe(true);
            expect(key2Result.remaining).toBe(maxRequests - 1);
        });

        it('should handle large number of keys', () => {
            // Arrange
            const maxRequests = 10;
            const windowMs = 60000;
            const keyCount = 100;

            // Act
            for (let i = 0; i < keyCount; i++) {
                const key = `user:${i}`;
                limiter.check(key, maxRequests, windowMs);
            }

            // Assert
            expect(limiter.getStats().activeKeys).toBe(keyCount);
        });
    });

    describe('Statistics gathering', () => {
        let limiter: MemoryRateLimiter;

        beforeEach(() => {
            limiter = new MemoryRateLimiter();
            limiter.clear();
        });

        it('should return initial statistics', () => {
            // Act
            const stats = limiter.getStats();

            // Assert
            expect(stats.activeKeys).toBe(0);
            expect(stats.totalMemoryUsage).toBe(0);
        });

        it('should track active keys count', () => {
            // Arrange
            const maxRequests = 5;
            const windowMs = 60000;

            // Act
            limiter.check('user:1', maxRequests, windowMs);
            limiter.check('user:2', maxRequests, windowMs);
            limiter.check('user:3', maxRequests, windowMs);

            // Assert
            expect(limiter.getStats().activeKeys).toBe(3);
        });

        it('should calculate memory usage estimate', () => {
            // Arrange
            const maxRequests = 5;
            const windowMs = 60000;

            // Act
            limiter.check('user:1', maxRequests, windowMs);
            limiter.check('user:2', maxRequests, windowMs);

            // Assert
            expect(limiter.getStats().totalMemoryUsage).toBeGreaterThan(0);
        });
    });

    describe('Clear functionality', () => {
        let limiter: MemoryRateLimiter;

        beforeEach(() => {
            limiter = new MemoryRateLimiter();
            limiter.clear();
        });

        it('should clear all rate limit entries', () => {
            // Arrange
            limiter.check('user:1', 5, 60000);
            limiter.check('user:2', 5, 60000);

            // Act
            limiter.clear();

            // Assert
            expect(limiter.getStats().activeKeys).toBe(0);
        });

        it('should allow requests after clearing', () => {
            // Arrange
            const key = 'user:1';
            limiter.check(key, 1, 60000);

            // Act
            limiter.clear();
            const result = limiter.check(key, 1, 60000);

            // Assert
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(0);
        });
    });

    describe('Cleanup functionality', () => {
        let limiter: MemoryRateLimiter;

        beforeEach(() => {
            limiter = new MemoryRateLimiter();
            limiter.clear();
        });

        it('should automatically clean up expired entries', (done) => {
            // Arrange
            const key = 'expired:test';
            const maxRequests = 5;
            const windowMs = 100; // 100ms window

            // Act
            limiter.check(key, maxRequests, windowMs);

            // Wait for window to expire
            setTimeout(() => {
                try {
                    // Force cleanup
                    // @ts-ignore - access private method for testing
                    limiter.cleanup();

                    const stats = limiter.getStats();
                    expect(stats.activeKeys).toBe(0);
                    done();
                } catch (error) {
                    done(error);
                }
            }, windowMs + 50); // Wait for window + buffer
        });

        it('should handle cleanup without expired entries', () => {
            // Arrange
            limiter.check('active:1', 5, 60000);

            // Act
            // @ts-ignore - access private method for testing
            limiter.cleanup();

            // Assert
            expect(limiter.getStats().activeKeys).toBe(1);
        });
    });

    describe('Instance management', () => {
        it('should destroy instance and clean up resources', () => {
            // Arrange
            const limiter = new MemoryRateLimiter();

            // Act
            limiter.destroy();

            // Assert - Verify instance can still be used (though cleanup interval is cleared)
            expect(() => limiter.check('test', 5, 60000)).not.toThrow();
        });

        it('should clean up for test environments', () => {
            // Arrange
            const limiter = new MemoryRateLimiter();

            // Act
            limiter.cleanupForTests();

            // Assert
            expect(limiter.getStats().activeKeys).toBe(0);
        });
    });
});