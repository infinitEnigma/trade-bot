/**
 * Jest setup file for backend tests
 * Handles comprehensive cleanup of persistent resources to prevent open handles
 */

import { passwordWorkerPool } from './workers/password-worker';
import { botReconciliationWorker } from './workers/bot-reconciliation';
import { credentialCacheService } from './infrastructure/cache/credential-cache.service';
import { errorNotificationService } from './core/notifications/error-notification.service';
import { memoryRateLimiter } from './infrastructure/security/rate-limiter/memory-rate-limiter';
import { cleanupForTests as cleanupDatabasePool, initializePool } from './database/pool';
import { testsLogger as logger } from './core/logging/context-aware-logger.service';

// Extend global interface for test cleanup
declare global {
    var WebSocketInstances: any[];
    var redisClients: any[];
    var dbClients: any[];
    var io: any; // Declare io for test purposes
}

// Only run cleanup in test environment
if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    // Enhanced test environment setup
    beforeAll(async () => {
        try {
            // Set test-specific environment variables
            process.env.NODE_ENV = 'test';
            process.env.TEST_MODE = 'true';
            process.env.TEST_WORKER_POOL_SIZE = '2'; // Smaller pool for tests
            process.env.TEST_DB_TIMEOUT = '5000'; // Shorter timeouts for tests
            process.env.LOG_LEVEL = 'error'; // Only show errors during tests

            // Initialize database pool for tests with test-specific configuration
            initializePool();

        } catch (error) {
            // Don't throw here as tests may skip DB operations
        }
    });

    // Enhanced cleanup after each test to prevent open handles
    /*afterEach(async () => {
        try {
            // Cleanup worker pools first
            //await passwordWorkerPool.cleanupForTests();
            botReconciliationWorker.cleanupForTests();

            // Cleanup other services
            (credentialCacheService as any).cleanupForTests();
            errorNotificationService.cleanupForTests();
            memoryRateLimiter.cleanupForTests();
            await cleanupDatabasePool();

            // Cleanup additional services
            await cleanupAdditionalServices();

            // Additional cleanup for any remaining resources
            await cleanupRemainingResources();

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

        } catch (error) {
            // Don't throw here as it might interfere with test results
        }
    }, 15000); // 15 second timeout for cleanup*/

    // Enhanced cleanup after all tests
    afterAll(async () => {
        try {
            // Final cleanup sequence
            await passwordWorkerPool.cleanupForTests();
            botReconciliationWorker.cleanupForTests();
            (credentialCacheService as any).cleanupForTests();
            errorNotificationService.cleanupForTests();
            memoryRateLimiter.cleanupForTests();
            await cleanupDatabasePool();

            // Cleanup additional services
            await cleanupAdditionalServices();

            // Final cleanup for any remaining resources
            await finalCleanup();

        } catch (error) {
            // Don't throw here as it might interfere with test results
        }
    });
}

/**
 * Cleanup additional services for Jest OpenHandles prevention
 */
