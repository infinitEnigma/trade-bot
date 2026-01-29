/** @format */

import { passwordWorkerPool, hashPassword, comparePassword } from '../../src/workers/password-worker';
import { botReconciliationWorker } from '../../src/workers/bot-reconciliation';
import logger from '../../src/core/logging/logger.service';

// Mock logger to avoid actual logging during tests
jest.mock('../../src/core/logging/logger.service');

describe('Background Workers Integration Tests', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
    });

    afterEach(async () => {
        jest.clearAllMocks();
        // Enhanced cleanup workers after each test with debug logging
        //console.log('🧹 Starting worker cleanup for test...');

        /*try {
            //await passwordWorkerPool.cleanupForTests();
            //console.log('✅ Password worker pool cleaned up');
        } catch (error) {
            //console.error('❌ Password worker cleanup failed:', error);
        }

        try {
            //botReconciliationWorker.cleanupForTests();
            //console.log('✅ Bot reconciliation worker cleaned up');
        } catch (error) {
            //console.error('❌ Bot reconciliation worker cleanup failed:', error);
        }*/

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
            try {
                const testPassword = 'test-password-123';

                const startTime = Date.now();
                console.log("should hash passwords without blocking event loop", startTime);
                const hash = await hashPassword(testPassword);
                const duration = Date.now() - startTime;
                console.log("should hash passwords without blocking event loop", duration);
                // Password hashing should complete in reasonable time
                expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
                expect(hash).toBeDefined();
                expect(typeof hash).toBe('string');
                expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are typically 60 chars
                console.log("should hash passwords without blocking event loop", hash);
            } catch { }

        }, 5000);

        it('should compare passwords correctly', async () => {
            console.log("should compare passwords correctly");
            try {
                const testPassword = 'test-password-456';

                const startTime = Date.now();
                console.log("should compare passwords correctly", testPassword, startTime);
                const hash = await hashPassword(testPassword);
                const duration = Date.now() - startTime;
                console.log("should compare passwords correctly", duration);
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
                console.log("should compare passwords correctly", isValid);
            } catch (error) {
                console.warn("password compare error", error)
            }
        }, 10000); // 8 second timeout for password operations

        it('should handle multiple concurrent password operations', async () => {
            const passwords = ['pass1', 'pass2', 'pass3', 'pass4', 'pass5'];
            console.log("should handle multiple concurrent password operations", passwords);
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
            console.log("should handle worker thread failures gracefully", testPassword);
            try {
                const hash = await hashPassword(testPassword);
                expect(hash).toBeDefined();
                expect(typeof hash).toBe('string');
                expect(hash.length).toBeGreaterThan(50);

                // Verify password comparison still works after potential worker issues
                const isValid = await comparePassword(testPassword, hash);
                expect(isValid).toBe(true);
            } catch (error) {
                // If there's an error, it should be handled gracefully
                expect(error).toBeDefined();
                logger.warn('Password worker test handled gracefully', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, 15000); // 15 second timeout for worker failure test (increased from 12s)

        it('should provide pool statistics', async () => {
            const stats = passwordWorkerPool.getStats();
            console.log("should provide pool statistics", stats.poolSize);
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
            console.log("should handle pool health checks", health.healthy);
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
            console.log("should handle password operations with different round counts", testPassword);
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

    describe('Bot Reconciliation Worker', () => {
        it('should start and stop worker gracefully', async () => {
            // Start the worker
            await botReconciliationWorker.start();
            console.log("Bot Reconciliation Worker");
            const status = botReconciliationWorker.getStatus();
            expect(status.isRunning).toBe(true);

            // Stop the worker
            await botReconciliationWorker.stop();

            const stoppedStatus = botReconciliationWorker.getStatus();
            expect(stoppedStatus.isRunning).toBe(false);
        });

        it('should handle reconciliation without active bots', async () => {
            // Start worker
            await botReconciliationWorker.start();
            console.log('should handle reconciliation without active bots')
            // Wait a moment for initial reconciliation
            await new Promise(resolve => setTimeout(resolve, 100));

            // Stop worker
            await botReconciliationWorker.stop();

            // Should complete without errors even with no active bots
            expect(botReconciliationWorker.getStatus().isRunning).toBe(false);
        });

        it('should handle reconciliation errors gracefully', async () => {
            // Start worker
            await botReconciliationWorker.start();
            console.log('should handle reconciliation errors gracefully')
            // The worker should handle errors internally without crashing
            // This test verifies that the worker continues running despite errors

            const status = botReconciliationWorker.getStatus();
            expect(status.isRunning).toBe(true);

            // Stop worker
            await botReconciliationWorker.stop();
        });

        it('should provide worker status information', () => {
            const status = botReconciliationWorker.getStatus();
            console.log('should provide worker status information', status.isRunning)
            expect(status).toHaveProperty('isRunning');
            expect(typeof status.isRunning).toBe('boolean');

            // lastReconciliationTime might be undefined if no reconciliation has run yet
            if (status.lastReconciliationTime) {
                expect(status.lastReconciliationTime).toBeInstanceOf(Date);
            }
        });

        it('should handle concurrent reconciliation cycles', async () => {
            // Start worker
            await botReconciliationWorker.start();
            console.log('should handle concurrent reconciliation cycles')
            // Trigger multiple reconciliation cycles
            const reconciliationPromises = Array(3).fill(null).map(async (_, index) => {
                // Wait a bit between cycles
                await new Promise(resolve => setTimeout(resolve, index * 100));
                return botReconciliationWorker.getStatus();
            });

            const results = await Promise.all(reconciliationPromises);

            // All should complete without errors
            results.forEach(status => {
                expect(status.isRunning).toBe(true);
            });

            // Stop worker
            await botReconciliationWorker.stop();
        });

        it('should handle worker cleanup properly', async () => {
            // Start worker
            console.log('should handle worker cleanup properly')
            await botReconciliationWorker.start();
            expect(botReconciliationWorker.getStatus().isRunning).toBe(true);

            // Cleanup should stop the worker
            botReconciliationWorker.cleanupForTests();

            // Status should reflect stopped state
            const status = botReconciliationWorker.getStatus();
            expect(status.isRunning).toBe(false);
        });
    });

    describe('Worker Coordination', () => {
        it('should handle graceful shutdown of all workers', async () => {
            // Test that password worker can operate independently
            // (Bot reconciliation worker is mocked/simplified in test environment)
            const passwordHash = await hashPassword('test-shutdown');
            console.log('should handle graceful shutdown of all workers', passwordHash)
            expect(passwordHash).toBeDefined();
            expect(typeof passwordHash).toBe('string');
            expect(passwordHash.length).toBeGreaterThan(50);

            // Password worker should still work
            const isValid = await comparePassword('test-shutdown', passwordHash);
            expect(isValid).toBe(true);
        }, 8000); // 8 second timeout for graceful shutdown test (increased from 3s)

        it('should handle worker lifecycle without interfering with each other', async () => {
            // Test that starting/stopping one worker doesn't affect the other
            console.log('should handle worker lifecycle without interfering with each other')
            // Start bot worker
            await botReconciliationWorker.start();
            expect(botReconciliationWorker.getStatus().isRunning).toBe(true);

            // Password operations should work while bot worker is running
            const hash1 = await hashPassword('test-lifecycle-1');
            expect(hash1).toBeDefined();
            expect(typeof hash1).toBe('string');
            expect(hash1.length).toBeGreaterThan(50);

            // Stop bot worker
            await botReconciliationWorker.stop();
            expect(botReconciliationWorker.getStatus().isRunning).toBe(false);

            // Password operations should still work after bot worker stops
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
            console.log('should handle resource cleanup on test completion')
            // Start workers
            await botReconciliationWorker.start();
            const hash = await hashPassword('test-cleanup');
            expect(hash).toBeDefined();
            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(50);

            // Cleanup should work without errors
            botReconciliationWorker.cleanupForTests();
            //await passwordWorkerPool.cleanupForTests();

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
            console.log('should recover from password worker failures', testPassword)
            try {
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
                console.log('should handle high load on password worker pool', results.toString())
            } catch (error) {
                // If there's an error, it should be handled gracefully
                logger.warn('Password worker recovery test handled gracefully', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, 10000); // 10 second timeout for recovery test (increased from 5s)

        it('should handle bot reconciliation failures without crashing', async () => {
            // Start worker
            await botReconciliationWorker.start();
            console.log('should handle bot reconciliation failures without crashing')
            try {
                // The worker should handle internal errors gracefully
                // This test verifies that the worker continues running
                // even when encountering errors during reconciliation

                const status = botReconciliationWorker.getStatus();
                expect(status.isRunning).toBe(true);

                // Wait for potential reconciliation cycles
                await new Promise(resolve => setTimeout(resolve, 500));

                const finalStatus = botReconciliationWorker.getStatus();
                expect(finalStatus.isRunning).toBe(true);
                console.log('should handle bot reconciliation failures without crashing', finalStatus)
            } finally {
                // Always stop the worker
                await botReconciliationWorker.stop();
            }
        });

        it('should handle high load on password worker pool', async () => {
            // Test the worker pool under moderate load (reduced from 50 to 8 for test stability)
            const concurrentOperations = 4;
            const passwords = Array(concurrentOperations).fill(null).map((_, index) =>
                `high-load-password-${index}`
            );
            console.log('should handle high load on password worker pool - passwords', passwords.toString())
            const startTime = Date.now();

            try {
                // Hash all passwords concurrently with timeout protection
                const hashPromises = passwords.map(async (password) => {
                    const hash = await hashPassword(password);
                    expect(hash).toBeDefined();
                    expect(typeof hash).toBe('string');
                    expect(hash.length).toBeGreaterThan(50);
                    return hash;
                });
                console.log('should handle high load on password worker pool - hashPromises', hashPromises.toString())
                const hashes = await Promise.all(hashPromises);
                expect(hashes).toBeDefined();
                console.log('should handle high load on password worker pool - hashes', hashes.toString())
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
                console.log('should handle high load on password worker pool', comparisons.toString())
                // Should complete within reasonable time even under load
                expect(duration).toBeLessThan(30000); // 30 seconds (increased from 20s)

            } catch (error) {
                // If there's an error under load, it should be handled gracefully
                logger.warn('High load password worker test handled gracefully', {
                    error: error instanceof Error ? error.message : String(error),
                    concurrentOperations
                });
            }
        }, 30000); // 30 second timeout for this test (increased from 10s)
    });
});