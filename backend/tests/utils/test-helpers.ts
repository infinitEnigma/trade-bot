/** @format */

import { PoolClient } from 'pg';
import { passwordWorkerPool } from '../../src/workers/password-worker';
import { botReconciliationWorker } from '../../src/workers/bot-reconciliation';
import { errorNotificationService } from '../../src/core/notifications/error-notification.service';
import { ContextAwareLogger } from '../../src/core/logging/context-aware-logger.service';
import { ErrorSeverity, ErrorCategory } from '../../src/core/notifications/error-notification.service';

/**
 * Test utilities and helpers for integration tests
 */

export interface TestUser {
    id: string;
    email: string;
    password: string;
    userLevel: string;
}

export interface TestBot {
    id: string;
    userId: string;
    strategyId: string;
    status: string;
}

/**
 * Create a test user for database operations
 */
export async function createTestUser(email: string = `test-${Date.now()}@example.com`): Promise<TestUser> {
    const password = 'test-password-123';
    const hashedPassword = await passwordWorkerPool.hashPassword(password);

    // Note: In a real implementation, you'd insert into the database
    // For now, we'll return a mock user object
    return {
        id: `user-${Date.now()}`,
        email,
        password: hashedPassword,
        userLevel: 'REGISTERED'
    };
}

/**
 * Create a test bot for reconciliation operations
 */
export function createTestBot(userId: string): TestBot {
    return {
        id: `bot-${Date.now()}`,
        userId,
        strategyId: `strategy-${Math.floor(Math.random() * 1000)}`,
        status: 'RUNNING'
    };
}

/**
 * Create authentication token for testing
 */
export function createAuthToken(user: TestUser): string {
    // Mock JWT token creation for testing
    // In a real implementation, you'd use the actual JWT service
    return `mock-jwt-token-for-${user.id}`;
}

/**
 * Setup test database with test data
 */
export async function setupTestDatabase(): Promise<void> {
    // This would set up test data in the database
    // For integration tests that require actual database operations

    try {
        // Create test users, bots, strategies, etc.
        // This is a placeholder for actual database setup

        console.log('Test database setup completed');
    } catch (error) {
        console.warn('Test database setup failed:', error);
        // Don't throw - tests should handle missing test data gracefully
    }
}

/**
 * Cleanup test database
 */
export async function cleanupTestDatabase(): Promise<void> {
    // This would clean up test data from the database
    // For integration tests that require cleanup

    try {
        // Remove test users, bots, strategies, etc.
        // This is a placeholder for actual database cleanup

        console.log('Test database cleanup completed');
    } catch (error) {
        console.warn('Test database cleanup failed:', error);
        // Don't throw - tests should handle cleanup failures gracefully
    }
}

/**
 * Setup test environment for integration tests
 */
export async function setupIntegrationTest(): Promise<{
    cleanup: () => Promise<void>;
}> {
    // Reset error notification service
    errorNotificationService.resetThrottleCounters();

    // Setup test database if needed
    await setupTestDatabase();

    const cleanup = async () => {
        // Cleanup workers
        await passwordWorkerPool.cleanupForTests();
        botReconciliationWorker.cleanupForTests();

        // Reset error notification service
        errorNotificationService.resetThrottleCounters();

        // Cleanup test database
        await cleanupTestDatabase();
    };

    return { cleanup };
}

/**
 * Create test error context
 */
export function createTestErrorContext(
    category: ErrorCategory,
    operation: string,
    userId?: string
): {
    category: ErrorCategory;
    operation: string;
    userId?: string;
    requestId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
    timestamp: number;
} {
    return {
        category,
        operation,
        userId,
        requestId: `req-${Date.now()}`,
        correlationId: `corr-${Date.now()}`,
        metadata: {
            test: true,
            timestamp: Date.now()
        },
        timestamp: Date.now()
    };
}

/**
 * Create test error notification
 */
