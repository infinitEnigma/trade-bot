/** @format */

// Create a mock logger instance
const mockLoggerInstance = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
    startOperation: jest.fn(),
    performance: jest.fn(),
    http: jest.fn(),
    errorWithInfo: jest.fn(),
};

// Mock the entire core/logging module directly
jest.mock('../../src/core/logging', () => {
    const original = jest.requireActual('../../src/core/logging');
    return {
        ...original,
        databaseLogger: mockLoggerInstance,
    };
});

// Now import the pool functions after mocking
import {
    getTimeoutStats,
    updateTimeoutConfig,
    resetTimeoutConfig,
    getTimeoutConfig,
    QueryTimeout,
} from '../../src/database/pool';


describe('Database Pool - Timeout Configuration Health Checks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetTimeoutConfig();
    });

    afterEach(() => {
        resetTimeoutConfig();
    });

    describe('getTimeoutStats', () => {
        it('should return healthy status with default configuration', () => {
            const stats = getTimeoutStats();

            expect(stats.config.default).toBe(QueryTimeout.SLOW);
            expect(stats.config.fast).toBe(QueryTimeout.FAST);
            expect(stats.config.medium).toBe(QueryTimeout.MEDIUM);
            expect(stats.config.slow).toBe(QueryTimeout.SLOW);
            expect(stats.config.complex).toBe(QueryTimeout.COMPLEX);
            expect(stats.config.report).toBe(QueryTimeout.REPORT);
            expect(stats.health.status).toBe('healthy');
            expect(stats.health.issues).toEqual([]);
            expect(stats.recommendations).toEqual([]);
        });

        it('should detect issue when default timeout is too high (> 60s)', () => {
            updateTimeoutConfig({ default: 120000 as any }); // 2 minutes - exceeds 60000 threshold

            const stats = getTimeoutStats();

            expect(stats.health.status).toBe('warning');
            expect(stats.health.issues).toContain('Default timeout > 60s may allow runaway queries');
            expect(stats.recommendations).toContain('Consider reducing default timeout to 30s');
        });

        it('should detect issue when fast timeout is too high (> 10s)', () => {
            updateTimeoutConfig({ fast: 15000 as any }); // 15 seconds - exceeds 10000 threshold

            const stats = getTimeoutStats();

            expect(stats.health.status).toBe('warning');
            expect(stats.health.issues).toContain('Fast query timeout > 10s defeats the purpose');
            expect(stats.recommendations).toContain('Fast queries should timeout < 10s');
        });

        it('should detect issue when report timeout is too low (< 60s)', () => {
            updateTimeoutConfig({ report: 30000 as any }); // 30 seconds - below 60000 threshold

            const stats = getTimeoutStats();

            expect(stats.health.status).toBe('warning');
            expect(stats.health.issues).toContain('Report timeout < 60s may interrupt long-running reports');
            expect(stats.recommendations).toContain('Consider increasing report timeout to 5+ minutes');
        });

        it('should detect multiple issues simultaneously', () => {
            updateTimeoutConfig({
                default: 120000 as any, // Too high (> 60s)
                fast: 15000 as any, // Too high (> 10s)
                report: 30000 as any, // Too low (< 60s)
            });

            const stats = getTimeoutStats();

            expect(stats.health.status).toBe('warning');
            expect(stats.health.issues).toHaveLength(3);
            expect(stats.recommendations).toHaveLength(3);
            expect(stats.health.issues).toContain('Default timeout > 60s may allow runaway queries');
            expect(stats.health.issues).toContain('Fast query timeout > 10s defeats the purpose');
            expect(stats.health.issues).toContain('Report timeout < 60s may interrupt long-running reports');
        });

        it('should return immutable config copy', () => {
            const stats = getTimeoutStats();
            (stats.config as any).default = 999999;

            const freshStats = getTimeoutStats();
            expect(freshStats.config.default).toBe(QueryTimeout.SLOW);
        });
    });

    describe('updateTimeoutConfig', () => {
        it('should update timeout configuration', () => {
            updateTimeoutConfig({ fast: 3000 as any });
            const config = getTimeoutConfig();
            expect(config.fast).toBe(3000);
        });
    });

    describe('resetTimeoutConfig', () => {
        it('should reset all timeouts to defaults', () => {
            updateTimeoutConfig({ fast: 1000 as any, medium: 5000 as any });
            resetTimeoutConfig();
            const config = getTimeoutConfig();
            expect(config.fast).toBe(QueryTimeout.FAST);
            expect(config.medium).toBe(QueryTimeout.MEDIUM);
        });
    });
});

describe('Database Pool - QueryTimeout Enum', () => {
    it('should have correct timeout values', () => {
        expect(QueryTimeout.FAST).toBe(5000);
        expect(QueryTimeout.MEDIUM).toBe(15000);
        expect(QueryTimeout.SLOW).toBe(30000);
        expect(QueryTimeout.COMPLEX).toBe(60000);
        expect(QueryTimeout.REPORT).toBe(300000);
    });
});

describe('Database Pool - getTimeoutConfig', () => {
    beforeEach(() => {
        resetTimeoutConfig();
    });

    it('should return a copy of the current configuration', () => {
        const config1 = getTimeoutConfig();
        const config2 = getTimeoutConfig();

        expect(config1).toEqual(config2);
        expect(config1).not.toBe(config2); // Different objects
    });

    it('should reflect updated values', () => {
        updateTimeoutConfig({ fast: 7500 as any });

        const config = getTimeoutConfig();
        expect(config.fast).toBe(7500);
    });
});

