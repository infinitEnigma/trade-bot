/** @format */

import { BotManagementService, createBotManagementService, BotManagementServiceDependencies } from '../../src/core/bots/bot-management.service';

describe('BotManagementService', () => {
    // Create mock dependencies for the BotManagementService
    const createMockDependencies = (): BotManagementServiceDependencies => {
        return {
            botInstanceRepository: {
                getBotInstances: jest.fn(),
                getBotInstance: jest.fn(),
                getActiveBotInstances: jest.fn(),
                createBotInstance: jest.fn(),
                updateBotStatus: jest.fn(),
                updateBotPerformance: jest.fn(),
                deleteBotInstance: jest.fn(),
            },
            strategyRepository: {
                getStrategies: jest.fn(),
                getStrategy: jest.fn(),
                createStrategy: jest.fn(),
                updateStrategy: jest.fn(),
                deleteStrategy: jest.fn(),
                toggleStrategy: jest.fn(),
            },
            auditLogRepository: {
                logEvent: jest.fn(),
                getUserLogs: jest.fn(),
            },
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                child: jest.fn(),
            },
        };
    };

    describe('Constructor', () => {
        it('should create an instance of BotManagementService', () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);
            expect(botManagementService).toBeInstanceOf(BotManagementService);
        });

        it('should create an instance using the factory function', () => {
            const deps = createMockDependencies();
            const botManagementService = createBotManagementService(deps);
            expect(botManagementService).toBeInstanceOf(BotManagementService);
        });
    });

    describe('Get Bot Instances', () => {
        it('should retrieve bot instances for a user', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const mockBotInstances = [
                { id: 'bot-1', user_id: testUserId, status: 'RUNNING' },
                { id: 'bot-2', user_id: testUserId, status: 'STOPPED' }
            ];
            (deps.botInstanceRepository.getBotInstances as jest.Mock).mockResolvedValue(mockBotInstances);

            const result = await botManagementService.getBotInstances(testUserId);

            expect(result).toEqual(mockBotInstances);
            expect(deps.botInstanceRepository.getBotInstances).toHaveBeenCalledWith(testUserId);
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle errors when getting bot instances', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testError = new Error('Database error');
            (deps.botInstanceRepository.getBotInstances as jest.Mock).mockRejectedValue(testError);

            await expect(botManagementService.getBotInstances(testUserId)).rejects.toThrow('Failed to get bot instances');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Get Bot Instance', () => {
        it('should retrieve a specific bot instance', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            const mockBotInstance = { id: testBotId, user_id: 'user-123', status: 'RUNNING' };
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            const result = await botManagementService.getBotInstance(testBotId);

            expect(result).toEqual(mockBotInstance);
            expect(deps.botInstanceRepository.getBotInstance).toHaveBeenCalledWith(testBotId);
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle errors when getting a bot instance', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            const testError = new Error('Database error');
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockRejectedValue(testError);

            await expect(botManagementService.getBotInstance(testBotId)).rejects.toThrow('Failed to get bot instance');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Create and Start Bot', () => {
        it('should create and start a new bot instance', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testStrategyId = 'strategy-456';
            const testNotionalAmount = 1000;
            const mockStrategy = { id: testStrategyId, userId: testUserId };
            const mockBotInstance = { id: 'bot-789', strategy_id: testStrategyId, user_id: testUserId, status: 'RUNNING' };

            (deps.strategyRepository.getStrategy as jest.Mock).mockResolvedValue(mockStrategy);
            (deps.botInstanceRepository.getActiveBotInstances as jest.Mock).mockResolvedValue([]);
            (deps.botInstanceRepository.createBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);
            (deps.auditLogRepository.logEvent as jest.Mock).mockResolvedValue(undefined);

            const result = await botManagementService.createAndStartBot(testUserId, testStrategyId, testNotionalAmount);

            expect(result).toEqual(mockBotInstance);
            expect(deps.strategyRepository.getStrategy).toHaveBeenCalledWith(testStrategyId);
            expect(deps.botInstanceRepository.getActiveBotInstances).toHaveBeenCalled();
            expect(deps.botInstanceRepository.createBotInstance).toHaveBeenCalled();
            expect(deps.auditLogRepository.logEvent).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should throw error if strategy does not belong to user', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testStrategyId = 'strategy-456';
            const testNotionalAmount = 1000;
            const mockStrategy = { id: testStrategyId, userId: 'another-user' };

            (deps.strategyRepository.getStrategy as jest.Mock).mockResolvedValue(mockStrategy);

            await expect(botManagementService.createAndStartBot(testUserId, testStrategyId, testNotionalAmount))
                .rejects.toThrow('Strategy not found or does not belong to user');
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should throw error if bot is already running for strategy', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testStrategyId = 'strategy-456';
            const testNotionalAmount = 1000;
            const mockStrategy = { id: testStrategyId, userId: testUserId };
            const mockActiveBots = [{ id: 'bot-789', strategy_id: testStrategyId, status: 'RUNNING' }];

            (deps.strategyRepository.getStrategy as jest.Mock).mockResolvedValue(mockStrategy);
            (deps.botInstanceRepository.getActiveBotInstances as jest.Mock).mockResolvedValue(mockActiveBots);

            await expect(botManagementService.createAndStartBot(testUserId, testStrategyId, testNotionalAmount))
                .rejects.toThrow('Bot is already running for this strategy');
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should handle errors when creating bot', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testStrategyId = 'strategy-456';
            const testNotionalAmount = 1000;
            const testError = new Error('Database error');

            (deps.strategyRepository.getStrategy as jest.Mock).mockRejectedValue(testError);

            await expect(botManagementService.createAndStartBot(testUserId, testStrategyId, testNotionalAmount))
                .rejects.toThrow(testError);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Stop Bot', () => {
        it('should stop a running bot instance', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const mockBotInstance = { id: testBotId, user_id: testUserId, status: 'RUNNING', strategy_id: 'strategy-456' };

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);
            (deps.botInstanceRepository.updateBotStatus as jest.Mock).mockResolvedValue(undefined);
            (deps.auditLogRepository.logEvent as jest.Mock).mockResolvedValue(undefined);

            await botManagementService.stopBot(testUserId, testBotId);

            expect(deps.botInstanceRepository.getBotInstance).toHaveBeenCalledWith(testBotId);
            expect(deps.botInstanceRepository.updateBotStatus).toHaveBeenCalledWith(testBotId, 'STOPPED');
            expect(deps.auditLogRepository.logEvent).toHaveBeenCalled();
            expect(deps.logger.info).toHaveBeenCalled();
        });

        it('should throw error if bot does not belong to user', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const mockBotInstance = { id: testBotId, user_id: 'another-user', status: 'RUNNING' };

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            await expect(botManagementService.stopBot(testUserId, testBotId))
                .rejects.toThrow('Bot not found or does not belong to user');
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should throw error if bot is not running', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const mockBotInstance = { id: testBotId, user_id: testUserId, status: 'STOPPED' };

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            await expect(botManagementService.stopBot(testUserId, testBotId))
                .rejects.toThrow('Bot is not running');
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should handle errors when stopping bot', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const testError = new Error('Database error');

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockRejectedValue(testError);

            await expect(botManagementService.stopBot(testUserId, testBotId)).rejects.toThrow(testError);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Get Bot Status', () => {
        it('should retrieve bot status information', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            const mockBotInstance = { id: testBotId, user_id: 'user-123', status: 'RUNNING' };
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            const result = await botManagementService.getBotStatus(testBotId);

            expect(result).toEqual(expect.objectContaining({
                ...mockBotInstance,
                statusValidation: expect.any(Object)
            }));
            expect(result.statusValidation.isStale).toBe(false);
            expect(deps.botInstanceRepository.getBotInstance).toHaveBeenCalledWith(testBotId);
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should throw error if bot not found', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(null);

            await expect(botManagementService.getBotStatus(testBotId)).rejects.toThrow('Failed to get bot status');
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should handle errors when getting bot status', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            const testError = new Error('Database error');
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockRejectedValue(testError);

            await expect(botManagementService.getBotStatus(testBotId)).rejects.toThrow('Failed to get bot status');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Get Bot Performance', () => {
        it('should retrieve bot performance metrics', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            const mockBotInstance = {
                id: testBotId,
                user_id: 'user-123',
                status: 'RUNNING',
                total_trades: 10,
                total_pnl: 500
            };
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            const result = await botManagementService.getBotPerformance(testBotId);

            expect(result).toEqual({
                totalTrades: 10,
                totalPnL: 500,
                winRate: 0,
                avgTrade: 0,
                bestTrade: 0,
                worstTrade: 0
            });
            expect(deps.botInstanceRepository.getBotInstance).toHaveBeenCalledWith(testBotId);
            expect(deps.logger.debug).toHaveBeenCalled();
        });

        it('should handle bot without performance data', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            const mockBotInstance = {
                id: testBotId,
                user_id: 'user-123',
                status: 'RUNNING'
            };
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            const result = await botManagementService.getBotPerformance(testBotId);

            expect(result).toEqual({
                totalTrades: 0,
                totalPnL: 0,
                winRate: 0,
                avgTrade: 0,
                bestTrade: 0,
                worstTrade: 0
            });
        });

        it('should throw error if bot not found', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testBotId = 'bot-123';
            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(null);

            await expect(botManagementService.getBotPerformance(testBotId)).rejects.toThrow('Failed to get bot performance');
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Emergency Stop', () => {
        it('should initiate emergency stop for a running bot', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const mockBotInstance = { id: testBotId, user_id: testUserId, status: 'RUNNING', strategy_id: 'strategy-456' };

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);
            (deps.botInstanceRepository.updateBotStatus as jest.Mock).mockResolvedValue(undefined);
            (deps.auditLogRepository.logEvent as jest.Mock).mockResolvedValue(undefined);

            await botManagementService.emergencyStop(testBotId, testUserId);

            expect(deps.botInstanceRepository.getBotInstance).toHaveBeenCalledWith(testBotId);
            expect(deps.botInstanceRepository.updateBotStatus).toHaveBeenCalledWith(testBotId, 'FORCE_STOPPING');
            expect(deps.auditLogRepository.logEvent).toHaveBeenCalled();
            expect(deps.logger.warn).toHaveBeenCalled();
        });

        it('should throw error if bot does not belong to user', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const mockBotInstance = { id: testBotId, user_id: 'another-user', status: 'RUNNING' };

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            await expect(botManagementService.emergencyStop(testBotId, testUserId))
                .rejects.toThrow('Bot not found or does not belong to user');
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should throw error if bot is not running', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const mockBotInstance = { id: testBotId, user_id: testUserId, status: 'STOPPED' };

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockResolvedValue(mockBotInstance);

            await expect(botManagementService.emergencyStop(testBotId, testUserId))
                .rejects.toThrow('Bot is not running');
            expect(deps.logger.error).toHaveBeenCalled();
        });

        it('should handle errors when initiating emergency stop', async () => {
            const deps = createMockDependencies();
            const botManagementService = new BotManagementService(deps);

            const testUserId = 'user-123';
            const testBotId = 'bot-789';
            const testError = new Error('Database error');

            (deps.botInstanceRepository.getBotInstance as jest.Mock).mockRejectedValue(testError);

            await expect(botManagementService.emergencyStop(testBotId, testUserId)).rejects.toThrow(testError);
            expect(deps.logger.error).toHaveBeenCalled();
        });
    });

    describe('Internal Methods', () => {
        describe('generateBotId', () => {
            it('should generate unique bot IDs', () => {
                const deps = createMockDependencies();
                const botManagementService = new BotManagementService(deps);

                // @ts-ignore: Accessing private method for testing
                const botId1 = botManagementService['generateBotId']();
                // @ts-ignore: Accessing private method for testing
                const botId2 = botManagementService['generateBotId']();

                expect(botId1).toBeDefined();
                expect(botId2).toBeDefined();
                expect(botId1).not.toEqual(botId2);
                expect(botId1).toMatch(/^bot_\d+_[a-z0-9]{9}$/);
            });
        });
    });
});