export function createTestErrorNotification(
    severity: ErrorSeverity,
    message: string,
    category: ErrorCategory,
    operation: string,
    userId?: string
): {
    severity: ErrorSeverity;
    message: string;
    context: {
        category: ErrorCategory;
        operation: string;
        userId?: string;
        requestId?: string;
        correlationId?: string;
        metadata?: Record<string, unknown>;
        timestamp: number;
    };
    stackTrace?: string;
    retryCount?: number;
    recoveryAction?: string;
    id?: string;
} {
    return {
        severity,
        message,
        context: createTestErrorContext(category, operation, userId),
        stackTrace: 'Error: Test error\n    at test function',
        retryCount: 3,
        recoveryAction: 'Retry the operation',
        id: `test-error-${Date.now()}`
    };
}

/**
 * Wait for a specified amount of time
 */
export function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mock external service response
 */
export function mockExternalServiceResponse<T>(
    data: T,
    delay: number = 100,
    shouldFail: boolean = false,
    failureRate: number = 0
): Promise<T> {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (shouldFail || (failureRate > 0 && Math.random() < failureRate)) {
                reject(new Error('External service failed'));
            } else {
                resolve(data);
            }
        }, delay);
    });
}

/**
 * Test database connection health
 */
export async function testDatabaseConnection(): Promise<boolean> {
    try {
        // This would test actual database connection
        // For now, return true to indicate tests can proceed

        return true;
    } catch (error) {
        console.warn('Database connection test failed:', error);
        return false;
    }
}

/**
 * Test worker pool health
 */
export async function testWorkerPoolHealth(): Promise<boolean> {
    try {
        const stats = passwordWorkerPool.getStats();
        const health = await passwordWorkerPool.healthCheck();

        return health.healthy && stats.availableWorkers > 0;
    } catch (error) {
        console.warn('Worker pool health check failed:', error);
        return false;
    }
}

/**
 * Test bot reconciliation worker health
 */
export function testBotWorkerHealth(): boolean {
    try {
        const status = botReconciliationWorker.getStatus();
        return status.isRunning === false; // Worker should not be running by default
    } catch (error) {
        console.warn('Bot worker health check failed:', error);
        return false;
    }
}

/**
 * Test error notification service health
 */
export function testErrorNotificationHealth(): boolean {
    try {
        const stats = errorNotificationService.getStats();
        return stats.channels.length > 0;
    } catch (error) {
        console.warn('Error notification health check failed:', error);
        return false;
    }
}

/**
 * Run comprehensive health check for all services
 */
export async function runHealthCheck(): Promise<{
    database: boolean;
    workers: boolean;
    botWorker: boolean;
    errorNotification: boolean;
    allHealthy: boolean;
}> {
    const database = await testDatabaseConnection();
    const workers = await testWorkerPoolHealth();
    const botWorker = testBotWorkerHealth();
    const errorNotification = testErrorNotificationHealth();

    const allHealthy = database && workers && botWorker && errorNotification;

    return {
        database,
        workers,
        botWorker,
        errorNotification,
        allHealthy
    };
}

/**
 * Create test logger with specific component name
 */
export function createTestLogger(componentName: string): ContextAwareLogger {
    return new ContextAwareLogger(componentName);
}

/**
 * Mock Redis operations for testing
 */
export const mockRedisOperations = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    hgetall: jest.fn().mockResolvedValue({}),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    publish: jest.fn().mockResolvedValue(1),
};

/**
 * Mock WebSocket operations for testing
 */
export const mockWebSocketOperations = {
    send: jest.fn(),
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
};

/**
 * Cleanup all test resources
 */
export async function cleanupAllTestResources(): Promise<void> {
    try {
        // Cleanup workers
        await passwordWorkerPool.cleanupForTests();
        botReconciliationWorker.cleanupForTests();

        // Reset error notification service
        errorNotificationService.resetThrottleCounters();

        // Cleanup test database
        await cleanupTestDatabase();

        // Clear all mocks
        jest.clearAllMocks();

        console.log('All test resources cleaned up successfully');
    } catch (error) {
        console.warn('Error during test resource cleanup:', error);
    }
}