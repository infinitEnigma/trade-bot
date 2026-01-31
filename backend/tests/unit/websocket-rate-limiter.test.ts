/** @format */

import { WebSocketRateLimiter, webSocketRateLimiter } from '../../src/infrastructure/security/rate-limiter/websocket-rate-limiter.adapter';

describe('WebSocketRateLimiter', () => {
    describe('Rate limiter functionality', () => {
        it('should be exported correctly', () => {
            expect(WebSocketRateLimiter).toBeDefined();
            expect(typeof WebSocketRateLimiter).toBe('function');
        });

        it('should have a singleton instance', () => {
            expect(webSocketRateLimiter).toBeDefined();
            expect(webSocketRateLimiter instanceof WebSocketRateLimiter).toBe(true);
        });

        it('should export canSubscribe method', () => {
            expect(typeof webSocketRateLimiter.canSubscribe).toBe('function');
        });

        it('should export recordSubscription method', () => {
            expect(typeof webSocketRateLimiter.recordSubscription).toBe('function');
        });

        it('should export getRateLimitInfo method', () => {
            expect(typeof webSocketRateLimiter.getRateLimitInfo).toBe('function');
        });
    });

    describe('Rate limiting operations', () => {
        it('should handle canSubscribe correctly', async () => {
            const result = await webSocketRateLimiter.canSubscribe('test-user-1');
            expect(typeof result).toBe('boolean');
            expect(result).toBe(true);
        });

        it('should handle recordSubscription correctly', async () => {
            await webSocketRateLimiter.recordSubscription('test-user-2');
            // Should not throw an error
            expect(true).toBe(true);
        });

        it('should handle getRateLimitInfo correctly', async () => {
            const info = await webSocketRateLimiter.getRateLimitInfo('test-user-3');
            expect(info).toBeDefined();
            expect(typeof info).toBe('object');
            expect(typeof info.used).toBe('number');
            expect(typeof info.remaining).toBe('number');
            expect(typeof info.resetTime).toBe('number');
            expect(typeof info.isBlocked).toBe('boolean');
            expect(info.used >= 0).toBe(true);
            expect(info.remaining >= 0).toBe(true);
            expect(info.resetTime > Date.now()).toBe(true);
        });
    });
});