async function cleanupAdditionalServices(): Promise<void> {
    try {
        // Import services that need cleanup
        const { marketStreamService } = await import('./infrastructure/messaging/market-stream');
        const { botReconciliationWorker } = await import('./workers/bot-reconciliation');
        const { getAsyncOperationManager } = await import('./infrastructure/async/async-operation-manager.service');
        const { redisService } = await import('./infrastructure/cache/redis.service');

        // Cleanup each service with enhanced error handling
        if (marketStreamService) {
            try {
                logger.debug('Cleaning up MarketStreamService...');
                marketStreamService.cleanupForTests();
                logger.debug('MarketStreamService cleanup completed');
            } catch (error) {
                logger.error('❌ Error cleaning up MarketStreamService:', error as Error);
            }
        }

        if (botReconciliationWorker) {
            try {
                logger.debug('Cleaning up BotReconciliationWorker...');
                botReconciliationWorker.cleanupForTests();
                logger.debug('BotReconciliationWorker cleanup completed');
            } catch (error) {
                logger.error('❌ Error cleaning up BotReconciliationWorker:', error as Error);
            }
        }

        if (getAsyncOperationManager) {
            try {
                logger.debug('Cleaning up AsyncOperationManager...');
                getAsyncOperationManager().cleanupForTests();
                logger.debug('AsyncOperationManager cleanup completed');
            } catch (error) {
                logger.error('❌ Error cleaning up AsyncOperationManager:', error as Error);
            }
        }

        if (redisService && typeof redisService.cleanupForTests === 'function') {
            try {
                logger.debug('Cleaning up RedisService...');
                redisService.cleanupForTests();
                logger.debug('RedisService cleanup completed');
            } catch (error) {
                logger.error('❌ Error cleaning up RedisService:', error as Error);
            }
        }

        // Cleanup credential cache service if it has cleanup method
        if (credentialCacheService && typeof credentialCacheService.cleanupForTests === 'function') {
            try {
                logger.debug('Cleaning up CredentialCacheService...');
                credentialCacheService.cleanupForTests();
                logger.debug('CredentialCacheService cleanup completed');
            } catch (error) {
                logger.error('❌ Error cleaning up CredentialCacheService:', error as Error);
            }
        }

        // Cleanup error notification service if it has cleanup method
        if (errorNotificationService && typeof errorNotificationService.cleanupForTests === 'function') {
            try {
                logger.debug('Cleaning up ErrorNotificationService...');
                errorNotificationService.cleanupForTests();
                logger.debug('ErrorNotificationService cleanup completed');
            } catch (error) {
                logger.error('❌ Error cleaning up ErrorNotificationService:', error as Error);
            }
        }

        // Cleanup memory rate limiter if it has cleanup method
        if (memoryRateLimiter && typeof memoryRateLimiter.cleanupForTests === 'function') {
            try {
                logger.debug('Cleaning up MemoryRateLimiter...');
                memoryRateLimiter.cleanupForTests();
                logger.debug('MemoryRateLimiter cleanup completed');
            } catch (error) {
                logger.error('❌ Error cleaning up MemoryRateLimiter:', error as Error);
            }
        }

        // Additional forceful cleanup for WebSocketManager interval
        // This is a safety net in case the marketStreamService cleanup fails
        try {
            const { WebSocketManager } = await import('./infrastructure/messaging/market-stream/websocket-manager');
            // Note: We can't directly access the singleton's wsManager instance
            // But we can try to force clear any remaining intervals
            logger.debug('Attempting forceful interval cleanup...');

            // Force clear all intervals (this is aggressive but necessary for tests)
            const timers = require('timers');
            const intervalIds = (timers as any)._getActiveIds ? (timers as any)._getActiveIds() : [];
            intervalIds.forEach((id: any) => {
                try {
                    clearInterval(id);
                    logger.debug(`Cleared interval: ${id}`);
                } catch (error) {
                    // Ignore errors when clearing intervals
                }
            });

            // Also clear all timeouts
            const timeoutIds = (timers as any)._getActiveIds ? (timers as any)._getActiveIds() : [];
            timeoutIds.forEach((id: any) => {
                try {
                    clearTimeout(id);
                    logger.debug(`Cleared timeout: ${id}`);
                } catch (error) {
                    // Ignore errors when clearing timeouts
                }
            });

        } catch (intervalCleanupError) {
            logger.error('❌ Error during forceful interval cleanup:', intervalCleanupError as Error);
        }

    } catch (error) {
        logger.error('❌ Error during additional service cleanup:', error as Error);
    }
}

/**
 * Final comprehensive cleanup to ensure all resources are released
 */
async function finalCleanup(): Promise<void> {
    try {
        // Force cleanup of any remaining intervals and timeouts
        const timers = global as any;
        if (timers && timers.clearInterval && timers.clearTimeout) {
            // Clear any remaining intervals (this is a bit aggressive but necessary for tests)
            const originalClearInterval = timers.clearInterval;
            const originalClearTimeout = timers.clearTimeout;

            // Get all active timers (this is a Node.js internal, use with caution)
            if (global.gc) {
                global.gc(); // Force garbage collection if available
            }
        }

        // Cleanup any remaining WebSocket connections
        await cleanupWebSocketConnections();

        // Cleanup any remaining database connections
        await cleanupDatabaseConnections();

        // Cleanup any remaining Redis connections
        await cleanupRedisConnections();

    } catch (error) {
        // Don't throw here as it might interfere with test results
    }
}

