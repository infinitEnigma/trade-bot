/**
 * Jest setup file for backend tests
 * Handles cleanup of persistent resources to prevent open handles
 */

import { passwordWorkerPool } from './workers/password-worker';
import { credentialCacheService } from './infrastructure/cache/credential-cache.service';
import { errorNotificationService } from './core/notifications/error-notification.service';
import { memoryRateLimiter } from './infrastructure/security/rate-limiter/memory-rate-limiter';
import { cleanupForTests as cleanupDatabasePool } from './database/pool';

// Only run cleanup in test environment
if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    // Cleanup after each test to prevent open handles
    afterEach(async () => {
        try {
            console.log('🧹 Cleaning up test resources...');

            // Cleanup password worker pool
            await passwordWorkerPool.cleanupForTests();
            console.log('✅ Password worker pool cleaned up');

            // Cleanup credential cache service
            (credentialCacheService as any).cleanupForTests();
            console.log('✅ Credential cache service cleaned up');

            // Cleanup error notification service
            errorNotificationService.cleanupForTests();
            console.log('✅ Error notification service cleaned up');

            // Cleanup memory rate limiter
            memoryRateLimiter.cleanupForTests();
            console.log('✅ Memory rate limiter cleaned up');

            // Cleanup database pool
            await cleanupDatabasePool();
            console.log('✅ Database pool cleaned up');

            console.log('🎉 All test resources cleaned up successfully');
        } catch (error) {
            console.error('❌ Error during test cleanup:', error);
            // Don't throw here as it might interfere with test results
        }
    });

    // Cleanup after all tests
    afterAll(async () => {
        try {
            console.log('🧹 Final cleanup after all tests...');

            // Additional cleanup if needed
            await cleanupDatabasePool();

            console.log('🎉 Final cleanup completed');
        } catch (error) {
            console.error('❌ Error during final cleanup:', error);
        }
    });
}

// Export for potential use in individual test files
export {
    passwordWorkerPool,
    credentialCacheService,
    errorNotificationService,
    memoryRateLimiter,
    cleanupDatabasePool
};