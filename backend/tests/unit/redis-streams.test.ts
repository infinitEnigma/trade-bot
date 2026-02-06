/** @format */

import { RedisStreamOperations } from '../../src/infrastructure/cache/redis/streams';
import { RedisConnectionManager } from '../../src/infrastructure/cache/redis/connection-manager';
import type { EngineCommand, EngineEvent } from '@trade-bot/shared';

// Mock dependencies
jest.mock('../../src/infrastructure/cache/redis/connection-manager');
jest.mock('../../src/core/logging');

describe('RedisStreamOperations', () => {
    let mockConnectionManager: jest.Mocked<RedisConnectionManager>;
    let mockClient: any;
    let streamOperations: RedisStreamOperations;

    const testCommand: EngineCommand = {
        type: 'TEST_COMMAND',
        engineId: 'test-engine-1',
        timestamp: Date.now(),
    };

    const testEvent: EngineEvent = {
        type: 'TEST_EVENT',
        engineId: 'test-engine-1',
        timestamp: Date.now(),
    };

    beforeEach(() => {
        // Reset all modules to ensure fresh instance
        jest.clearAllMocks();

        // Create mock client with stream operation methods
        mockClient = {
            xAdd: jest.fn(),
            xReadGroup: jest.fn(),
            xRead: jest.fn(),
            xAck: jest.fn(),
            xGroupCreate: jest.fn(),
            xTrim: jest.fn(),
            xInfoStream: jest.fn(),
            xDel: jest.fn(),
        };

        // Create mock connection manager
        mockConnectionManager = {
            getClient: jest.fn().mockReturnValue(mockClient),
        } as unknown as jest.Mocked<RedisConnectionManager>;

        // Create stream operations instance
        streamOperations = new RedisStreamOperations(mockConnectionManager);
    });

    describe('instance creation', () => {
        it('should create an instance of RedisStreamOperations', () => {
            expect(streamOperations).toBeInstanceOf(RedisStreamOperations);
        });

        it('should initialize with connection manager', () => {
            const instance = new RedisStreamOperations(mockConnectionManager);
            expect(instance).toBeDefined();
        });
    });

    describe('publish method', () => {
        it('should publish message to stream successfully', async () => {
            const mockId = '1234567890123-0';
            mockClient.xAdd.mockResolvedValue(mockId);

            const result = await streamOperations.publish('test:stream', testCommand);

            expect(mockClient.xAdd).toHaveBeenCalledWith(
                'test:stream',
                '*',
                { data: JSON.stringify(testCommand) }
            );
            expect(result.success).toBe(true);
            expect(result.id).toBe(mockId);
        });

        it('should handle publish failure', async () => {
            const testError = new Error('Publish failed');
            mockClient.xAdd.mockRejectedValue(testError);

            const result = await streamOperations.publish('test:stream', testCommand);

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('read method', () => {
        it('should read messages from stream directly', async () => {
            const mockMessages = [
                { id: '1', message: { data: JSON.stringify(testCommand) } },
                { id: '2', message: { data: JSON.stringify(testEvent) } },
            ];
            mockClient.xRead.mockResolvedValue([
                { key: 'test:stream', messages: mockMessages }
            ]);

            const result = await streamOperations.read('test:stream');

            expect(mockClient.xRead).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.messages).toHaveLength(2);
            expect(result.messages![0].id).toBe('1');
            expect(result.messages![0].data.type).toBe(testCommand.type);
        });

        it('should read messages from consumer group with autoAck true', async () => {
            const mockMessages = [
                { id: '1', message: { data: JSON.stringify(testCommand) } },
                { id: '2', message: { data: JSON.stringify(testEvent) } },
            ];
            mockClient.xReadGroup.mockResolvedValue([
                { key: 'test:stream', messages: mockMessages }
            ]);

            const result = await streamOperations.read('test:stream', {
                consumerGroup: 'test-group',
                consumerName: 'test-consumer',
                autoAck: true,
                block: 1000,
                count: 5,
            });

            expect(mockClient.xReadGroup).toHaveBeenCalledWith(
                'test-group',
                'test-consumer',
                [{ key: 'test:stream', id: '>' }],
                expect.anything()
            );
            expect(result.success).toBe(true);
            expect(result.messages).toHaveLength(2);
        });

        it('should read messages from consumer group with autoAck false', async () => {
            const mockMessages = [
                { id: '1', message: { data: JSON.stringify(testCommand) } },
                { id: '2', message: { data: JSON.stringify(testEvent) } },
            ];
            mockClient.xReadGroup.mockResolvedValue([
                { key: 'test:stream', messages: mockMessages }
            ]);

            const result = await streamOperations.read('test:stream', {
                consumerGroup: 'test-group',
                consumerName: 'test-consumer',
                autoAck: false,
                block: 1000,
                count: 5,
            });

            expect(mockClient.xReadGroup).toHaveBeenCalledWith(
                'test-group',
                'test-consumer',
                [{ key: 'test:stream', id: '>' }],
                expect.anything()
            );
            expect(result.success).toBe(true);
            expect(result.messages).toHaveLength(2);
        });

        it('should handle read failure', async () => {
            const testError = new Error('Read failed');
            mockClient.xRead.mockRejectedValue(testError);

            const result = await streamOperations.read('test:stream');

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });

        it('should handle empty read result from consumer group', async () => {
            mockClient.xReadGroup.mockResolvedValue(null);

            const result = await streamOperations.read('test:stream', {
                consumerGroup: 'test-group',
                consumerName: 'test-consumer',
                autoAck: true,
            });

            expect(mockClient.xReadGroup).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.messages).toEqual([]);
        });

        it('should handle empty read result from stream directly', async () => {
            mockClient.xRead.mockResolvedValue(null);

            const result = await streamOperations.read('test:stream');

            expect(result.success).toBe(true);
            expect(result.messages).toEqual([]);
        });
    });

    describe('ack method', () => {
        it('should acknowledge single message', async () => {
            mockClient.xAck.mockResolvedValue(1);

            const result = await streamOperations.ack('test:stream', 'test-group', '123');

            expect(mockClient.xAck).toHaveBeenCalledWith('test:stream', 'test-group', ['123']);
            expect(result.success).toBe(true);
            expect(result.count).toBe(1);
        });

        it('should acknowledge multiple messages', async () => {
            mockClient.xAck.mockResolvedValue(2);

            const result = await streamOperations.ack('test:stream', 'test-group', ['123', '456']);

            expect(mockClient.xAck).toHaveBeenCalledWith('test:stream', 'test-group', ['123', '456']);
            expect(result.success).toBe(true);
            expect(result.count).toBe(2);
        });

        it('should handle acknowledge failure', async () => {
            const testError = new Error('Ack failed');
            mockClient.xAck.mockRejectedValue(testError);

            const result = await streamOperations.ack('test:stream', 'test-group', '123');

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('createConsumerGroup method', () => {
        it('should create consumer group successfully', async () => {
            mockClient.xGroupCreate.mockResolvedValue();

            const result = await streamOperations.createConsumerGroup('test:stream', 'test-group');

            expect(mockClient.xGroupCreate).toHaveBeenCalledWith('test:stream', 'test-group', '0', { MKSTREAM: true });
            expect(result.success).toBe(true);
        });

        it('should handle existing consumer group', async () => {
            mockClient.xGroupCreate.mockRejectedValue(new Error('BUSYGROUP Consumer Group name already exists'));

            const result = await streamOperations.createConsumerGroup('test:stream', 'test-group');

            expect(result.success).toBe(true);
        });

        it('should handle creation failure', async () => {
            const testError = new Error('Group creation failed');
            mockClient.xGroupCreate.mockRejectedValue(testError);

            const result = await streamOperations.createConsumerGroup('test:stream', 'test-group');

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('trim method', () => {
        it('should trim stream successfully with approximate true', async () => {
            mockClient.xInfoStream.mockResolvedValueOnce({ length: 20 }) // Before trim
                .mockResolvedValueOnce({ length: 10 }); // After trim

            // Add sendCommand to mock client
            mockClient.sendCommand = jest.fn().mockResolvedValue(undefined);

            const result = await streamOperations.trim('test:stream', 10);

            expect(mockClient.sendCommand).toHaveBeenCalledWith(['XTRIM', 'test:stream', 'MAXLEN', '10', '~']);
            expect(result.success).toBe(true);
            expect(result.trimmedCount).toBe(10);
        });

        it('should trim stream successfully with approximate false', async () => {
            mockClient.xInfoStream.mockResolvedValueOnce({ length: 20 }) // Before trim
                .mockResolvedValueOnce({ length: 10 }); // After trim

            // Add sendCommand to mock client
            mockClient.sendCommand = jest.fn().mockResolvedValue(undefined);

            const result = await streamOperations.trim('test:stream', 10, false);

            expect(mockClient.sendCommand).toHaveBeenCalledWith(['XTRIM', 'test:stream', 'MAXLEN', '10']);
            expect(result.success).toBe(true);
            expect(result.trimmedCount).toBe(10);
        });

        it('should handle non-existent stream for trim', async () => {
            mockClient.xInfoStream.mockRejectedValue(new Error('no such key'));

            const result = await streamOperations.trim('non-existent:stream', 10);

            expect(result.success).toBe(true);
            expect(result.trimmedCount).toBe(0);
        });

        it('should handle trim failure', async () => {
            const testError = new Error('Trim failed');
            mockClient.xInfoStream.mockRejectedValue(testError);

            const result = await streamOperations.trim('test:stream', 10);

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });

        it('should handle XTRIM command failure', async () => {
            const testError = new Error('XTRIM failed');
            mockClient.xInfoStream.mockResolvedValueOnce({ length: 20 }); // Before trim
            mockClient.sendCommand = jest.fn().mockRejectedValue(testError);

            const result = await streamOperations.trim('test:stream', 10);

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('info method', () => {
        it('should get stream info successfully', async () => {
            const mockInfo = {
                length: 100,
                'first-entry': { id: '1000-0' },
                'last-entry': { id: '2000-0' },
            };
            mockClient.xInfoStream.mockResolvedValue(mockInfo);

            const result = await streamOperations.info('test:stream');

            expect(mockClient.xInfoStream).toHaveBeenCalledWith('test:stream');
            expect(result.success).toBe(true);
            expect(result.length).toBe(100);
            expect(result.firstId).toBe('1000-0');
            expect(result.lastId).toBe('2000-0');
        });

        it('should handle info failure', async () => {
            const testError = new Error('Info failed');
            mockClient.xInfoStream.mockRejectedValue(testError);

            const result = await streamOperations.info('test:stream');

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });

    describe('delete method', () => {
        it('should delete message successfully', async () => {
            mockClient.xDel.mockResolvedValue(1);

            const result = await streamOperations.delete('test:stream', '123');

            expect(mockClient.xDel).toHaveBeenCalledWith('test:stream', '123');
            expect(result.success).toBe(true);
            expect(result.deletedCount).toBe(1);
        });

        it('should handle delete failure', async () => {
            const testError = new Error('Delete failed');
            mockClient.xDel.mockRejectedValue(testError);

            const result = await streamOperations.delete('test:stream', '123');

            expect(result.success).toBe(false);
            expect(result.error).toBe(testError.message);
        });
    });
});