/** @format */

import { RedisConnectionManager } from '../../src/infrastructure/cache/redis/connection-manager';
import { createClient } from 'redis';

// Mock dependencies
jest.mock('redis', () => ({
    createClient: jest.fn(),
}));

jest.mock('../../src/core/logging');

describe('RedisConnectionManager', () => {
    let mockClient: any;
    let connectionManager: RedisConnectionManager;

    beforeEach(() => {
        // Reset all modules to ensure fresh instance
        jest.clearAllMocks();

        // Create mock client
        mockClient = {
            on: jest.fn(),
            connect: jest.fn(),
            disconnect: jest.fn(),
            select: jest.fn(),
            ping: jest.fn(),
            isOpen: false,
        };

        (createClient as jest.Mock).mockReturnValue(mockClient);

        // Create connection manager instance
        connectionManager = new RedisConnectionManager({
            url: 'redis://localhost:6379',
            database: 1,
            retryDelay: 100,
            maxRetries: 2,
        });
    });

    describe('instance creation', () => {
        it('should create an instance of RedisConnectionManager', () => {
            expect(connectionManager).toBeInstanceOf(RedisConnectionManager);
        });

        it('should initialize with default configuration', () => {
            const defaultManager = new RedisConnectionManager();
            expect(defaultManager).toBeInstanceOf(RedisConnectionManager);
        });

        it('should use process.env.REDIS_URL when no URL is provided', () => {
            const testUrl = 'redis://env:6379';
            const originalEnv = process.env.REDIS_URL;
            process.env.REDIS_URL = testUrl;

            const manager = new RedisConnectionManager();

            expect(manager.getConfig().url).toBe(testUrl);

            process.env.REDIS_URL = originalEnv;
        });

        it('should fallback to default URL when process.env.REDIS_URL is not set', () => {
            const originalEnv = process.env.REDIS_URL;
            delete process.env.REDIS_URL;

            const manager = new RedisConnectionManager();

            expect(manager.getConfig().url).toBe('redis://localhost:6379');

            process.env.REDIS_URL = originalEnv;
        });

        it('should initialize with custom configuration', () => {
            const customConfig = {
                url: 'redis://custom:6379',
                database: 5,
                retryDelay: 500,
                maxRetries: 5,
            };
            const manager = new RedisConnectionManager(customConfig);
            expect(manager.getConfig()).toEqual(customConfig);
        });
    });

    describe('event handlers', () => {
        it('should setup error event handler', () => {
            expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
        });

        it('should handle error event', () => {
            // Get the error handler from the mock
            const errorHandler = (mockClient.on as jest.Mock).mock.calls.find(
                (call: any[]) => call[0] === 'error'
            )?.[1];

            expect(errorHandler).toBeDefined();

            const testError = new Error('Connection error');
            errorHandler(testError);

            const health = connectionManager.getHealth();
            expect(health.connected).toBe(false);
            expect(health.ready).toBe(false);
            expect(health.lastError).toBe(testError.message);
        });

        it('should handle connect event', () => {
            const connectHandler = (mockClient.on as jest.Mock).mock.calls.find(
                (call: any[]) => call[0] === 'connect'
            )?.[1];

            expect(connectHandler).toBeDefined();

            connectHandler();

            const health = connectionManager.getHealth();
            expect(health.connected).toBe(true);
            expect(health.lastConnected).toBeDefined();
        });

        it('should handle ready event', () => {
            const readyHandler = (mockClient.on as jest.Mock).mock.calls.find(
                (call: any[]) => call[0] === 'ready'
            )?.[1];

            expect(readyHandler).toBeDefined();

            readyHandler();

            const health = connectionManager.getHealth();
            expect(health.ready).toBe(true);
        });

        it('should handle end event', () => {
            const endHandler = (mockClient.on as jest.Mock).mock.calls.find(
                (call: any[]) => call[0] === 'end'
            )?.[1];

            expect(endHandler).toBeDefined();

            endHandler();

            const health = connectionManager.getHealth();
            expect(health.connected).toBe(false);
            expect(health.ready).toBe(false);
        });
    });

    describe('connect method', () => {
        it('should connect to Redis successfully', async () => {
            mockClient.isOpen = false;
            mockClient.connect.mockResolvedValue();
            mockClient.select.mockResolvedValue();

            await connectionManager.connect();

            expect(mockClient.connect).toHaveBeenCalled();
            expect(mockClient.select).toHaveBeenCalledWith(1);
        });

        it('should return early if already connected', async () => {
            mockClient.isOpen = true;

            await connectionManager.connect();

            expect(mockClient.connect).not.toHaveBeenCalled();
        });

        it('should retry connection on failure', async () => {
            mockClient.isOpen = false;
            const testError = new Error('Connection failed');
            mockClient.connect.mockRejectedValueOnce(testError); // First attempt fails
            mockClient.connect.mockResolvedValueOnce(); // Second attempt succeeds
            mockClient.select.mockResolvedValue();

            await connectionManager.connect();

            expect(mockClient.connect).toHaveBeenCalledTimes(2);
        });

        it('should throw error when all retries fail', async () => {
            mockClient.isOpen = false;
            const testError = new Error('Connection failed');
            mockClient.connect.mockRejectedValue(testError);
            mockClient.select.mockResolvedValue();

            await expect(connectionManager.connect()).rejects.toThrow(
                'Failed to connect to Redis after 2 attempts'
            );

            expect(mockClient.connect).toHaveBeenCalledTimes(2);
        });
    });

    describe('disconnect method', () => {
        it('should disconnect from Redis', async () => {
            mockClient.isOpen = true;
            mockClient.disconnect.mockResolvedValue();

            await connectionManager.disconnect();

            expect(mockClient.disconnect).toHaveBeenCalled();
        });

        it('should return early if already disconnected', async () => {
            mockClient.isOpen = false;

            await connectionManager.disconnect();

            expect(mockClient.disconnect).not.toHaveBeenCalled();
        });

        it('should handle disconnect error', async () => {
            mockClient.isOpen = true;
            const testError = new Error('Disconnect failed');
            mockClient.disconnect.mockRejectedValue(testError);

            await expect(connectionManager.disconnect()).rejects.toThrow(testError);
        });
    });

    describe('reconnect method', () => {
        it('should force reconnect', async () => {
            const disconnectSpy = jest.spyOn(connectionManager as any, 'disconnect').mockResolvedValue(undefined);
            const connectSpy = jest.spyOn(connectionManager as any, 'connect').mockResolvedValue(undefined);

            await connectionManager.reconnect();

            expect(disconnectSpy).toHaveBeenCalled();
            expect(connectSpy).toHaveBeenCalled();
        });

        it('should handle disconnect error during reconnect', async () => {
            const testError = new Error('Disconnect failed');
            jest.spyOn(connectionManager as any, 'disconnect').mockRejectedValue(testError);
            const connectSpy = jest.spyOn(connectionManager as any, 'connect').mockResolvedValue(undefined);

            await connectionManager.reconnect();

            expect(connectSpy).toHaveBeenCalled();
        });
    });

    describe('database operations', () => {
        it('should select database', async () => {
            mockClient.select.mockResolvedValue();

            await connectionManager.selectDatabase(5);

            expect(mockClient.select).toHaveBeenCalledWith(5);
            expect(connectionManager.getHealth().database).toBe(5);
        });

        it('should handle database selection error', async () => {
            const testError = new Error('Database selection failed');
            mockClient.select.mockRejectedValue(testError);

            await expect(connectionManager.selectDatabase(5)).rejects.toThrow(testError);
        });
    });

    describe('health check', () => {
        it('should return false when not connected', async () => {
            // Access the actual health object directly
            (connectionManager as any).health.connected = false;
            (connectionManager as any).health.ready = false;

            const result = await connectionManager.isHealthy();

            expect(result).toBe(false);
            expect(mockClient.ping).not.toHaveBeenCalled();
        });

        it('should return false when not ready', async () => {
            (connectionManager as any).health.connected = true;
            (connectionManager as any).health.ready = false;

            const result = await connectionManager.isHealthy();

            expect(result).toBe(false);
            expect(mockClient.ping).not.toHaveBeenCalled();
        });

        it('should check health with ping', async () => {
            (connectionManager as any).health.connected = true;
            (connectionManager as any).health.ready = true;
            mockClient.ping.mockResolvedValue('PONG');

            const result = await connectionManager.isHealthy();

            expect(mockClient.ping).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('should return false when ping fails', async () => {
            (connectionManager as any).health.connected = true;
            (connectionManager as any).health.ready = true;
            mockClient.ping.mockRejectedValue(new Error('Ping failed'));

            const result = await connectionManager.isHealthy();

            expect(mockClient.ping).toHaveBeenCalled();
            expect(result).toBe(false);
        });
    });

    describe('getters', () => {
        it('should get client instance', () => {
            const client = connectionManager.getClient();
            expect(client).toEqual(mockClient);
        });

        it('should get health status', () => {
            const health = connectionManager.getHealth();
            expect(health).toEqual(expect.objectContaining({
                connected: false,
                ready: false,
            }));
            expect(health).not.toBe(connectionManager['health']); // Should return copy
        });

        it('should get configuration', () => {
            const config = connectionManager.getConfig();
            expect(config).toEqual({
                url: 'redis://localhost:6379',
                database: 1,
                retryDelay: 100,
                maxRetries: 2,
            });
            expect(config).not.toBe(connectionManager['config']); // Should return copy
        });
    });
});