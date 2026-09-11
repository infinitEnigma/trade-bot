import {
    StrategiesEngineService,
    createStrategiesEngineService,
    StrategiesEngineServiceDependencies,
    IProcessManager,
    LegacyEngineStatus
} from '../../src/core/strategies/strategies-engine.service.pure';
import { ILogger } from '@trade-bot/shared';

describe('StrategiesEngineService', () => {
    let mockLogger: Partial<ILogger>;
    let mockProcessManager: Partial<IProcessManager>;
    let service: StrategiesEngineService;

    beforeEach(() => {
        // Create mock dependencies
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        mockProcessManager = {
            spawn: jest.fn(),
            kill: jest.fn(),
            isAlive: jest.fn(),
            getStatus: jest.fn(),
        };

        // Create service instance
        service = createStrategiesEngineService({
            processManager: mockProcessManager as IProcessManager,
            logger: mockLogger as ILogger,
        });
    });

    describe('createStrategiesEngineService', () => {
        it('should create an instance of StrategiesEngineService', () => {
            expect(service).toBeInstanceOf(StrategiesEngineService);
        });
    });

    describe('ensureEngineRunning', () => {
        it('should return early if engine is already running', async () => {
            const mockStatus = {
                running: true,
                pid: 1234,
                uptime: 3600,
                memoryUsage: 1024 * 1024 * 50
            };
            (mockProcessManager.getStatus as jest.Mock).mockResolvedValue(mockStatus);

            await service.ensureEngineRunning();

            expect(mockProcessManager.getStatus).toHaveBeenCalled();
            expect(mockProcessManager.spawn).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Strategies engine already running',
                expect.objectContaining({
                    pid: mockStatus.pid,
                    uptime: mockStatus.uptime
                })
            );
        });

        it('should start engine if not running and validate startup', async () => {
            const initialStatus = { running: false };
            const runningStatus = {
                running: true,
                pid: 1234,
                uptime: 0,
                memoryUsage: 1024 * 1024 * 50
            };

            (mockProcessManager.getStatus as jest.Mock)
                .mockResolvedValueOnce(initialStatus)
                .mockResolvedValueOnce(runningStatus);
            (mockProcessManager.spawn as jest.Mock).mockResolvedValue(true);

            await service.ensureEngineRunning();

            expect(mockProcessManager.getStatus).toHaveBeenCalledTimes(2);
            expect(mockProcessManager.spawn).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith('Strategies engine started successfully', expect.any(Object));
        });

        it('should throw error if engine fails to start', async () => {
            const initialStatus = { running: false };
            const failedStatus = { running: false };

            (mockProcessManager.getStatus as jest.Mock)
                .mockResolvedValueOnce(initialStatus)
                .mockResolvedValueOnce(failedStatus);
            (mockProcessManager.spawn as jest.Mock).mockResolvedValue(true);

            await expect(service.ensureEngineRunning()).rejects.toThrow(
                'Strategies engine process failed to start'
            );
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should throw error if spawn returns false', async () => {
            const initialStatus = { running: false };

            (mockProcessManager.getStatus as jest.Mock).mockResolvedValue(initialStatus);
            (mockProcessManager.spawn as jest.Mock).mockResolvedValue(false);

            await expect(service.ensureEngineRunning()).rejects.toThrow(
                'Failed to start trading engine process'
            );
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle errors in ensureEngineRunning', async () => {
            const testError = new Error('Process manager failure');
            (mockProcessManager.getStatus as jest.Mock).mockRejectedValue(testError);

            await expect(service.ensureEngineRunning()).rejects.toThrow(testError);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('getEngineStatus', () => {
        it('should return running engine status with health information', async () => {
            const mockStatus = {
                running: true,
                pid: 1234,
                uptime: 3600,
                memoryUsage: 1024 * 1024 * 50
            };
            (mockProcessManager.getStatus as jest.Mock).mockResolvedValue(mockStatus);

            const result = await service.getEngineStatus();

            expect(result.running).toBe(true);
            expect(result.health).toEqual(expect.objectContaining({
                status: 'healthy',
                bots: 0,
                uptime: mockStatus.uptime
            }));
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should return stopped engine status', async () => {
            const mockStatus = { running: false };
            (mockProcessManager.getStatus as jest.Mock).mockResolvedValue(mockStatus);

            const result = await service.getEngineStatus();

            expect(result.running).toBe(false);
            expect(result.health).toBeUndefined();
        });

        it('should handle errors and return safe default status', async () => {
            const testError = new Error('Process manager failure');
            (mockProcessManager.getStatus as jest.Mock).mockRejectedValue(testError);

            const result = await service.getEngineStatus();

            expect(result.running).toBe(false);
            expect(result.health).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('stopEngineIfNoActiveBots', () => {
        it('should stop engine if there are no active bots and engine is running', async () => {
            // First, ensure engine is in running state
            (mockProcessManager.getStatus as jest.Mock).mockResolvedValue({ running: true });
            (mockProcessManager.kill as jest.Mock).mockResolvedValue(true);

            await service.stopEngineIfNoActiveBots();

            expect(mockLogger.info).toHaveBeenCalledWith('No active bots, stopping trading engine');
            expect(mockProcessManager.kill).toHaveBeenCalledWith('SIGTERM');
            expect(mockLogger.info).toHaveBeenCalledWith('Strategies engine stopped successfully');
        });

        it('should keep engine running if there are active bots', async () => {
            // Ensure engine is in running state
            (mockProcessManager.getStatus as jest.Mock).mockResolvedValue({ running: true });
            // Spy on the private getActiveBotCount method to return a non-zero value
            const getActiveBotCountSpy = jest.spyOn<any, any>(StrategiesEngineService.prototype, 'getActiveBotCount')
                .mockResolvedValue(2);

            await service.stopEngineIfNoActiveBots();

            expect(getActiveBotCountSpy).toHaveBeenCalled();
            expect(mockProcessManager.kill).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith('Engine kept running for 2 active bots');
        });

        it('should log warning if engine fails to stop gracefully', async () => {
            // Create new mocks specifically for this test to avoid interference
            const testLogger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            };

            const testProcessManager = {
                spawn: jest.fn(),
                kill: jest.fn().mockResolvedValue(false), // Always fail to stop
                isAlive: jest.fn(),
                getStatus: jest.fn().mockResolvedValue({ running: true }) // Always running
            };

            const testService = createStrategiesEngineService({
                processManager: testProcessManager as IProcessManager,
                logger: testLogger as unknown as ILogger
            });

            // Spy on the private getActiveBotCount method to ensure it's returning 0
            const getActiveBotCountSpy = jest.spyOn<any, any>(testService, 'getActiveBotCount')
                .mockResolvedValue(0);

            await testService.stopEngineIfNoActiveBots();

            console.log('DEBUG: getActiveBotCount called:', getActiveBotCountSpy.mock.calls.length > 0);
            console.log('DEBUG: kill called:', testProcessManager.kill.mock.calls.length > 0);
            console.log('DEBUG: debug calls:', testLogger.debug.mock.calls);
            console.log('DEBUG: info calls:', testLogger.info.mock.calls);
            console.log('DEBUG: warn calls:', testLogger.warn.mock.calls);

            expect(getActiveBotCountSpy).toHaveBeenCalled();
            expect(testProcessManager.kill).toHaveBeenCalledWith('SIGTERM');
            expect(testLogger.warn).toHaveBeenCalled();
            expect(testLogger.warn.mock.calls[0][0]).toContain('Failed');
        });

        it('should handle errors in stopEngineIfNoActiveBots', async () => {
            const testError = new Error('Process manager failure');
            // Make getActiveBotCount throw an error
            const getActiveBotCountSpy = jest.spyOn<any, any>(StrategiesEngineService.prototype, 'getActiveBotCount')
                .mockRejectedValue(testError);

            await service.stopEngineIfNoActiveBots();

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('forceStopEngine', () => {
        it('should force stop engine successfully', async () => {
            (mockProcessManager.kill as jest.Mock).mockResolvedValue(true);

            await service.forceStopEngine();

            expect(mockLogger.warn).toHaveBeenCalledWith('Force stopping trading engine');
            expect(mockProcessManager.kill).toHaveBeenCalledWith('SIGKILL');
            expect(mockLogger.info).toHaveBeenCalledWith('Strategies engine force stopped successfully');
        });

        it('should log warning if force stop fails', async () => {
            (mockProcessManager.kill as jest.Mock).mockResolvedValue(false);

            await service.forceStopEngine();

            expect(mockLogger.warn).toHaveBeenCalledWith('Failed to force stop trading engine');
        });

        it('should handle errors in forceStopEngine', async () => {
            const testError = new Error('Process manager failure');
            (mockProcessManager.kill as jest.Mock).mockRejectedValue(testError);

            await expect(service.forceStopEngine()).rejects.toThrow(testError);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('isEngineProcessAlive', () => {
        it('should return true when engine process is alive', () => {
            (mockProcessManager.isAlive as jest.Mock).mockReturnValue(true);

            const result = service.isEngineProcessAlive();

            expect(result).toBe(true);
        });

        it('should return false when engine process is not alive', () => {
            (mockProcessManager.isAlive as jest.Mock).mockReturnValue(false);

            const result = service.isEngineProcessAlive();

            expect(result).toBe(false);
        });

        it('should return false and log error when isAlive throws', () => {
            const testError = new Error('Process manager failure');
            (mockProcessManager.isAlive as jest.Mock).mockImplementation(() => {
                throw testError;
            });

            const result = service.isEngineProcessAlive();

            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});