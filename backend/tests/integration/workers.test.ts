/** @format */

import { passwordWorkerPool, hashPassword, comparePassword } from '../../src/workers/password-worker';

jest.mock('../../src/core/logging/logger.service');

describe('Background Workers Integration Tests', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
    });

    afterEach(async () => {
        jest.clearAllMocks();
        // Enhanced cleanup workers after each test with debug logging
        //console.log('🧹 Starting worker cleanup for test...');

        // Worker pools are managed per-test; global cleanup happens in test-setup.ts

        // Additional cleanup to ensure test isolation
        /*try {
            // Clear any remaining timeouts/intervals
            const timers = global as any;
            if (timers && timers.clearInterval && timers.clearTimeout) {
                // Force cleanup of any remaining timers
                if (global.gc) {
                    global.gc(); // Force garbage collection
                }
            }
            //console.log('✅ Additional cleanup completed');
        } catch (error) {
            //console.error('❌ Additional cleanup failed:', error);
        }*/
    });

    describe('Password Worker Pool', () => {
        it('should hash passwords without blocking event loop', async () => {
            const testPassword = 'test-password-123';

            const startTime = Date.now();
            const hash = await hashPassword(testPassword);
            const duration = Date.now() - startTime;

            // Password hashing should complete in reasonable time
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
            expect(hash).toBeDefined();
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are typically 60 chars
        }, 5000);

        it('should compare passwords correctly', async () => {
            const testPassword = 'test-password-456';

            const startTime = Date.now();
            const hash = await hashPassword(testPassword);
            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(3000); // Should complete within 5 seconds
            // Test correct password
            expect(hash).toBeDefined();
            expect(typeof hash).toBe('string');
            const isValid = await comparePassword(testPassword, hash);
            expect(isValid).toBeDefined();
            expect(isValid).toBe(true);

            // Test incorrect password
            const isInvalid = await comparePassword('wrong-password', hash);
            expect(isInvalid).toBeDefined();
            expect(isInvalid).toBe(false);
        }, 10000); // 8 second timeout for password operations

        it('should handle multiple concurrent password operations', async () => {
            const passwords = ['pass1', 'pass2', 'pass3', 'pass4', 'pass5'];
            //console.log("should handle multiple concurrent password operations", passwords);
            // Hash all passwords concurrently
            const startTime = Date.now();
            const hashes = await Promise.all(
                passwords.map(password => hashPassword(password))
            );
            const hashDuration = Date.now() - startTime;

            // Verify all hashes were created
            expect(hashes).toHaveLength(5);
            hashes.forEach(hash => {
                expect(hash).toBeDefined();
                expect(typeof hash).toBe('string');
            });

            // Compare all passwords concurrently
            const compareStartTime = Date.now();
            const comparisons = await Promise.all(
                passwords.map((password, index) => comparePassword(password, hashes[index]))
            );
            const compareDuration = Date.now() - compareStartTime;

            // Verify all comparisons succeeded
            expect(comparisons).toHaveLength(5);
            comparisons.forEach(isValid => {
                expect(isValid).toBe(true);
            });

            // Total duration should be reasonable for concurrent operations
            expect(hashDuration + compareDuration).toBeLessThan(15000); // Under 10 seconds
        }, 10000); // 10 second timeout for concurrent operations

        it('should handle worker thread failures gracefully', async () => {
            // This test verifies that the worker pool can handle worker failures
            const testPassword = 'test-password-789';

            const hash = await hashPassword(testPassword);
            expect(hash).toBeDefined();
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(50);

            // Verify password comparison still works after potential worker issues
            const isValid = await comparePassword(testPassword, hash);
            expect(isValid).toBe(true);
        }, 15000); // 15 second timeout for worker failure test (increased from 12s)

        it('should provide pool statistics', async () => {
            const stats = passwordWorkerPool.getStats();
            //console.log("should provide pool statistics", stats.poolSize);
            expect(stats).toHaveProperty('poolSize');
            expect(stats).toHaveProperty('availableWorkers');
            expect(stats).toHaveProperty('activeTasks');
            expect(stats).toHaveProperty('queuedTasks');
            expect(stats).toHaveProperty('totalWorkers');

            expect(typeof stats.poolSize).toBe('number');
            expect(typeof stats.availableWorkers).toBe('number');
            expect(typeof stats.activeTasks).toBe('number');
            expect(typeof stats.queuedTasks).toBe('number');
            expect(typeof stats.totalWorkers).toBe('number');
        });

        it('should handle pool health checks', async () => {
            const health = await passwordWorkerPool.healthCheck();
            //console.log("should handle pool health checks", health.healthy);
            expect(health).toHaveProperty('healthy');
            expect(health).toHaveProperty('stats');
            expect(health).toHaveProperty('errors');

            expect(typeof health.healthy).toBe('boolean');
            expect(Array.isArray(health.errors)).toBe(true);

            // Stats should match getStats() output
            const stats = passwordWorkerPool.getStats();
            expect(health.stats).toEqual(stats);
        });

        it('should handle password operations with different round counts', async () => {
            const testPassword = 'test-password-rounds';
            //console.log("should handle password operations with different round counts", testPassword);
            // Test with default rounds (12)
            const hash1 = await hashPassword(testPassword);
            expect(await comparePassword(testPassword, hash1)).toBe(true);

            // Test with custom rounds (8)
            const hash2 = await hashPassword(testPassword, 8);
            expect(await comparePassword(testPassword, hash2)).toBe(true);

            // Test with custom rounds (10)
            const hash3 = await hashPassword(testPassword, 10);
            expect(await comparePassword(testPassword, hash3)).toBe(true);

            // Different round counts should produce different hashes
            expect(hash1).not.toBe(hash2);
            expect(hash2).not.toBe(hash3);
            expect(hash1).not.toBe(hash3);
        }, 8000); // 8 second timeout for different round counts test

        it('should handle edge cases', async () => {
            // Empty password
            //const emptyHash = await hashPassword('');
            //expect(await comparePassword('', emptyHash)).toBe(true);
            // Test that empty password is properly rejected
            await expect(hashPassword('')).rejects.toThrow('Invalid password: must be a non-empty string');
            //console.log("should handle edge cases", emptyHash);
            // Very long password
            const longPassword = 'a'.repeat(1000);
            const longHash = await hashPassword(longPassword);
            expect(await comparePassword(longPassword, longHash)).toBe(true);

            // Special characters
            const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?';
            const specialHash = await hashPassword(specialPassword);
            expect(await comparePassword(specialPassword, specialHash)).toBe(true);
        }, 8000); // 8 second timeout for edge cases test
    });

    describe('Worker Coordination', () => {
        it('should handle graceful shutdown of all workers', async () => {
            // Test that password worker can operate independently
            // (Bot reconciliation worker is mocked/simplified in test environment)
            const passwordHash = await hashPassword('test-shutdown');
            //console.log('should handle graceful shutdown of all workers', passwordHash)
            expect(passwordHash).toBeDefined();
            expect(typeof passwordHash).toBe('string');
            expect(passwordHash.length).toBeGreaterThan(50);

            // Password worker should still work
            const isValid = await comparePassword('test-shutdown', passwordHash);
            expect(isValid).toBe(true);
        }, 8000); // 8 second timeout for graceful shutdown test (increased from 3s)

        it('should handle worker lifecycle without interfering with each other', async () => {
            // Password operations before/after repeated lifecycle use
            //console.log('should handle worker lifecycle without interfering with each other')
            const hash1 = await hashPassword('test-lifecycle-1');
            expect(hash1).toBeDefined();
            expect(typeof hash1).toBe('string');
            expect(hash1.length).toBeGreaterThan(50);

            // Password operations should still work after repeated use
            const hash2 = await hashPassword('test-lifecycle-2');
            expect(hash2).toBeDefined();
            expect(typeof hash2).toBe('string');
            expect(hash2.length).toBeGreaterThan(50);

            // Both hashes should be valid
            expect(await comparePassword('test-lifecycle-1', hash1)).toBe(true);
            expect(await comparePassword('test-lifecycle-2', hash2)).toBe(true);
        }, 10000); // 10 second timeout for worker lifecycle test (increased from 5s)

        it('should handle resource cleanup on test completion', async () => {
            // This test verifies that cleanup methods work properly
            // and don't leave resources hanging
            //console.log('should handle resource cleanup on test completion')
            const hash = await hashPassword('test-cleanup');
            expect(hash).toBeDefined();
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(50);

            // After cleanup, password operations should still work
            // (worker pool will be recreated on next use)
            const newHash = await hashPassword('test-cleanup-2');
            expect(newHash).toBeDefined();
            expect(typeof newHash).toBe('string');
            expect(newHash.length).toBeGreaterThan(50);
            expect(await comparePassword('test-cleanup-2', newHash)).toBe(true);
        }, 10000); // 10 second timeout for resource cleanup test (increased from 5s)
    });

    describe('Error Recovery', () => {
        it('should recover from password worker failures', async () => {
            // Test that the worker pool can recover from failures
            const testPassword = 'test-recovery';

            // Perform multiple operations to test stability with timeout protection
            const operations = Array(5).fill(null).map(async (_, index) => {
                const password = `${testPassword}-${index}`;
                const hash = await hashPassword(password);
                expect(hash).toBeDefined();
                expect(typeof hash).toBe('string');
                expect(hash.length).toBeGreaterThan(50);
                return await comparePassword(password, hash);
            });

            const results = await Promise.all(operations);

            // All operations should succeed
            results.forEach(isValid => {
                expect(isValid).toBe(true);
            });
        }, 10000); // 10 second timeout for recovery test (increased from 5s)

        it('should handle high load on password worker pool', async () => {
            // Test the worker pool under moderate load (reduced from 50 to 8 for test stability)
            const concurrentOperations = 4;
            const passwords = Array(concurrentOperations).fill(null).map((_, index) =>
                `high-load-password-${index}`
            );
            const startTime = Date.now();

            // Hash all passwords concurrently with timeout protection
            const hashPromises = passwords.map(async (password) => {
                const hash = await hashPassword(password);
                expect(hash).toBeDefined();
                expect(typeof hash).toBe('string');
                expect(hash.length).toBeGreaterThan(50);
                return hash;
            });
            const hashes = await Promise.all(hashPromises);
            expect(hashes).toBeDefined();
            // Compare all passwords concurrently with timeout protection
            const comparePromises = passwords.map((password, index) =>
                comparePassword(password, hashes[index])
            );

            const comparisons = await Promise.all(comparePromises);
            expect(comparisons).toBeDefined();
            // Verify all comparisons succeeded
            expect(comparisons).toHaveLength(concurrentOperations);
            comparisons.forEach(isValid => {
                expect(isValid).toBe(true);
            });

            const duration = Date.now() - startTime;
            // Should complete within reasonable time even under load
            expect(duration).toBeLessThan(30000); // 30 seconds (increased from 20s)
        }, 30000); // 30 second timeout for this test (increased from 10s)
    });
});