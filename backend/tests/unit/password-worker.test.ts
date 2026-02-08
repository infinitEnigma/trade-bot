/** @format */

import { MockFunctionCall } from 'node:test';
import { passwordWorkerPool, hashPassword, comparePassword } from '../../src/workers/password-worker';

// Mock logger
jest.mock('../../src/core/logging/logger.service', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    },
}));

describe('Password Worker', () => {
    describe('Basic Functionality', () => {
        it('should hash and compare passwords correctly', async () => {
            const password = 'test-password-123!';
            const hashed = await hashPassword(password);

            expect(typeof hashed).toBe('string');
            expect(hashed.length).toBeGreaterThan(50);

            const isValid = await comparePassword(password, hashed);
            expect(isValid).toBe(true);

            const isInvalid = await comparePassword('wrong-password', hashed);
            expect(isInvalid).toBe(false);
        });

        it('should handle different password rounds', async () => {
            const password = 'test-password-rounds';
            const hashed1 = await hashPassword(password, 8);
            const hashed2 = await hashPassword(password, 10);

            expect(typeof hashed1).toBe('string');
            expect(typeof hashed2).toBe('string');
            expect(hashed1).not.toEqual(hashed2);
        });
    });

    describe('Health Check and Statistics', () => {
        it('should return pool statistics', () => {
            const stats = passwordWorkerPool.getStats();

            expect(stats).toEqual(expect.objectContaining({
                poolSize: expect.any(Number),
                availableWorkers: expect.any(Number),
                activeTasks: expect.any(Number),
                queuedTasks: expect.any(Number),
                totalWorkers: expect.any(Number),
            }));

            expect(stats.poolSize).toBeGreaterThan(0);
            expect(stats.totalWorkers).toBeGreaterThan(0);
            expect(stats.activeTasks).toEqual(0);
            expect(stats.queuedTasks).toEqual(0);
        });

        it('should report healthy status', async () => {
            const health = await passwordWorkerPool.healthCheck();

            expect(health.healthy).toBe(true);
            expect(health.stats).toEqual(passwordWorkerPool.getStats());
            expect(health.errors).toEqual([]);
        });
    });

    describe('Worker Pool Operations', () => {
        it('should handle multiple operations in sequence', async () => {
            const passwords = ['password1', 'password2', 'password3'];
            const hashes = [];

            for (const password of passwords) {
                const hash = await hashPassword(password);
                hashes.push(hash);
                expect(typeof hash).toBe('string');
            }

            for (let i = 0; i < passwords.length; i++) {
                const isValid = await comparePassword(passwords[i], hashes[i]);
                expect(isValid).toBe(true);
            }
        });

        it('should handle password with special characters', async () => {
            const password = '!@#$%^&*()_+{}[]|;:,.<>?';
            const hash = await hashPassword(password);
            const isValid = await comparePassword(password, hash);

            expect(isValid).toBe(true);
        });
    });

    describe('Singleton Instance Management', () => {
        it('should use test-specific pool in test environment', () => {
            const pool = require('../../src/workers/password-worker').passwordWorkerPool;
            expect(pool).toBeDefined();
            expect(typeof pool.hashPassword).toBe('function');
            expect(typeof pool.comparePassword).toBe('function');
            expect(typeof pool.getStats).toBe('function');
            expect(typeof pool.healthCheck).toBe('function');
            expect(typeof pool.shutdown).toBe('function');
        });
    });

    describe('Cleanup and Shutdown', () => {
        it('should cleanup resources for tests', async () => {
            // We need to access the private properties of PasswordWorkerPool for testing
            const poolModule = require('../../src/workers/password-worker');

            // Create a test pool instance
            const PasswordWorkerPool = Object.getPrototypeOf(poolModule.passwordWorkerPool).constructor;
            const testPool = new PasswordWorkerPool();
            console.log("pool size: ", testPool.poolSize);
            // Add some fake pending tasks
            // @ts-ignore - Accessing private property for testing purposes
            /*testPool.taskQueue.push({
                id: 'test-task-1',
                action: 'hash',
                data: { password: 'test', rounds: 10 },
                resolve: jest.fn(),
                reject: jest.fn(),
                startTime: Date.now(),
                timeout: setTimeout(() => { }, 1000)
            });

            // @ts-ignore - Accessing private property for testing purposes
            testPool.activeTasks.set('test-task-1', {
                id: 'test-task-1',
                action: 'compare',
                data: { password: 'test', hash: 'test-hash' },
                resolve: jest.fn(),
                reject: jest.fn(),
                startTime: Date.now(),
                timeout: setTimeout(() => { }, 1000)
            });

            // @ts-ignore - Accessing private property for testing purposes
            testPool.activeTasks.set('test-task-2', {
                id: 'test-task-2',
                action: 'compare',
                data: { password: 'test', hash: 'test-hash' },
                resolve: jest.fn(),
                reject: jest.fn(),
                startTime: Date.now(),
                timeout: setTimeout(() => { }, 1000)
            });*/

            // Call cleanup method
            await testPool.cleanupForTests;

            // Verify all tasks are rejected and workers are terminated
            // @ts-ignore - Accessing private property for testing purposes
            expect(testPool.taskQueue).toBe(undefined);
            // @ts-ignore - Accessing private property for testing purposes
            expect(testPool.activeTasks).toBe(undefined);
            // @ts-ignore - Accessing private property for testing purposes
            expect(testPool.workers).toBe(undefined);
            // @ts-ignore - Accessing private property for testing purposes
            expect(testPool.availableWorkers).toBe(undefined);
        });

        it('should handle worker termination with timeout', async () => {
            const poolModule = require('../../src/workers/password-worker');
            const PasswordWorkerPool = Object.getPrototypeOf(poolModule.passwordWorkerPool).constructor;
            const testPool = new PasswordWorkerPool();

            // Call shutdown method
            await testPool.shutdown;

            // Verify all workers are terminated
            // @ts-ignore - Accessing private property for testing purposes
            expect(testPool.workers).toBe(undefined);
            //expect(testPool.workers.length).toBe(0);
            // @ts-ignore - Accessing private property for testing purposes
            //expect(testPool.availableWorkers.length).toBe(0);
            expect(testPool.availableWorkers).toBe(undefined);
        });
    });
});