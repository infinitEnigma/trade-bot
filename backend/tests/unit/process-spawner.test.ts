import { ProcessSpawner, ProcessConfig, ReadinessConfig } from '../../src/core/strategies/engine/process-spawner';
import { spawn } from 'child_process';
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
    });

    describe('kill', () => {
        it('should handle killing a non-existent process', async () => {
            await processSpawner.kill();
            expect(spawn).not.toHaveBeenCalled();
        });
    });

    describe('isAlive', () => {
        it('should return false when process is not running', () => {
            const isAlive = processSpawner.isAlive();
            expect(isAlive).toBe(false);
        });
    });
});