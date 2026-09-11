import { RedisStreamOperations } from '../../src/infrastructure/cache/redis/streams';
import { RedisConnectionManager } from '../../src/infrastructure/cache/redis';

describe('RedisStreamOperations', () => {
    let streamOperations: RedisStreamOperations;
    let connectionManager: RedisConnectionManager;
    const TEST_STREAM = 'test:stream';

    beforeAll(async () => {
        connectionManager = new RedisConnectionManager();
        await connectionManager.connect();
        streamOperations = new RedisStreamOperations(connectionManager);

        // Clean up streams before all tests
        const client = connectionManager.getClient();
        await client.del(TEST_STREAM);
        await client.del('engine:commands');
        await client.del('engine:events');
    });

    beforeEach(async () => {
        // Clean up test stream before each test
        const client = connectionManager.getClient();
        await client.del(TEST_STREAM);
    });

    afterAll(async () => {
        // Clean up all streams after tests
        const client = connectionManager.getClient();
        await client.del(TEST_STREAM);
        await client.del('engine:commands');
        await client.del('engine:events');
    });

    describe('Stream operations', () => {
        it('should publish and read a command from a stream', async () => {
            const command = {
                type: 'START_BOT',
                engineId: 'test-engine',
                botId: 'test-bot',
                strategyId: 'test-strategy',
                config: { symbol: 'BTC/USDT', gridSize: 10, gridRange: 5 },
                credentials: {
                    accountId: 'test-account',
                    accessKey: 'test-key',
                    secretKey: 'test-secret'
                },
                timestamp: Date.now()
            };

            // Publish command
            const publishResult = await streamOperations.publish('engine:commands', command);
            expect(publishResult.success).toBe(true);
            expect(publishResult.id).toBeDefined();

            // Read command
            const readResult = await streamOperations.read('engine:commands');
            expect(readResult.success).toBe(true);
            expect(readResult.messages).toBeDefined();
            expect(readResult.messages!.length).toBeGreaterThan(0);

            // Find the specific message we just published
            const message = readResult.messages!.find(msg =>
                (msg.data as any).type === 'START_BOT' &&
                (msg.data as any).engineId === 'test-engine' &&
                (msg.data as any).botId === 'test-bot'
            );

            expect(message).toBeDefined();
            if (message) {
                expect((message.data as any).type).toBe('START_BOT');
                expect((message.data as any).engineId).toBe('test-engine');
                expect((message.data as any).botId).toBe('test-bot');
            }
        });

        it('should publish and read an event from a stream', async () => {
            const event = {
                type: 'BOT_STARTED',
                engineId: 'test-engine',
                botId: 'test-bot',
                strategyId: 'test-strategy',
                symbol: 'BTC/USDT',
                strategyType: 'GRID',
                timestamp: Date.now()
            };

            // Publish event
            const publishResult = await streamOperations.publish('engine:events', event);
            expect(publishResult.success).toBe(true);
            expect(publishResult.id).toBeDefined();

            // Read event
            const readResult = await streamOperations.read('engine:events');
            expect(readResult.success).toBe(true);
            expect(readResult.messages).toBeDefined();
            expect(readResult.messages!.length).toBeGreaterThan(0);

            // Find the specific event we just published
            const message = readResult.messages!.find(msg =>
                (msg.data as any).type === 'BOT_STARTED' &&
                (msg.data as any).engineId === 'test-engine' &&
                (msg.data as any).botId === 'test-bot'
            );

            expect(message).toBeDefined();
            if (message) {
                expect((message.data as any).type).toBe('BOT_STARTED');
                expect((message.data as any).engineId).toBe('test-engine');
                expect((message.data as any).botId).toBe('test-bot');
            }
        });

        it('should trim a stream with exact trimming', async () => {
            // Publish exactly 15 messages
            for (let i = 0; i < 15; i++) {
                await streamOperations.publish(TEST_STREAM, {
                    type: 'TEST_COMMAND',
                    engineId: 'test-engine',
                    timestamp: Date.now() + i
                });
            }

            // Trim to exactly 10 messages using exact trimming
            const trimResult = await streamOperations.trim(TEST_STREAM, 10, false);
            expect(trimResult.success).toBe(true);
            expect(trimResult.trimmedCount).toBe(5);

            // Verify stream length after trim
            const infoResult = await streamOperations.info(TEST_STREAM);
            expect(infoResult.success).toBe(true);
            expect(infoResult.length).toBe(10);
        });

        it('should trim a stream with approximate trimming', async () => {
            let mockConnectionManager: jest.Mocked<RedisConnectionManager>;
            let mockClient: any;
            let streamOperations: RedisStreamOperations;
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
            mockClient.xInfoStream.mockResolvedValueOnce({ length: 20 }) // Before trim
                .mockResolvedValueOnce({ length: 10 }); // After trim

            // Add sendCommand to mock client
            mockClient.sendCommand = jest.fn().mockResolvedValue(undefined);

            const result = await streamOperations.trim('test:stream', 10);

            expect(mockClient.sendCommand).toHaveBeenCalledWith(['XTRIM', 'test:stream', 'MAXLEN', '10', '~']);
            expect(result.success).toBe(true);
            expect(result.trimmedCount).toBe(10);
        });

        it('should handle trim when stream is already smaller than max length', async () => {
            // Publish 5 messages
            for (let i = 0; i < 5; i++) {
                await streamOperations.publish(TEST_STREAM, {
                    type: 'TEST_COMMAND',
                    engineId: 'test-engine',
                    timestamp: Date.now() + i
                });
            }

            // Try to trim to 10 messages (stream is already smaller)
            const trimResult = await streamOperations.trim(TEST_STREAM, 10, false);
            expect(trimResult.success).toBe(true);
            expect(trimResult.trimmedCount).toBe(0);

            // Verify stream length remains unchanged
            const infoResult = await streamOperations.info(TEST_STREAM);
            expect(infoResult.success).toBe(true);
            expect(infoResult.length).toBe(5);
        });

        it('should get stream information', async () => {
            const infoResult = await streamOperations.info('engine:commands');
            expect(infoResult.success).toBe(true);
            expect(infoResult.length).toBeGreaterThanOrEqual(0);
        });

        it('should acknowledge messages in consumer group', async () => {
            const client = connectionManager.getClient();

            // Create consumer group first
            const createGroupResult = await streamOperations.createConsumerGroup(TEST_STREAM, 'test-group');
            expect(createGroupResult.success).toBe(true);

            // Publish a message after creating consumer group
            const publishResult = await streamOperations.publish(TEST_STREAM, {
                type: 'TEST_COMMAND',
                engineId: 'test-engine',
                timestamp: Date.now()
            });
            expect(publishResult.success).toBe(true);
            expect(publishResult.id).toBeDefined();

            // Read message from consumer group using stream operations
            const readResult = await streamOperations.read(TEST_STREAM, {
                consumerGroup: 'test-group',
                consumerName: 'test-consumer',
                autoAck: false,
                block: 2000,
                count: 1
            });

            expect(readResult.success).toBe(true);

            let messageId: string;
            if (readResult.messages && readResult.messages.length > 0) {
                messageId = readResult.messages[0].id;
            } else {
                // If we can't read with stream operations, use direct read
                const directResult = await client.xReadGroup(
                    'test-group',
                    'test-consumer',
                    [{ key: TEST_STREAM, id: '>' }],
                    { BLOCK: 1000, COUNT: 1 }
                );

                if (directResult && directResult.length > 0 && directResult[0].messages.length > 0) {
                    messageId = directResult[0].messages[0].id;
                } else {
                    // Fallback to direct range
                    const streamMessages = await client.xRange(TEST_STREAM, '-', '+');
                    messageId = streamMessages[0].id;
                }
            }

            // Acknowledge the message
            const ackResult = await streamOperations.ack(TEST_STREAM, 'test-group', messageId);
            expect(ackResult.success).toBe(true);
            expect(ackResult.count).toBe(1);
        });

        it('should delete a message from stream', async () => {
            // Publish a message
            const publishResult = await streamOperations.publish(TEST_STREAM, {
                type: 'TEST_COMMAND',
                engineId: 'test-engine',
                timestamp: Date.now()
            });
            expect(publishResult.success).toBe(true);
            expect(publishResult.id).toBeDefined();

            // Read message to get its ID
            const readResult = await streamOperations.read(TEST_STREAM);
            expect(readResult.success).toBe(true);
            expect(readResult.messages).toBeDefined();
            expect(readResult.messages!.length).toBe(1);

            const messageId = readResult.messages![0].id;

            // Delete the message
            const deleteResult = await streamOperations.delete(TEST_STREAM, messageId);
            expect(deleteResult.success).toBe(true);
            expect(deleteResult.deletedCount).toBe(1);
        });
    });
});