/**
 * Cleanup WebSocket connections
 */
async function cleanupWebSocketConnections(): Promise<void> {
    try {
        // Import WebSocket service if available
        const { WebSocketService } = await import('./infrastructure/messaging/websocket.service');

        // Note: WebSocketService is a class, not an instance
        // We need to find any instantiated WebSocket services and clean them up
        // For now, we'll try to access any global WebSocket instances

        // Check for any global WebSocket instances
        if (global.WebSocketInstances) {
            const instances = global.WebSocketInstances as any[];
            for (const instance of instances) {
                if (instance && typeof instance.cleanupForTests === 'function') {
                    instance.cleanupForTests();
                }
            }
            global.WebSocketInstances = [];
        }

        // Cleanup any Socket.IO server instances
        if (global.io) {
            const io = global.io as any;
            if (io && typeof io.disconnectSockets === 'function') {
                io.disconnectSockets(true);
            }
        }

    } catch (error) {
        logger.error('❌ Error cleaning up WebSocket connections:', error as Error);
    }
}

/**
 * Cleanup database connections
 */
async function cleanupDatabaseConnections(): Promise<void> {
    try {
        // Force cleanup of database pool
        await cleanupDatabasePool();

        // Cleanup any remaining PostgreSQL client connections
        const { Pool } = await import('pg');
        // Note: We can't directly access the pool instance here, but the cleanupForTests should handle it

    } catch (error) {
        logger.error('❌ Error cleaning up database connections:', error as Error);
    }
}

/**
 * Cleanup Redis connections
 */
async function cleanupRedisConnections(): Promise<void> {
    try {
        const { redisService } = await import('./infrastructure/cache/redis.service');

        if (redisService && typeof redisService.cleanupForTests === 'function') {
            redisService.cleanupForTests();
        }

        // Cleanup any remaining Redis client connections
        if (global.redisClients) {
            const clients = global.redisClients as any[];
            for (const client of clients) {
                if (client && typeof client.disconnect === 'function') {
                    try {
                        await client.disconnect();
                    } catch (error) {
                        console.warn('Warning: Failed to disconnect Redis client:', error);
                    }
                }
            }
            global.redisClients = [];
        }

        // Cleanup any remaining database client connections
        if (global.dbClients) {
            const clients = global.dbClients as any[];
            for (const client of clients) {
                if (client && typeof client.end === 'function') {
                    try {
                        await client.end();
                    } catch (error) {
                        console.warn('Warning: Failed to end database client:', error);
                    }
                }
            }
            global.dbClients = [];
        }

    } catch (error) {
        logger.error('❌ Error cleaning up Redis connections:', error as Error);
    }
}

/**
 * Cleanup any remaining resources that might be causing open handles
 */
async function cleanupRemainingResources(): Promise<void> {
    try {
        // Cleanup any remaining timers
        const timers = global as any;
        if (timers && timers.clearInterval && timers.clearTimeout) {
            // Force cleanup of any remaining timers
            if (global.gc) {
                global.gc(); // Force garbage collection
            }
        }

        // Cleanup any remaining event listeners
        if (process && process.removeAllListeners) {
            // Remove any remaining process event listeners that might interfere
            const eventsToRemove = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'];
            eventsToRemove.forEach(event => {
                try {
                    process.removeAllListeners(event);
                } catch (error) {
                    // Ignore errors during cleanup
                }
            });
        }

        // Cleanup global variables
        if (global.WebSocketInstances) {
            global.WebSocketInstances = [];
        }
        if (global.redisClients) {
            global.redisClients = [];
        }
        if (global.dbClients) {
            global.dbClients = [];
        }

    } catch (error) {
        // Don't throw here as it might interfere with test results
    }
}

// Export for potential use in individual test files
export {
    passwordWorkerPool,
    credentialCacheService,
    errorNotificationService,
    memoryRateLimiter,
    cleanupDatabasePool,
    cleanupAdditionalServices,
    finalCleanup,
    cleanupRemainingResources
};


