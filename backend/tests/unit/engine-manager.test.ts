import { EngineManager } from '../../src/core/strategies/engine-manager.service.pure';
import { createEngineManager } from '../../src/core/strategies/engine-manager.service.pure';
import { RedisStreamOperations } from '../../src/infrastructure/cache/redis/streams';

describe('EngineManager', () => {
    let engineManager: EngineManager;
    let mockStreamOperations: Partial<RedisStreamOperations>;

    beforeAll(() => {
        // Create mock Redis stream operations
        mockStreamOperations = {
            publish: jest.fn().mockResolvedValue({ success: true }),
            read: jest.fn().mockResolvedValue({ success: true, messages: [] }),
            createConsumerGroup: jest.fn().mockResolvedValue({ success: true }),
            trim: jest.fn().mockResolvedValue({ success: true }),
            info: jest.fn().mockResolvedValue({ success: true, length: 0 }),
            delete: jest.fn().mockResolvedValue({ success: true }),
            ack: jest.fn().mockResolvedValue({ success: true })
        };

        // Create engine manager instance
        engineManager = createEngineManager({
            logger: {
                info: jest.fn(),
                debug: jest.fn(),
                error: jest.fn(),
                warn: jest.fn()
            } as any,
            botInstanceRepository: {
                getBotInstances: jest.fn().mockResolvedValue([])
            } as any,
            redisStreamOperations: mockStreamOperations as any
        });
    });

    describe('EngineManager initialization', () => {
        it('should create an instance of EngineManager', () => {
            expect(engineManager).toBeDefined();
            expect(engineManager).toBeInstanceOf(EngineManager);
        });
    });

    describe('Engine management methods', () => {
        it('should start listening for events', async () => {
            // Arrange
            const startListeningSpy = jest.spyOn(engineManager as any, 'startListeningForEvents');

            // Act
            await (engineManager as any).startListeningForEvents();

            // Assert
            expect(startListeningSpy).toHaveBeenCalled();
        });

        it('should send start engine command', async () => {
            // Arrange
            const publishSpy = (mockStreamOperations.publish as jest.Mock).mockResolvedValue({ success: true });

            // Act
            await engineManager.sendStartEngineCommand();

            // Assert
            expect(publishSpy).toHaveBeenCalledWith(
                'engine:commands',
                expect.objectContaining({
                    type: 'START_ENGINE',
                    engineId: expect.any(String),
                    timestamp: expect.any(Number)
                })
            );
        });

        it('should send stop engine command', async () => {
            // Arrange
            const publishSpy = (mockStreamOperations.publish as jest.Mock).mockResolvedValue({ success: true });

            // Act
            await engineManager.sendStopEngineCommand();

            // Assert
            expect(publishSpy).toHaveBeenCalledWith(
                'engine:commands',
                expect.objectContaining({
                    type: 'STOP_ENGINE',
                    engineId: expect.any(String),
                    timestamp: expect.any(Number)
                })
            );
        });

        it('should send start bot command', async () => {
            // Arrange
            const publishSpy = (mockStreamOperations.publish as jest.Mock).mockResolvedValue({ success: true });
            const botId = 'test-bot';
            const strategyId = 'test-strategy';
            const config = { symbol: 'BTC/USDT', gridSize: 10, gridRange: 5 };
            const credentials = {
                accountId: 'test-account',
                accessKey: 'test-key',
                secretKey: 'test-secret'
            };

            // Act
            await engineManager.sendStartBotCommand(botId, strategyId, config, credentials);

            // Assert
            expect(publishSpy).toHaveBeenCalledWith(
                'engine:commands',
                expect.objectContaining({
                    type: 'START_BOT',
                    engineId: expect.any(String),
                    botId,
                    strategyId,
                    config,
                    credentials,
                    timestamp: expect.any(Number)
                })
            );
        });

        it('should send stop bot command', async () => {
            // Arrange
            const publishSpy = (mockStreamOperations.publish as jest.Mock).mockResolvedValue({ success: true });
            const botId = 'test-bot';

            // Act
            await engineManager.sendStopBotCommand(botId);

            // Assert
            expect(publishSpy).toHaveBeenCalledWith(
                'engine:commands',
                expect.objectContaining({
                    type: 'STOP_BOT',
                    engineId: expect.any(String),
                    botId,
                    timestamp: expect.any(Number)
                })
            );
        });

        it('should send emergency stop command', async () => {
            // Arrange
            const publishSpy = (mockStreamOperations.publish as jest.Mock).mockResolvedValue({ success: true });
            const botId = 'test-bot';
            const action = 'CANCEL_ALL_ORDERS';

            // Act
            await engineManager.sendEmergencyStopCommand(botId, action);

            // Assert
            expect(publishSpy).toHaveBeenCalledWith(
                'engine:commands',
                expect.objectContaining({
                    type: 'EMERGENCY_STOP',
                    engineId: expect.any(String),
                    botId,
                    action,
                    timestamp: expect.any(Number)
                })
            );
        });

        it('should send update strategy config command', async () => {
            // Arrange
            const publishSpy = (mockStreamOperations.publish as jest.Mock).mockResolvedValue({ success: true });
            const botId = 'test-bot';
            const config = { symbol: 'BTC/USDT', gridSize: 20, gridRange: 10 };

            // Act
            await engineManager.sendUpdateStrategyConfigCommand(botId, config);

            // Assert
            expect(publishSpy).toHaveBeenCalledWith(
                'engine:commands',
                expect.objectContaining({
                    type: 'UPDATE_STRATEGY_CONFIG',
                    engineId: expect.any(String),
                    botId,
                    config,
                    timestamp: expect.any(Number)
                })
            );
        });
    });
});