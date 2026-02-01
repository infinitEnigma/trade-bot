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
            // Publish exactly 20 messages to ensure we have enough to trim
            const publishPromises = [];
            for (let i = 0; i < 20; i++) {
                publishPromises.push(streamOperations.publish(TEST_STREAM, {
                    type: 'TEST_COMMAND',
                    engineId: 'test-engine',
                    timestamp: Date.now() + i
                }));
            }
            await Promise.all(publishPromises);

            // Trim to approximately 10 messages using approximate trimming
            const trimResult = await streamOperations.trim(TEST_STREAM, 10, true);
            expect(trimResult.success).toBe(true);
            expect(trimResult.trimmedCount).toBeGreaterThanOrEqual(10);

            // Verify stream length after trim is around 10
            const infoResult = await streamOperations.info(TEST_STREAM);
            expect(infoResult.success).toBe(true);
            // With approximate trimming, Redis may keep a few more messages for efficiency
            expect(infoResult.length).toBeLessThanOrEqual(20);
            expect(infoResult.length).toBeGreaterThanOrEqual(10);
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

        it.skip('should acknowledge messages in consumer group', async () => {
            // Publish a message before creating consumer group
            const publishResult = await streamOperations.publish(TEST_STREAM, {
                type: 'TEST_COMMAND',
                engineId: 'test-engine',
                timestamp: Date.now()
            });
            expect(publishResult.success).toBe(true);
            expect(publishResult.id).toBeDefined();

            // Create consumer group with start ID 0 to read all messages
            const createGroupResult = await streamOperations.createConsumerGroup(TEST_STREAM, 'test-group');
            expect(createGroupResult.success).toBe(true);

            // Read message from consumer group
            const readResult = await streamOperations.read(TEST_STREAM, {
                consumerGroup: 'test-group',
                consumerName: 'test-consumer',
                autoAck: false,
                block: 1000
            });
            expect(readResult.success).toBe(true);
            expect(readResult.messages).toBeDefined();
            console.log('read result: ', readResult.success, readResult.messages?.length)
            // Sometimes no message is returned immediately, try again
            let messageId: string;
            if (readResult.messages!.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 500));
                const retryResult = await streamOperations.read(TEST_STREAM, {
                    consumerGroup: 'test-group',
                    consumerName: 'test-consumer',
                    autoAck: false,
                    block: 1000
                });

                expect(retryResult.messages).toBeDefined();
                expect(retryResult.messages!.length).toBeGreaterThan(0);
                messageId = retryResult.messages![0].id;
                console.log('retry result: ', retryResult.success, retryResult.messages?.length, messageId)
            } else {
                messageId = readResult.messages![0].id;
            }
            console.log('messageId: ', messageId)
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
