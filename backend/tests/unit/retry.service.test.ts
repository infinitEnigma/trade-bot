/** @format */

import { RetryService, retryService, withRetry, RETRY_CONFIGS, RETRY_CONDITIONS, RetryResult } from '../../src/infrastructure/retry.service';
import { securityLogger as logger } from '../../src/core/logging/context-aware-logger.service';
import { errorNotificationService } from '../../src/core/notifications/error-notification.service';

// Mock dependencies
jest.mock('../../src/core/logging/context-aware-logger.service');
jest.mock('../../src/core/notifications/error-notification.service');

describe('RetryService', () => {
    let retryServiceInstance: RetryService;

    beforeEach(() => {
        retryServiceInstance = new RetryService();
        jest.clearAllMocks();
        // Mock the delay function to resolve immediately
        jest.spyOn(retryServiceInstance as any, 'delay').mockResolvedValue(undefined);
    });

    describe('executeWithRetry', () => {
        it('should succeed on first attempt', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');
            const operationName = 'test-operation';

            const result = await retryServiceInstance.executeWithRetry(mockOperation, operationName);

            expect(result.success).toBe(true);
            expect(result.result).toBe('success');
            expect(result.attempts).toBe(1);
            expect(result.totalDelay).toBe(0);
            expect(result.aborted).toBe(false);
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should retry and succeed on subsequent attempt', async () => {
            const mockOperation = jest.fn()
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValue('success');
            const operationName = 'test-operation';

            const result = await retryServiceInstance.executeWithRetry(mockOperation, operationName, {
                maxAttempts: 2,
                baseDelay: 100,
                jitter: false
            });

            expect(result.success).toBe(true);
            expect(result.result).toBe('success');
            expect(result.attempts).toBe(2);
            expect(mockOperation).toHaveBeenCalledTimes(2);
        });

        it('should fail after maximum attempts', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Network error'));
            const operationName = 'test-operation';

            const result = await retryServiceInstance.executeWithRetry(mockOperation, operationName, {
                maxAttempts: 3,
                baseDelay: 100,
                jitter: false
            });

            expect(result.success).toBe(false);
            expect(result.attempts).toBe(3);
            expect(mockOperation).toHaveBeenCalledTimes(3);
            expect(logger.error).toHaveBeenCalled();
            expect(errorNotificationService.notifyError).toHaveBeenCalled();
        });

        it('should not retry non-retryable errors', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Invalid parameter'));
            const operationName = 'test-operation';

            const result = await retryServiceInstance.executeWithRetry(mockOperation, operationName);

            expect(result.success).toBe(false);
            expect(result.attempts).toBe(1);
            expect(result.totalDelay).toBe(0);
            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalled();
        });

        it('should use custom retryable error function', async () => {
            const customError = new Error('Custom retryable error');
            const mockOperation = jest.fn().mockRejectedValue(customError);
            const operationName = 'test-operation';
            const customRetryable = jest.fn().mockReturnValue(true);

            const result = await retryServiceInstance.executeWithRetry(mockOperation, operationName, {
                maxAttempts: 2,
                retryableErrors: customRetryable
            });

            expect(customRetryable).toHaveBeenCalledWith(customError);
            expect(mockOperation).toHaveBeenCalledTimes(2);
            expect(result.attempts).toBe(2);
        });

        it('should use custom retry configuration', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Network error'));
            const operationName = 'test-operation';

            const result = await retryServiceInstance.executeWithRetry(mockOperation, operationName, {
                maxAttempts: 4,
                baseDelay: 500,
                maxDelay: 5000,
                backoffFactor: 2,
                jitter: false
            });

            expect(result.attempts).toBe(4);
            expect(mockOperation).toHaveBeenCalledTimes(4);
        });

        it('should notify with high severity on final failure', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Network error'));
            const operationName = 'test-operation';

            await retryServiceInstance.executeWithRetry(mockOperation, operationName, {
                maxAttempts: 2,
                baseDelay: 100,
                jitter: false
            });

            expect(errorNotificationService.notifyError).toHaveBeenCalled();
        });
    });

    describe('executeWithCircuitBreaker', () => {
        it('should delegate to executeWithRetry', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');
            const operationName = 'test-operation';
            const circuitBreakerKey = 'test-circuit';

            const spy = jest.spyOn(retryServiceInstance, 'executeWithRetry');

            await retryServiceInstance.executeWithCircuitBreaker(mockOperation, operationName, circuitBreakerKey);

            expect(spy).toHaveBeenCalledWith(
                mockOperation,
                operationName,
                expect.anything()
            );
        });
    });

    describe('withRetry convenience function', () => {
        it('should return result on success', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');
            const operationName = 'test-operation';

            const result = await withRetry(mockOperation, operationName);

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        it('should throw error on failure', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Network error'));
            const operationName = 'test-operation';

            await expect(withRetry(mockOperation, operationName)).rejects.toThrow();
            expect(mockOperation).toHaveBeenCalledTimes(3); // Default max attempts
        });

        it('should use custom retry configuration', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Network error'));
            const operationName = 'test-operation';

            await expect(withRetry(mockOperation, operationName, RETRY_CONFIGS.FAST)).rejects.toThrow();
            expect(mockOperation).toHaveBeenCalledTimes(3);
        });
    });

    describe('RETRY_CONFIGS', () => {
        it('should export predefined retry configurations', () => {
            expect(RETRY_CONFIGS.FAST).toEqual(expect.objectContaining({
                maxAttempts: 3,
                baseDelay: 500,
                maxDelay: 5000,
                backoffFactor: 2,
                jitter: true
            }));

            expect(RETRY_CONFIGS.STANDARD).toEqual(expect.objectContaining({
                maxAttempts: 3,
                baseDelay: 1000,
                maxDelay: 10000,
                backoffFactor: 2,
                jitter: true
            }));

            expect(RETRY_CONFIGS.SLOW).toEqual(expect.objectContaining({
                maxAttempts: 5,
                baseDelay: 2000,
                maxDelay: 30000,
                backoffFactor: 1.5,
                jitter: true
            }));

            expect(RETRY_CONFIGS.AGGRESSIVE).toEqual(expect.objectContaining({
                maxAttempts: 5,
                baseDelay: 1000,
                maxDelay: 60000,
                backoffFactor: 2,
                jitter: true
            }));
        });
    });

    describe('RETRY_CONDITIONS', () => {
        it('should identify network errors', () => {
            const networkError = new Error('Network timeout');
            const nonNetworkError = new Error('Invalid parameter');

            expect(RETRY_CONDITIONS.NETWORK_ERRORS(networkError)).toBe(true);
            expect(RETRY_CONDITIONS.NETWORK_ERRORS(nonNetworkError)).toBe(false);
        });

        it('should identify HTTP errors', () => {
            const http5xxError = new Error('Status code 500');
            const http4xxError = new Error('Status code 404');

            expect(RETRY_CONDITIONS.HTTP_ERRORS(http5xxError)).toBe(true);
            expect(RETRY_CONDITIONS.HTTP_ERRORS(http4xxError)).toBe(false);
        });

        it('should identify database connection errors', () => {
            const dbError = new Error('Connection lost');
            const otherError = new Error('Invalid query');

            expect(RETRY_CONDITIONS.DATABASE_CONNECTION(dbError)).toBe(true);
            expect(RETRY_CONDITIONS.DATABASE_CONNECTION(otherError)).toBe(false);
        });

        it('should identify WebSocket errors', () => {
            const wsError = new Error('WebSocket closed');
            const otherError = new Error('Invalid message');

            expect(RETRY_CONDITIONS.WEBSOCKET_ERRORS(wsError)).toBe(true);
            expect(RETRY_CONDITIONS.WEBSOCKET_ERRORS(otherError)).toBe(false);
        });

        it('should identify combined network and HTTP errors', () => {
            const networkError = new Error('Network timeout');
            const httpError = new Error('Status code 500');
            const otherError = new Error('Invalid parameter');

            expect(RETRY_CONDITIONS.NETWORK_AND_HTTP(networkError)).toBe(true);
            expect(RETRY_CONDITIONS.NETWORK_AND_HTTP(httpError)).toBe(true);
            expect(RETRY_CONDITIONS.NETWORK_AND_HTTP(otherError)).toBe(false);
        });
    });

    describe('isDefaultRetryableError', () => {
        it('should recognize network timeout errors as retryable', async () => {
            const operation = jest.fn().mockRejectedValue(new Error('Timeout'));

            const result = await retryServiceInstance.executeWithRetry(operation, 'test-operation');

            expect(result.attempts).toBe(3);
        });

        it('should recognize connection errors as retryable', async () => {
            const operation = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const result = await retryServiceInstance.executeWithRetry(operation, 'test-operation');

            expect(result.attempts).toBe(3);
        });

        it('should recognize HTTP 5xx errors as retryable', async () => {
            const operation = jest.fn().mockRejectedValue(new Error('Status code 503'));

            const result = await retryServiceInstance.executeWithRetry(operation, 'test-operation');

            expect(result.attempts).toBe(3);
        });

        it('should recognize database connection errors as retryable', async () => {
            const operation = jest.fn().mockRejectedValue(new Error('Connection lost'));

            const result = await retryServiceInstance.executeWithRetry(operation, 'test-operation');

            expect(result.attempts).toBe(3);
        });

        it('should recognize WebSocket errors as retryable', async () => {
            const operation = jest.fn().mockRejectedValue(new Error('WebSocket closed'));

            const result = await retryServiceInstance.executeWithRetry(operation, 'test-operation');

            expect(result.attempts).toBe(3);
        });
    });
});