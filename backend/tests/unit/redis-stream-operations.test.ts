import { RedisStreamOperations } from '../../src/infrastructure/cache/redis/streams';
import { RedisConnectionManager } from '../../src/infrastructure/cache/redis';

describe('RedisStreamOperations', () => {
    let streamOperations: RedisStreamOperations;

    beforeAll(async () => {
        const connectionManager = new RedisConnectionManager();
        await connectionManager.connect();
        streamOperations = new RedisStreamOperations(connectionManager);
    });

    afterAll(async () => {
        // Clean up
        await streamOperations.delete('engine:commands', '0');
        await streamOperations.delete('engine:events', '0');
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

            const message = readResult.messages![0];
            expect((message.data as any).type).toBe('START_BOT');
            expect((message.data as any).engineId).toBe('test-engine');
            expect((message.data as any).botId).toBe('test-bot');
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

            const message = readResult.messages![0];
            expect((message.data as any).type).toBe('BOT_STARTED');
            expect((message.data as any).engineId).toBe('test-engine');
            expect((message.data as any).botId).toBe('test-bot');
        });

        it.skip('should trim a stream', async () => {
            // Publish multiple messages
            for (let i = 0; i < 15; i++) {
                await streamOperations.publish('engine:commands', {
                    type: 'TEST_COMMAND',
                    engineId: 'test-engine',
                    timestamp: Date.now() + i
                });
            }

            // Trim to 10 messages
            const trimResult = await streamOperations.trim('engine:commands', 10);
            expect(trimResult.success).toBe(true);
            expect(trimResult.trimmedCount).toBeGreaterThanOrEqual(5);
        });

        it('should get stream information', async () => {
            const infoResult = await streamOperations.info('engine:commands');
            expect(infoResult.success).toBe(true);
            expect(infoResult.length).toBeGreaterThanOrEqual(0);
        });
    });
});