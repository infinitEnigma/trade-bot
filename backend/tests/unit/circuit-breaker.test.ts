import { CircuitBreaker, CircuitState, CircuitBreakerConfig } from '../../src/core/strategies/engine/circuit-breaker';

describe('CircuitBreaker', () => {
    let circuitBreaker: CircuitBreaker;
    const defaultConfig: CircuitBreakerConfig = {
        failureThreshold: 2,
        recoveryTimeout: 100,
        monitoringPeriod: 60000,
        successThreshold: 2,
        timeout: 100,
    };

    beforeEach(() => {
        circuitBreaker = new CircuitBreaker(defaultConfig);
    });

    describe('constructor', () => {
        it('should create a CircuitBreaker instance with default configuration', () => {
            const cb = new CircuitBreaker();
            expect(cb).toBeInstanceOf(CircuitBreaker);
            expect(cb.getState()).toBe(CircuitState.CLOSED);
        });

        it('should create a CircuitBreaker instance with custom configuration', () => {
            const customConfig: CircuitBreakerConfig = {
                failureThreshold: 3,
                recoveryTimeout: 5000,
                monitoringPeriod: 30000,
                successThreshold: 1,
                timeout: 3000,
            };
            const cb = new CircuitBreaker(customConfig);
            const analysis = cb.getAnalysis();
            expect(analysis.config).toEqual(customConfig);
        });
    });

    describe('executeWithCircuitBreaker', () => {
        it('should execute successful operations in closed state', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await circuitBreaker.executeWithCircuitBreaker(mockOperation);

            expect(result.success).toBe(true);
            expect(result.result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
        });

        it('should handle failed operations in closed state', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));

            const result = await circuitBreaker.executeWithCircuitBreaker(mockOperation);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Operation failed');
            expect(mockOperation).toHaveBeenCalledTimes(1);
            expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
        });

        it('should open circuit when failure threshold is reached', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));

            await circuitBreaker.executeWithCircuitBreaker(mockOperation);
            await circuitBreaker.executeWithCircuitBreaker(mockOperation);

            expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
        });

        it('should reject requests in open state', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            // Open the circuit
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            const result = await circuitBreaker.executeWithCircuitBreaker(mockOperation);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Circuit breaker open');
            expect(mockOperation).not.toHaveBeenCalled();
        });

        it('should attempt recovery after recovery timeout', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            // Open the circuit
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            // Wait for recovery timeout
            await new Promise(resolve => setTimeout(resolve, defaultConfig.recoveryTimeout + 50));

            const result = await circuitBreaker.executeWithCircuitBreaker(mockOperation);

            expect(result.success).toBe(true);
            expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);
        });

        it('should close circuit after successful recovery in half-open state', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            // Open the circuit
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            // Wait for recovery timeout
            await new Promise(resolve => setTimeout(resolve, defaultConfig.recoveryTimeout + 50));

            // Perform successful operations to meet success threshold
            await circuitBreaker.executeWithCircuitBreaker(mockOperation);
            await circuitBreaker.executeWithCircuitBreaker(mockOperation);

            expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
        });

        it('should re-open circuit on failure in half-open state', async () => {
            // Open the circuit
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            // Wait for recovery timeout
            await new Promise(resolve => setTimeout(resolve, defaultConfig.recoveryTimeout + 50));

            // Fail in half-open state
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
        });

        it('should handle operation timeouts', async () => {
            const mockOperation = jest.fn().mockImplementation(() =>
                new Promise(resolve => setTimeout(resolve, defaultConfig.timeout + 50))
            );

            const result = await circuitBreaker.executeWithCircuitBreaker(mockOperation);

            expect(result.success).toBe(false);
            expect(result.error).toContain('timed out');
        });
    });

    describe('manual operations', () => {
        it('should manually open the circuit', () => {
            circuitBreaker.open();
            expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
        });

        it('should manually reset the circuit', async () => {
            // Open the circuit
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            circuitBreaker.reset();

            expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
            const stats = circuitBreaker.getStats();
            expect(stats.failures).toBe(0);
            expect(stats.successes).toBe(0);
        });
    });

    describe('configuration', () => {
        it('should update configuration', () => {
            const newConfig = {
                failureThreshold: 5,
                recoveryTimeout: 30000,
                monitoringPeriod: 60000,
                successThreshold: 3,
                timeout: 10000,
            };

            circuitBreaker.updateConfig(newConfig);

            const analysis = circuitBreaker.getAnalysis();
            expect(analysis.config).toEqual(newConfig);
        });

        it('should update partial configuration', () => {
            circuitBreaker.updateConfig({ failureThreshold: 10 });

            const analysis = circuitBreaker.getAnalysis();
            expect(analysis.config.failureThreshold).toBe(10);
            expect(analysis.config.recoveryTimeout).toEqual(defaultConfig.recoveryTimeout);
        });
    });

    describe('stats and health', () => {
        it('should get current stats', () => {
            const stats = circuitBreaker.getStats();
            expect(stats.state).toBe(CircuitState.CLOSED);
            expect(stats.failures).toBe(0);
            expect(stats.successes).toBe(0);
            expect(typeof stats.lastFailureTime).toBe('number');
            expect(typeof stats.lastSuccessTime).toBe('number');
            expect(typeof stats.nextAttemptTime).toBe('number');
        });

        it('should track failure statistics', async () => {
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            const stats = circuitBreaker.getStats();
            expect(stats.failures).toBe(1);
            expect(stats.lastFailureTime).toBeGreaterThan(0);
        });

        it('should track success statistics', async () => {
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockResolvedValue('success'));

            const stats = circuitBreaker.getStats();
            expect(stats.successes).toBe(1);
            expect(stats.lastSuccessTime).toBeGreaterThan(0);
        });

        it('should get health status', () => {
            const health = circuitBreaker.getHealthStatus();
            expect(health.healthy).toBe(true);
            expect(health.state).toBe(CircuitState.CLOSED);
            expect(Array.isArray(health.issues)).toBe(true);
            expect(Array.isArray(health.recommendations)).toBe(true);
        });

        it('should report unhealthy status when circuit is open', async () => {
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            const health = circuitBreaker.getHealthStatus();
            expect(health.healthy).toBe(false);
            expect(health.issues).toEqual(expect.arrayContaining([
                expect.stringContaining('Circuit breaker is open')
            ]));
        });

        it('should get detailed analysis', () => {
            const analysis = circuitBreaker.getAnalysis();

            expect(analysis.stats).toEqual(circuitBreaker.getStats());
            expect(analysis.health).toEqual(circuitBreaker.getHealthStatus());
            expect(typeof analysis.metrics.failureRate).toBe('number');
            expect(typeof analysis.metrics.averageTimeBetweenFailures).toBe('number');
            expect(typeof analysis.metrics.uptimePercentage).toBe('number');
        });

        it('should calculate metrics correctly', async () => {
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockResolvedValue('success'));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            const analysis = circuitBreaker.getAnalysis();
            expect(analysis.metrics.failureRate).toBeGreaterThan(0);
            expect(analysis.metrics.uptimePercentage).toBeLessThan(100);
        });
    });

    describe('helper methods', () => {
        it('should check if requests are allowed in closed state', () => {
            expect(circuitBreaker.isRequestAllowed()).toBe(true);
        });

        it('should check if requests are allowed in open state', async () => {
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            expect(circuitBreaker.isRequestAllowed()).toBe(false);
        });

        it('should check if requests are allowed in half-open state', async () => {
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));
            await circuitBreaker.executeWithCircuitBreaker(jest.fn().mockRejectedValue(new Error('Failed')));

            await new Promise(resolve => setTimeout(resolve, defaultConfig.recoveryTimeout + 50));

            expect(circuitBreaker.isRequestAllowed()).toBe(true);
            expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);
        });
    });
});