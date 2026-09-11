/** @format */

import { AsyncOperationManager, getAsyncOperationManager, executeAsync, submitBackgroundJob, resetAsyncOperationManager } from '../../src/infrastructure/async/async-operation-manager.service';
import { getCurrentContext, createChildContext, RequestContext } from '../../src/shared/utils/context';
import { contextLogger } from '../../src/core/logging';

// Mock dependencies
jest.mock('../../src/shared/utils/context', () => ({
    getCurrentContext: jest.fn(),
    createChildContext: jest.fn(),
}));

jest.mock('../../src/core/logging', () => ({
    contextLogger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
    ContextAwareLogger: jest.fn().mockImplementation(() => ({
        startOperation: jest.fn().mockReturnValue({
            success: jest.fn(),
            failure: jest.fn(),
        }),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

describe('AsyncOperationManager', () => {
    let manager: AsyncOperationManager;

    beforeEach(() => {
        // Reset singleton instance
        resetAsyncOperationManager();
        manager = getAsyncOperationManager();
        jest.clearAllMocks();
    });

    describe('instance management', () => {
        it('should create a singleton instance', () => {
            const instance1 = getAsyncOperationManager();
            const instance2 = getAsyncOperationManager();
            expect(instance1).toBe(instance2);
        });

        it('should create new instance after cleanup', () => {
            const instance1 = getAsyncOperationManager();
            manager.cleanupForTests();
            resetAsyncOperationManager();
            const instance2 = getAsyncOperationManager();
            expect(instance1).not.toBe(instance2);
        });
    });

    describe('executeWithContext', () => {
        it('should execute operation without context when none exists', async () => {
            (getCurrentContext as jest.Mock).mockReturnValue(undefined);

            const mockOperation = jest.fn().mockResolvedValue('test-result');
            const result = await manager.executeWithContext('test-operation', mockOperation);

            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(result).toBe('test-result');
            expect(contextLogger.debug).toHaveBeenCalledWith(
                'Executing operation without context: test-operation'
            );
        });

        it('should execute operation with preserved context', async () => {
            const mockContext = {
                correlationId: 'test-correlation-id',
                requestId: 'test-request-id',
                userId: 'test-user-id',
                userLevel: 'admin',
            };
            const mockChildContext = {
                ...mockContext,
                requestId: 'test-child-request-id',
            };

            (getCurrentContext as jest.Mock).mockReturnValue(mockContext);
            (createChildContext as jest.Mock).mockReturnValue(mockChildContext);

            const mockOperation = jest.fn().mockResolvedValue('test-result');
            const result = await manager.executeWithContext('test-operation', mockOperation);

            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(result).toBe('test-result');
        });

        it('should handle operation errors with context preservation', async () => {
            const mockContext = {
                correlationId: 'test-correlation-id',
                requestId: 'test-request-id',
                userId: 'test-user-id',
            };
            const mockChildContext = {
                ...mockContext,
                requestId: 'test-child-request-id',
            };

            (getCurrentContext as jest.Mock).mockReturnValue(mockContext);
            (createChildContext as jest.Mock).mockReturnValue(mockChildContext);

            const mockError = new Error('Test error');
            const mockOperation = jest.fn().mockRejectedValue(mockError);

            await expect(
                manager.executeWithContext('test-operation', mockOperation)
            ).rejects.toThrow(mockError);
        });

        it('should override user context with options', async () => {
            const mockContext = {
                correlationId: 'test-correlation-id',
                requestId: 'test-request-id',
                userId: 'original-user-id',
                userLevel: 'user',
            };

            (getCurrentContext as jest.Mock).mockReturnValue(mockContext);
            (createChildContext as jest.Mock).mockReturnValue({ ...mockContext });

            const mockOperation = jest.fn().mockResolvedValue('test-result');
            await manager.executeWithContext('test-operation', mockOperation, {
                userId: 'override-user-id',
                userLevel: 'admin',
            });

            expect(createChildContext).toHaveBeenCalled();
        });
    });

    describe('background job management', () => {
        it('should submit and execute immediate background job', async () => {
            const mockJobFunction = jest.fn().mockResolvedValue(undefined);
            const jobId = manager.submitJob('test-job', mockJobFunction);

            expect(jobId).toMatch(/^job_\d+_.+$/);
            expect(contextLogger.info).toHaveBeenCalledWith(
                'Background job submitted',
                expect.any(Object)
            );

            // Wait for job to execute
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(mockJobFunction).toHaveBeenCalledTimes(1);
        });

        it('should schedule delayed background job', async () => {
            const mockJobFunction = jest.fn().mockResolvedValue(undefined);
            const delayMs = 50;

            const jobId = manager.submitJob('test-job', mockJobFunction, { delayMs });

            // Check job is scheduled
            const stats = manager.getStats();
            expect(stats.scheduled.count).toBeGreaterThan(0);

            // Wait for delay
            await new Promise(resolve => setTimeout(resolve, delayMs + 10));

            expect(mockJobFunction).toHaveBeenCalledTimes(1);
        });

        it('should cancel queued job', async () => {
            // Mock processJob to not execute immediately
            const processJobSpy = jest.spyOn(manager as any, 'processJob');
            processJobSpy.mockImplementation(jest.fn());

            const mockJobFunction = jest.fn().mockResolvedValue(undefined);
            const jobId = manager.submitJob('test-job', mockJobFunction);

            const cancelled = manager.cancelJob(jobId);
            expect(cancelled).toBe(true);

            // Wait to ensure job isn't executed
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(mockJobFunction).not.toHaveBeenCalled();
        });

        it('should cancel scheduled job', async () => {
            const mockJobFunction = jest.fn().mockResolvedValue(undefined);
            const delayMs = 1000;

            const jobId = manager.submitJob('test-job', mockJobFunction, { delayMs });

            // Verify the job was scheduled
            const stats = manager.getStats();
            expect(stats.scheduled.count).toBe(1);

            // Now cancel the job
            const cancelled = manager.cancelJob(jobId);
            expect(cancelled).toBe(true);

            // Verify the job is no longer scheduled
            const updatedStats = manager.getStats();
            expect(updatedStats.scheduled.count).toBe(0);
        });

        it('should not cancel running job', (done) => {
            const mockJobFunction = jest.fn().mockImplementation(() =>
                new Promise(resolve => setTimeout(resolve, 200))
            );

            const jobId = manager.submitJob('test-job', mockJobFunction);

            // Wait for job to start running
            setTimeout(() => {
                const cancelled = manager.cancelJob(jobId);
                expect(cancelled).toBe(false);

                // Check job is still running
                const jobStatus = manager.getJobStatus(jobId);
                expect(jobStatus?.status).toBe('running');
            }, 50);

            // Wait for job to complete
            setTimeout(() => {
                expect(mockJobFunction).toHaveBeenCalledTimes(1);
                done();
            }, 250);
        });

        it('should get job status', async () => {
            // Mock processJob to not execute immediately
            const processJobSpy = jest.spyOn(manager as any, 'processJob');
            processJobSpy.mockImplementation(jest.fn());

            const mockJobFunction = jest.fn().mockResolvedValue(undefined);
            const jobId = manager.submitJob('test-job', mockJobFunction);

            const jobStatus = manager.getJobStatus(jobId);
            expect(jobStatus).not.toBeNull();
            expect(jobStatus?.id).toBe(jobId);
            expect(jobStatus?.name).toBe('test-job');
            expect(jobStatus?.status).toBe('queued');
        });

        it('should return null for non-existent job status', () => {
            const jobStatus = manager.getJobStatus('non-existent-job-id');
            expect(jobStatus).toBeNull();
        });
    });

    describe('stats and management', () => {
        it('should get operation statistics', async () => {
            const stats = manager.getStats();

            expect(stats.queue).toEqual(expect.any(Object));
            expect(stats.queue.size).toBe(0);
            expect(stats.active).toEqual(expect.any(Object));
            expect(stats.active.count).toBe(0);
            expect(stats.scheduled).toEqual(expect.any(Object));
            expect(stats.scheduled.count).toBe(0);
        });

        it('should track job statistics', async () => {
            manager.submitJob('job1', jest.fn().mockResolvedValue(undefined));
            manager.submitJob('job2', jest.fn().mockResolvedValue(undefined), { delayMs: 1000 });

            const stats = manager.getStats();
            expect(stats.queue.size).toBeGreaterThan(0);
            expect(stats.scheduled.count).toBe(1);
        });

        it('should set max concurrent jobs', () => {
            manager.setMaxConcurrentJobs(5);
            expect(manager['maxConcurrentJobs']).toBe(5);

            // Should not allow less than 1
            manager.setMaxConcurrentJobs(0);
            expect(manager['maxConcurrentJobs']).toBe(1);
        });

        it('should limit concurrent jobs', (done) => {
            const maxConcurrent = 2;
            manager.setMaxConcurrentJobs(maxConcurrent);

            const jobFunctions = [];
            const jobIds = [];

            // Create more jobs than max concurrent
            for (let i = 0; i < 4; i++) {
                const jobFunction = jest.fn().mockImplementation(() =>
                    new Promise(resolve => setTimeout(resolve, 100))
                );
                jobFunctions.push(jobFunction);
                jobIds.push(manager.submitJob(`job-${i}`, jobFunction));
            }

            // Wait for jobs to start
            setTimeout(() => {
                const stats = manager.getStats();
                expect(stats.active.count).toBeLessThanOrEqual(maxConcurrent);
                done();
            }, 50);
        });
    });

    describe('shutdown and cleanup', () => {
        it('should clean up for tests', async () => {
            manager.submitJob('job1', jest.fn().mockResolvedValue(undefined));
            manager.submitJob('job2', jest.fn().mockResolvedValue(undefined), { delayMs: 1000 });

            manager.cleanupForTests();

            const stats = manager.getStats();
            expect(stats.queue.size).toBe(0);
            expect(stats.scheduled.count).toBe(0);
        });

        it('should shut down with timeout', async () => {
            const mockJobFunction = jest.fn().mockImplementation(() =>
                new Promise(resolve => setTimeout(resolve, 100))
            );

            manager.submitJob('test-job', mockJobFunction);

            const startTime = Date.now();
            await manager.shutdown(200);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(300);
        });

        it('should shutdown immediately when no jobs', async () => {
            const startTime = Date.now();
            await manager.shutdown(1000);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100);
        });

        it('should handle shutdown timeout', async () => {
            const mockJobFunction = jest.fn().mockImplementation(() =>
                new Promise(resolve => setTimeout(resolve, 200))
            );

            manager.submitJob('test-job', mockJobFunction);

            const startTime = Date.now();
            await manager.shutdown(100);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(200);
        });
    });

    describe('convenience functions', () => {
        it('should expose executeAsync convenience function', async () => {
            const mockOperation = jest.fn().mockResolvedValue('test-result');
            const result = await executeAsync('test-operation', mockOperation);

            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(result).toBe('test-result');
        });

        it('should expose submitBackgroundJob convenience function', () => {
            const mockJobFunction = jest.fn().mockResolvedValue(undefined);
            const jobId = submitBackgroundJob('test-job', mockJobFunction);

            expect(jobId).toMatch(/^job_\d+_.+$/);
            expect(manager.getJobStatus(jobId)).not.toBeNull();
        });
    });
});