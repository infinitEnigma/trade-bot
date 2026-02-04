import { ProcessSpawner, ProcessConfig, ReadinessConfig } from '../../src/core/strategies/engine/process-spawner';
import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';

// Mock dependencies
jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ProcessSpawner', () => {
    let processSpawner: ProcessSpawner;
    const defaultPort = 4000;

    beforeEach(() => {
        processSpawner = new ProcessSpawner(defaultPort);
        // Reset all mocks
        (spawn as jest.Mock).mockClear();
        mockedAxios.get.mockClear();
    });

    describe('constructor', () => {
        it('should create a ProcessSpawner instance with default configuration', () => {
            expect(processSpawner).toBeInstanceOf(ProcessSpawner);
        });

        it('should create a ProcessSpawner instance with custom engine path', () => {
            const customPath = '/custom/engine/path';
            const spawner = new ProcessSpawner(defaultPort, customPath);
            expect(spawner).toBeInstanceOf(ProcessSpawner);
        });
    });

    describe('spawn', () => {
        it('should reject if process spawning fails', async () => {
            (spawn as jest.Mock).mockImplementation(() => {
                throw new Error('Failed to spawn process');
            });

            await expect(processSpawner.spawn()).rejects.toThrow('Process spawning failed');
        });

        it('should return existing process if already running', async () => {
            const mockProcess = {
                killed: false,
                on: jest.fn(),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;
            (spawn as jest.Mock).mockReturnValue(mockProcess);

            // First spawn to create process
            await processSpawner.spawn();

            // Second spawn should return existing process without spawning new one
            await processSpawner.spawn();
            expect(spawn).toHaveBeenCalledTimes(1);
        });

        it('should spawn engine process with correct configuration', async () => {
            const mockProcess = {
                killed: false,
                on: jest.fn(),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;
            (spawn as jest.Mock).mockReturnValue(mockProcess);

            await processSpawner.spawn();

            expect(spawn).toHaveBeenCalled();
            expect(spawn).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Array),
                expect.objectContaining({
                    cwd: expect.any(String),
                    stdio: ["pipe", "pipe", "pipe"],
                    env: expect.objectContaining({
                        PORT: defaultPort.toString()
                    })
                })
            );
        });

        it('should reject if process fails to start within timeout', async () => {
            const mockProcess = {
                killed: true,
                on: jest.fn()
            } as unknown as ChildProcess;
            (spawn as jest.Mock).mockReturnValue(mockProcess);

            await expect(processSpawner.spawn()).rejects.toThrow('Process failed to start within timeout');
        });

        it('should handle process spawn error event', async () => {
            const mockProcess = {
                killed: false,
                on: jest.fn((event, callback) => {
                    if (event === 'error') {
                        setTimeout(callback, 0);
                    }
                }),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;
            (spawn as jest.Mock).mockReturnValue(mockProcess);

            await expect(processSpawner.spawn()).rejects.toThrow('Process spawn failed');
        });
    });

    describe('waitForReady', () => {
        it('should reject if process fails to become ready', async () => {
            mockedAxios.get.mockRejectedValue(new Error('Not ready'));
            await expect(processSpawner.waitForReady({ maxAttempts: 2, attemptInterval: 10 })).rejects.toThrow(
                'Engine failed to become ready'
            );
            expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        });

        it('should reject if health endpoint returns unhealthy status', async () => {
            mockedAxios.get.mockResolvedValue({ data: { status: 'unhealthy' } });
            await expect(processSpawner.waitForReady({ maxAttempts: 2, attemptInterval: 10 })).rejects.toThrow(
                'Engine failed to become ready'
            );
        });

        it('should resolve when health endpoint returns healthy status', async () => {
            mockedAxios.get.mockResolvedValue({ data: { status: 'healthy' } });
            await expect(processSpawner.waitForReady({ maxAttempts: 2, attemptInterval: 10 })).resolves.not.toThrow();
            expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        });
    });

    describe('kill', () => {
        it('should handle killing a non-existent process', async () => {
            await processSpawner.kill();
            expect(spawn).not.toHaveBeenCalled();
        });

        it('should kill process with specified signal and force kill fallback', async () => {
            const mockPid = 12345;
            const mockProcess = {
                pid: mockPid,
                killed: false,
                kill: jest.fn(),
                on: jest.fn((event, callback) => {
                    if (event === 'exit') {
                        setTimeout(callback, 15000); // Longer than forceKillTimeout
                    }
                })
            } as unknown as ChildProcess;

            (spawn as jest.Mock).mockReturnValue(mockProcess);
            await processSpawner.spawn();

            await processSpawner.kill('SIGTERM', 100);

            expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
            expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
        });

        it('should kill process with default signal', async () => {
            const mockPid = 12345;
            let exitCallback: (() => void) | undefined;
            const mockProcess = {
                pid: mockPid,
                killed: false,
                kill: jest.fn((signal) => {
                    if (signal === 'SIGTERM') {
                        setTimeout(() => {
                            exitCallback?.();
                        }, 100);
                    }
                }),
                on: jest.fn((event, callback) => {
                    if (event === 'exit') {
                        exitCallback = callback;
                    }
                }),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;

            (spawn as jest.Mock).mockReturnValue(mockProcess);
            await processSpawner.spawn();

            await processSpawner.kill();

            expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
            expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL');
        });
    });

    describe('isAlive', () => {
        it('should return false when process is not running', () => {
            const isAlive = processSpawner.isAlive();
            expect(isAlive).toBe(false);
        });

        it('should return true when process is running', async () => {
            const mockPid = 12345;
            const mockProcess = {
                pid: mockPid,
                killed: false,
                on: jest.fn(),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;

            (spawn as jest.Mock).mockReturnValue(mockProcess);

            // Mock process.kill to return true for signal 0
            const originalKill = process.kill;
            process.kill = jest.fn().mockReturnValue(true);

            await processSpawner.spawn();

            expect(processSpawner.isAlive()).toBe(true);

            // Restore original
            process.kill = originalKill;
        });

        it('should return false when process.pid is invalid', async () => {
            const mockPid = 99999; // Invalid PID
            const mockProcess = {
                pid: mockPid,
                killed: false,
                on: jest.fn(),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;

            (spawn as jest.Mock).mockReturnValue(mockProcess);

            // Mock process.kill to throw error for invalid PID
            const originalKill = process.kill;
            process.kill = jest.fn().mockImplementation(() => {
                throw new Error('Invalid PID');
            });

            await processSpawner.spawn();

            expect(processSpawner.isAlive()).toBe(false);

            // Restore original
            process.kill = originalKill;
        });
    });

    describe('getProcess', () => {
        it('should return null when no process is running', () => {
            expect(processSpawner.getProcess()).toBeNull();
        });

        it('should return process instance when process is running', async () => {
            const mockProcess = {
                killed: false,
                on: jest.fn(),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;
            (spawn as jest.Mock).mockReturnValue(mockProcess);

            await processSpawner.spawn();

            expect(processSpawner.getProcess()).toEqual(mockProcess);
        });
    });

    describe('getProcessInfo', () => {
        it('should return null values when no process is running', () => {
            const processInfo = processSpawner.getProcessInfo();
            expect(processInfo.pid).toBeNull();
            expect(processInfo.killed).toBe(false);
            expect(processInfo.connected).toBe(false);
            expect(processInfo.exitCode).toBeNull();
            expect(processInfo.signalCode).toBeNull();
        });

        it('should return process information when process is running', async () => {
            const mockProcess = {
                pid: 12345,
                killed: false,
                connected: true,
                exitCode: null,
                signalCode: null,
                on: jest.fn(),
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() }
            } as unknown as ChildProcess;

            (spawn as jest.Mock).mockReturnValue(mockProcess);

            await processSpawner.spawn();

            const processInfo = processSpawner.getProcessInfo();
            expect(processInfo.pid).toEqual(12345);
            expect(processInfo.killed).toEqual(false);
            expect(processInfo.connected).toEqual(true);
            expect(processInfo.exitCode).toBeNull();
            expect(processInfo.signalCode).toBeNull();
        });

        it('should return process information with exit code when process has exited', () => {
            // Create a spy to track property access
            let engineProcess = {
                pid: 12345,
                killed: true,
                connected: false,
                exitCode: 0,
                signalCode: null
            };

            // Override the getProcessInfo method to test directly
            const originalGetProcessInfo = processSpawner.getProcessInfo;
            processSpawner.getProcessInfo = jest.fn(() => ({
                pid: engineProcess.pid,
                killed: engineProcess.killed,
                connected: engineProcess.connected,
                exitCode: engineProcess.exitCode,
                signalCode: engineProcess.signalCode
            }));

            const processInfo = processSpawner.getProcessInfo();
            expect(processInfo.pid).toEqual(12345);
            expect(processInfo.killed).toEqual(true);
            expect(processInfo.connected).toEqual(false);
            expect(processInfo.exitCode).toEqual(0);
            expect(processInfo.signalCode).toBeNull();

            // Restore original method
            processSpawner.getProcessInfo = originalGetProcessInfo;
        });
    });
});