import { EngineManager } from '../../src/core/strategies/engine-manager.service.pure';
import { createEngineManager } from '../../src/core/strategies/engine-manager.service.pure';
import { RedisStreamOperations } from '../../src/infrastructure/cache/redis/streams';

describe('EngineManager', () => {
    let engineManager: EngineManager;
    let mockStreamOperations: Partial<RedisStreamOperations>;
    let mockLogger: any;
    let mockBotInstanceRepository: any;

    beforeEach(() => {
        // Create mock Logger
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };

        // Create mock Bot Instance Repository
        mockBotInstanceRepository = {
            getBotInstances: jest.fn().mockResolvedValue([]),
            getActiveBotInstances: jest.fn().mockResolvedValue([])
        };

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
            logger: mockLogger,
            botInstanceRepository: mockBotInstanceRepository,
            redisStreamOperations: mockStreamOperations as any
        });
    });

    afterEach(() => {
        // Clean up the event listener loop
        (engineManager as any).stopListeningForEvents();
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

    describe('Backward compatibility methods', () => {
        it('should ensure engine running', async () => {
            // Arrange
            const mockSpawn = jest.spyOn((engineManager as any).processSpawner, 'spawn').mockResolvedValue({});
            const mockWaitForReady = jest.spyOn((engineManager as any).processSpawner, 'waitForReady').mockResolvedValue(undefined);
            const mockStartSupervision = jest.spyOn((engineManager as any).processSupervisor, 'startSupervision').mockImplementation();

            // Act
            await engineManager.ensureEngineRunning();

            // Assert
            expect(mockSpawn).toHaveBeenCalled();
            expect(mockWaitForReady).toHaveBeenCalled();
            expect(mockStartSupervision).toHaveBeenCalled();
        });

        it('should get engine status when running', async () => {
            // Arrange
            const mockAxios = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        status: 'healthy',
                        bots: 2,
                        uptime: 3600
                    }
                })
            };
            const axios = require('axios');
            jest.spyOn(axios, 'get').mockImplementation(mockAxios.get);

            // Act
            const status = await engineManager.getEngineStatus();

            // Assert
            expect(status.running).toBe(true);
            expect(status.health?.status).toBe('healthy');
            expect(status.health?.bots).toBe(2);
        });

        it('should get engine status when not running', async () => {
            // Arrange
            const mockAxios = {
                get: jest.fn().mockRejectedValue(new Error('Engine not reachable'))
            };
            jest.doMock('axios', () => ({ default: mockAxios }));

            // Act
            const status = await engineManager.getEngineStatus();

            // Assert
            expect(status.running).toBe(false);
        });

        it('should stop engine if no active bots', async () => {
            // Arrange
            mockBotInstanceRepository.getActiveBotInstances.mockResolvedValue([]);
            const mockKill = jest.spyOn((engineManager as any).processSpawner, 'kill').mockResolvedValue(undefined);

            // Act
            await engineManager.stopEngineIfNoActiveBots();

            // Assert
            expect(mockBotInstanceRepository.getActiveBotInstances).toHaveBeenCalled();
            expect(mockKill).toHaveBeenCalledWith('SIGTERM');
            expect(mockLogger.info).toHaveBeenCalledWith('No active bots, stopping engine');
        });

        it('should not stop engine if there are active bots', async () => {
            // Arrange
            mockBotInstanceRepository.getActiveBotInstances.mockResolvedValue([{ id: 'bot1' }, { id: 'bot2' }]);
            const mockKill = jest.spyOn((engineManager as any).processSpawner, 'kill').mockResolvedValue(undefined);

            // Act
            await engineManager.stopEngineIfNoActiveBots();

            // Assert
            expect(mockBotInstanceRepository.getActiveBotInstances).toHaveBeenCalled();
            expect(mockKill).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should handle error when checking for active bots', async () => {
            // Arrange
            mockBotInstanceRepository.getActiveBotInstances.mockRejectedValue(new Error('Database error'));
            const mockKill = jest.spyOn((engineManager as any).processSpawner, 'kill').mockResolvedValue(undefined);

            // Act
            await engineManager.stopEngineIfNoActiveBots();

            // Assert
            expect(mockBotInstanceRepository.getActiveBotInstances).toHaveBeenCalled();
            expect(mockKill).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should force stop engine', async () => {
            // Arrange
            const mockKill = jest.spyOn((engineManager as any).processSpawner, 'kill').mockResolvedValue(undefined);

            // Act
            await engineManager.forceStopEngine();

            // Assert
            expect(mockKill).toHaveBeenCalledWith('SIGKILL');
        });

        it('should check if engine process is alive', () => {
            // Arrange
            const mockIsAlive = jest.spyOn((engineManager as any).processSpawner, 'isAlive').mockReturnValue(true);

            // Act
            const isAlive = engineManager.isEngineProcessAlive();

            // Assert
            expect(isAlive).toBe(true);
            expect(mockIsAlive).toHaveBeenCalled();
        });
    });

    describe('Enterprise supervision methods', () => {
        it('should start and stop process supervision', () => {
            // Arrange
            const mockStartSupervision = jest.spyOn((engineManager as any).processSupervisor, 'startSupervision').mockImplementation();
            const mockStopSupervision = jest.spyOn((engineManager as any).processSupervisor, 'stopSupervision').mockImplementation();

            // Act
            engineManager.startProcessSupervision();
            engineManager.stopProcessSupervision();

            // Assert
            expect(mockStartSupervision).toHaveBeenCalled();
            expect(mockStopSupervision).toHaveBeenCalled();
        });

        it('should ensure engine running with supervision', async () => {
            // Arrange
            const mockEnsureEngineRunning = jest.spyOn(engineManager, 'ensureEngineRunning').mockResolvedValue();
            const mockStartSupervision = jest.spyOn(engineManager, 'startProcessSupervision').mockImplementation();

            // Act
            const result = await engineManager.ensureEngineRunningWithSupervision();

            // Assert
            expect(result.success).toBe(true);
            expect(mockEnsureEngineRunning).toHaveBeenCalled();
            expect(mockStartSupervision).toHaveBeenCalled();
        });

        it('should get supervision status', () => {
            // Arrange
            const mockGetProcessState = jest.spyOn((engineManager as any).processSupervisor, 'getProcessState').mockReturnValue('running');
            const mockGetState = jest.spyOn((engineManager as any).circuitBreaker, 'getState').mockReturnValue('closed');
            const mockGetRestartStatistics = jest.spyOn((engineManager as any).restartManager, 'getRestartStatistics').mockReturnValue({
                totalAttempts: 0,
                nextRetryIn: 0
            });
            const mockGetRestartAnalysis = jest.spyOn((engineManager as any).restartManager, 'getRestartAnalysis').mockReturnValue({
                recentAttempts: []
            });

            // Act
            const status = engineManager.getSupervisionStatus();

            // Assert
            expect(status).toEqual({
                processState: 'running',
                circuitBreakerState: 'closed',
                restartAttempts: 0,
                consecutiveFailures: 0,
                lastRestartAttempt: 0,
                restartHistory: [],
                healthCheckLayers: {
                    processLiveness: true,
                    httpConnectivity: true,
                    websocketHealth: false,
                    botOperational: false,
                    systemResources: false,
                },
            });
        });

        it('should get supervision report', () => {
            // Arrange
            const mockReport = {
                state: 'running',
                stats: {},
                healthTrend: {},
                restartAnalysis: {},
                circuitBreakerAnalysis: {},
                config: {}
            };
            const mockGetSupervisorStatus = jest.spyOn((engineManager as any).processSupervisor, 'getSupervisorStatus').mockReturnValue(mockReport);

            // Act
            const report = engineManager.getSupervisionReport();

            // Assert
            expect(report).toEqual(mockReport);
            expect(mockGetSupervisorStatus).toHaveBeenCalled();
        });

        it('should perform emergency stop', async () => {
            // Arrange
            const mockEmergencyStop = jest.spyOn((engineManager as any).processSupervisor, 'emergencyStop').mockResolvedValue(undefined);

            // Act
            await engineManager.emergencyStop('test_reason');

            // Assert
            expect(mockEmergencyStop).toHaveBeenCalledWith('test_reason');
        });

        it('should perform manual restart', async () => {
            // Arrange
            const mockManualRestart = jest.spyOn((engineManager as any).processSupervisor, 'manualRestart').mockResolvedValue({ success: true });

            // Act
            const result = await engineManager.manualRestart('test_reason');

            // Assert
            expect(result.success).toBe(true);
            expect(mockManualRestart).toHaveBeenCalledWith('test_reason');
        });

        it('should reset supervision state', () => {
            // Arrange
            const mockReset = jest.spyOn((engineManager as any).processSupervisor, 'resetSupervisorState').mockImplementation();

            // Act
            engineManager.resetSupervisionState();

            // Assert
            expect(mockReset).toHaveBeenCalled();
        });
    });

    describe('Redis stream communication methods', () => {
        it('should stop listening for events', () => {
            // Arrange
            (engineManager as any).isListening = true;

            // Act
            engineManager.stopListeningForEvents();

            // Assert
            expect((engineManager as any).isListening).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith('Stopped listening for engine events');
        });

        it('should handle engine events', async () => {
            // Arrange
            const events = [
                { type: 'ENGINE_STARTED', engineId: 'engine1', uptime: 1000 },
                { type: 'ENGINE_STOPPED', engineId: 'engine1', reason: 'test', uptime: 3600 },
                { type: 'BOT_STARTED', botId: 'bot1', strategyId: 'strategy1', symbol: 'BTC/USDT', strategyType: 'grid' },
                { type: 'BOT_STOPPED', botId: 'bot1', reason: 'test' },
                { type: 'BOT_HEARTBEAT', botId: 'bot1', status: 'active', currentPrice: 50000, totalTrades: 10, totalPnl: 100 },
                { type: 'ENGINE_ERROR', botId: 'bot1', error: 'Test error', stack: 'Stack trace' },
                { type: 'TRADE_EXECUTED', botId: 'bot1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.01, fee: 0.1, pnl: 10, orderId: 'order1' },
                { type: 'POSITION_UPDATED', botId: 'bot1', symbol: 'BTC/USDT', side: 'long', quantity: 0.01, entryPrice: 49000, markPrice: 50000, pnl: 100 },
                { type: 'PERFORMANCE_SNAPSHOT', botId: 'bot1', metrics: { profit: 100, winRate: 0.75 } },
                { type: 'UNKNOWN_EVENT', data: 'test' } // Test unknown event
            ];

            // Act
            for (const event of events) {
                (engineManager as any).handleEngineEvent(event);
            }

            // Assert
            // Verify logger was called for various events
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should handle errors when publishing commands', async () => {
            // Arrange
            const errorMessage = 'Redis connection error';
            (mockStreamOperations.publish as jest.Mock).mockResolvedValue({ success: false, error: errorMessage });

            // Act
            await engineManager.sendStartEngineCommand();

            // Assert
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});