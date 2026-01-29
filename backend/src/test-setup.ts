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
            // Silent cleanup - only log errors
            await passwordWorkerPool.cleanupForTests();
            (credentialCacheService as any).cleanupForTests();
            errorNotificationService.cleanupForTests();
            memoryRateLimiter.cleanupForTests();
            await cleanupDatabasePool();
        } catch (error) {
            console.error('❌ Error during test cleanup:', error);
            // Don't throw here as it might interfere with test results
        }
    });

    // Cleanup after all tests
    afterAll(async () => {
        try {
            // Silent final cleanup - only log errors
            await cleanupDatabasePool();
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