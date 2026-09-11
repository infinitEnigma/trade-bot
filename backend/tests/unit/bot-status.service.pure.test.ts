import { BotStatusService, createBotStatusService, IBotRepository, Bot, BotWithValidation, LegacyBotStatusInfo } from '../../src/core/strategies/bot-status.service.pure';
import { ILogger, ICacheService, CacheResult, IAuditLogRepository } from '@trade-bot/shared';

describe('BotStatusService', () => {
    let mockLogger: Partial<ILogger>;
    let mockCache: Partial<ICacheService>;
    let mockBotRepository: Partial<IBotRepository>;
    let mockAuditLogger: Partial<IAuditLogRepository>;
    let service: BotStatusService;

    const mockBotId = 'test-bot-id';
    const mockUserId = 'test-user-id';
    const mockOtherUserId = 'other-user-id';

    const mockBot: Bot = {
        id: mockBotId,
        user_id: mockUserId,
        strategy_id: 'test-strategy-id',
        status: 'STOPPED',
        last_heartbeat: new Date().toISOString(),
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    beforeEach(() => {
        // Create mock dependencies
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        mockCache = {
            get: jest.fn(),
            setex: jest.fn(),
            delete: jest.fn(),
        };

        mockBotRepository = {
            findById: jest.fn(),
            findByUserId: jest.fn(),
            updateStatus: jest.fn(),
            updateHeartbeat: jest.fn(),
            getActiveBots: jest.fn(),
            getBotStats: jest.fn(),
        };

        mockAuditLogger = {
            logEvent: jest.fn(),
        };

        // Create service instance
        service = createBotStatusService({
            botRepository: mockBotRepository as IBotRepository,
            cache: mockCache as ICacheService,
            logger: mockLogger as ILogger,
            auditLogger: mockAuditLogger as IAuditLogRepository,
        });
    });

    describe('createBotStatusService', () => {
        it('should create an instance of BotStatusService', () => {
            expect(service).toBeInstanceOf(BotStatusService);
        });
    });

    describe('startBot', () => {
        it('should start a bot successfully when in valid state', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(mockBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockAuditLogger.logEvent as jest.Mock).mockResolvedValue(undefined);

            const result = await service.startBot(mockBotId, mockUserId);

            expect(result.success).toBe(true);
            expect(mockBotRepository.findById).toHaveBeenCalledWith(mockBotId);
            expect(mockBotRepository.updateStatus).toHaveBeenCalledWith(mockBotId, 'STARTING');
            expect(mockAuditLogger.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: mockUserId,
                    action: 'BOT_STARTED',
                    details: expect.anything(),
                })
            );
            expect(mockLogger.debug).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should fail to start bot when bot not found', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(null);

            const result = await service.startBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot not found or access denied');
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should fail to start bot when access denied', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue({
                ...mockBot,
                user_id: mockOtherUserId,
            });

            const result = await service.startBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot not found or access denied');
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should fail to start bot when in invalid state', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue({
                ...mockBot,
                status: 'RUNNING',
            });

            const result = await service.startBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot cannot be started in current state');
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should fail to start bot when status update fails', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(mockBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(false);

            const result = await service.startBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to update bot status');
        });

        it('should handle errors when starting bot', async () => {
            (mockBotRepository.findById as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.startBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to start bot');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('stopBot', () => {
        it('should stop a bot successfully when in valid state', async () => {
            const runningBot = { ...mockBot, status: 'RUNNING' };
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(runningBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockAuditLogger.logEvent as jest.Mock).mockResolvedValue(undefined);
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.stopBot(mockBotId, mockUserId);

            expect(result.success).toBe(true);
            expect(mockBotRepository.findById).toHaveBeenCalledWith(mockBotId);
            expect(mockBotRepository.updateStatus).toHaveBeenCalledWith(mockBotId, 'STOPPED');
            expect(mockAuditLogger.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: mockUserId,
                    action: 'BOT_STOPPED',
                    details: expect.anything(),
                })
            );
            expect(mockCache.delete).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should fail to stop bot when bot not found', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(null);

            const result = await service.stopBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot not found or access denied');
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should fail to stop bot when access denied', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue({
                ...mockBot,
                user_id: mockOtherUserId,
            });

            const result = await service.stopBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot not found or access denied');
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should fail to stop bot when in invalid state', async () => {
            (mockBotRepository.findById as jest.Mock).mockResolvedValue({
                ...mockBot,
                status: 'STOPPED',
            });

            const result = await service.stopBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot cannot be stopped in current state');
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should fail to stop bot when status update fails', async () => {
            const runningBot = { ...mockBot, status: 'RUNNING' };
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(runningBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(false);

            const result = await service.stopBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to update bot status');
        });

        it('should handle errors when stopping bot', async () => {
            (mockBotRepository.findById as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.stopBot(mockBotId, mockUserId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to stop bot');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getBotStatusInfo', () => {
        it('should return cached status when available and valid', async () => {
            const mockStatus: BotWithValidation = {
                ...mockBot,
                statusValidation: {
                    isStale: false,
                    lastHeartbeatAge: 10000,
                    engineHealth: {
                        running: true,
                        lastHealthCheck: Date.now(),
                        status: 'healthy',
                    },
                },
            };

            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: mockStatus,
            });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).not.toBeNull();
            expect(mockCache.get).toHaveBeenCalled();
            expect(mockBotRepository.findById).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith('Bot status cache hit', expect.anything());
        });

        it('should query repository when cache misses', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(mockBot);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).not.toBeNull();
            expect(mockCache.get).toHaveBeenCalled();
            expect(mockBotRepository.findById).toHaveBeenCalledWith(mockBotId);
            expect(mockCache.setex).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith('Bot status cache miss, querying repository', expect.anything());
        });

        it('should return null when bot not found', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(null);

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).toBeNull();
        });

        it('should return null when access denied', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockBotRepository.findById as jest.Mock).mockResolvedValue({
                ...mockBot,
                user_id: mockOtherUserId,
            });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).toBeNull();
        });

        it('should update status when validation fails', async () => {
            const staleBot = {
                ...mockBot,
                status: 'RUNNING',
                last_heartbeat: new Date(Date.now() - 60000).toISOString(), // 60 seconds ago (stale)
            };

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(staleBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).not.toBeNull();
            expect(result?.status).toBe('ERROR');
            expect(mockBotRepository.updateStatus).toHaveBeenCalled();
        });

        it('should handle cache set failures gracefully', async () => {
            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(mockBot);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: false, error: 'Cache error' });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).not.toBeNull();
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should handle errors when getting status', async () => {
            (mockCache.get as jest.Mock).mockRejectedValue(new Error('Cache error'));

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).toBeNull();
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('sendBotHeartbeat', () => {
        it('should process heartbeat successfully', async () => {
            (mockBotRepository.updateHeartbeat as jest.Mock).mockResolvedValue(true);
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(mockBot);
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.sendBotHeartbeat(mockBotId);

            expect(result.success).toBe(true);
            expect(mockBotRepository.updateHeartbeat).toHaveBeenCalledWith(mockBotId);
            expect(mockBotRepository.findById).toHaveBeenCalledWith(mockBotId);
            expect(mockCache.delete).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should handle recovery from ERROR state', async () => {
            const errorBot = {
                ...mockBot,
                status: 'ERROR',
                last_error: 'Bot heartbeat timeout - status validation',
            };

            (mockBotRepository.updateHeartbeat as jest.Mock).mockResolvedValue(true);
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(errorBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.sendBotHeartbeat(mockBotId);

            expect(result.success).toBe(true);
            expect(mockBotRepository.updateStatus).toHaveBeenCalledWith(mockBotId, 'RECOVERING');
            expect(mockLogger.info).toHaveBeenCalledWith('Bot entering recovery state', expect.anything());
        });

        it('should handle recovery from RECOVERING state', async () => {
            const recoveringBot = {
                ...mockBot,
                status: 'RECOVERING',
            };

            (mockBotRepository.updateHeartbeat as jest.Mock).mockResolvedValue(true);
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(recoveringBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockCache.delete as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.sendBotHeartbeat(mockBotId);

            expect(result.success).toBe(true);
            expect(mockBotRepository.updateStatus).toHaveBeenCalledWith(mockBotId, 'RUNNING');
            expect(mockLogger.info).toHaveBeenCalledWith('Bot recovered from error state', expect.anything());
        });

        it('should fail when heartbeat update fails', async () => {
            (mockBotRepository.updateHeartbeat as jest.Mock).mockResolvedValue(false);

            const result = await service.sendBotHeartbeat(mockBotId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to update heartbeat');
        });

        it('should fail when bot not found', async () => {
            (mockBotRepository.updateHeartbeat as jest.Mock).mockResolvedValue(true);
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(null);

            const result = await service.sendBotHeartbeat(mockBotId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Bot not found');
        });

        it('should handle errors when processing heartbeat', async () => {
            (mockBotRepository.updateHeartbeat as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.sendBotHeartbeat(mockBotId);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Failed to process heartbeat');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getBotStats', () => {
        it('should return bot statistics from repository', async () => {
            const mockStats = {
                totalBots: 10,
                runningBots: 7,
                errorBots: 2,
                staleBots: 1,
            };

            (mockBotRepository.getBotStats as jest.Mock).mockResolvedValue(mockStats);

            const result = await service.getBotStats();

            expect(result).toEqual(mockStats);
            expect(mockBotRepository.getBotStats).toHaveBeenCalled();
        });

        it('should return default stats when repository fails', async () => {
            (mockBotRepository.getBotStats as jest.Mock).mockRejectedValue(new Error('Database error'));

            const result = await service.getBotStats();

            expect(result).toEqual({
                totalBots: 0,
                runningBots: 0,
                errorBots: 0,
                staleBots: 0,
            });
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('legacy format handling', () => {
        it('should return legacy format when LEGACY_TRADING_API is true', async () => {
            const originalEnv = process.env.LEGACY_TRADING_API;
            process.env.LEGACY_TRADING_API = 'true';

            const mockStatus: BotWithValidation = {
                ...mockBot,
                statusValidation: {
                    isStale: false,
                    lastHeartbeatAge: 10000,
                    engineHealth: {
                        running: true,
                        lastHealthCheck: Date.now(),
                        status: 'healthy',
                    },
                },
            };

            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: mockStatus,
            });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).toEqual(expect.objectContaining({
                id: mockBotId,
                user_id: mockUserId,
                statusValidation: expect.anything(),
            }));
            expect(result?.statusValidation).toEqual(expect.anything());

            process.env.LEGACY_TRADING_API = originalEnv;
        });

        it('should return default format when LEGACY_TRADING_API is false', async () => {
            const originalEnv = process.env.LEGACY_TRADING_API;
            process.env.LEGACY_TRADING_API = 'false';

            const mockStatus: BotWithValidation = {
                ...mockBot,
                statusValidation: {
                    isStale: false,
                    lastHeartbeatAge: 10000,
                    engineHealth: {
                        running: true,
                        lastHealthCheck: Date.now(),
                        status: 'healthy',
                    },
                },
            };

            (mockCache.get as jest.Mock).mockResolvedValue({
                success: true,
                data: mockStatus,
            });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).toEqual(expect.objectContaining({
                id: mockBotId,
                user_id: mockUserId,
                statusValidation: expect.anything(),
            }));

            process.env.LEGACY_TRADING_API = originalEnv;
        });
    });

    describe('cache invalidation', () => {
        it('should handle cache invalidation failure gracefully', async () => {
            (mockCache.delete as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Cache delete failed'
            });

            const runningBot = { ...mockBot, status: 'RUNNING' };
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(runningBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockAuditLogger.logEvent as jest.Mock).mockResolvedValue(undefined);

            const result = await service.stopBot(mockBotId, mockUserId);

            expect(result.success).toBe(true);
            expect(mockLogger.warn).toHaveBeenCalled();
        });
    });

    describe('edge cases', () => {
        it('should handle bot with null last_heartbeat', async () => {
            const botWithNullHeartbeat = {
                ...mockBot,
                status: 'RUNNING',
                last_heartbeat: null,
            };

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(botWithNullHeartbeat);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).not.toBeNull();
            expect(result?.status).toBe('ERROR');
        });

        it('should handle audit logger failure gracefully', async () => {
            (mockAuditLogger.logEvent as jest.Mock).mockRejectedValue(new Error('Audit log failed'));
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(mockBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);

            const result = await service.startBot(mockBotId, mockUserId);

            expect(result.success).toBe(true);
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should recover from error state when heartbeat is received', async () => {
            const recentlyRecoveredBot = {
                ...mockBot,
                status: 'ERROR',
                last_heartbeat: new Date().toISOString(),
                last_error: 'Bot heartbeat timeout - status validation',
            };

            (mockCache.get as jest.Mock).mockResolvedValue({ success: false });
            (mockBotRepository.findById as jest.Mock).mockResolvedValue(recentlyRecoveredBot);
            (mockBotRepository.updateStatus as jest.Mock).mockResolvedValue(true);
            (mockCache.setex as jest.Mock).mockResolvedValue({ success: true });

            const result = await service.getBotStatusInfo(mockBotId, mockUserId);

            expect(result).not.toBeNull();
            expect(result?.status).toBe('RUNNING');
        });
    });
});
