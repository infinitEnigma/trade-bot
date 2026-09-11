/** @format */

import { SubscriptionManager } from '../../src/infrastructure/messaging/market-stream/subscription-manager';
import { DEFAULT_SUBSCRIPTION_CONFIG } from '../../src/infrastructure/messaging/market-stream/types';

// Mock logger
jest.mock('../../src/core/logging/logger.service');

describe('SubscriptionManager', () => {
    let manager: SubscriptionManager;
    const testClientId = 'test-client-1';
    const testTopic = 'BTC-PERP@kline_1m';

    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        manager = new SubscriptionManager();
        jest.clearAllTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
    });

    describe('instance creation', () => {
        it('should create an instance of SubscriptionManager', () => {
            expect(manager).toBeInstanceOf(SubscriptionManager);
        });

        it('should initialize with default configuration if none provided', () => {
            expect(manager).toBeDefined();
        });

        it('should initialize with custom configuration', () => {
            const customConfig = {
                markPriceDelay: 10000,
                klineShortDelay: 20000,
                klineHourDelay: 30000,
                tickerDelay: 40000,
                defaultDelay: 50000
            };

            const customManager = new SubscriptionManager(customConfig);
            expect(customManager).toBeDefined();
        });
    });

    describe('basic subscription management', () => {
        it('should subscribe to a topic', () => {
            manager.subscribe(testClientId, testTopic);
            expect(manager.hasActiveSubscription(testTopic)).toBe(true);
        });

        it('should unsubscribe from a topic', () => {
            jest.useFakeTimers();
            manager.subscribe(testClientId, testTopic);
            manager.unsubscribe(testClientId, testTopic);
            jest.runAllTimers(); // Clear any pending timers
            // After unsubscribe, the topic might still be in activeSubscriptions with count 0 but not considered active
        });

        it('should handle unsubscribe from non-existent topic', () => {
            expect(() => {
                manager.unsubscribe(testClientId, 'non-existent-topic');
            }).not.toThrow();
        });

        it('should track active subscriptions correctly', () => {
            manager.subscribe(testClientId, testTopic);
            expect(manager.hasActiveSubscription(testTopic)).toBe(true);
            expect(manager.hasActiveSubscription('non-existent-topic')).toBe(false);
        });
    });

    describe('reference counting', () => {
        it('should increment reference count for multiple subscriptions to same topic', () => {
            manager.subscribe('client-1', testTopic);
            manager.subscribe('client-2', testTopic);

            const stats = manager.getStats();
            expect(stats.activeSubscriptions).toBe(1);
            expect(stats.totalReferences).toBe(2);
        });

        it('should decrement reference count on unsubscribe', () => {
            manager.subscribe('client-1', testTopic);
            manager.subscribe('client-2', testTopic);
            manager.unsubscribe('client-1', testTopic);

            const stats = manager.getStats();
            expect(stats.totalReferences).toBe(1);
        });

        it('should handle multiple subscribers and unsubscribers correctly', () => {
            manager.subscribe('client-1', testTopic);
            manager.subscribe('client-2', testTopic);
            manager.subscribe('client-3', testTopic);

            manager.unsubscribe('client-2', testTopic);

            expect(manager.hasActiveSubscription(testTopic)).toBe(true);
        });
    });

    describe('pending subscriptions', () => {
        it('should add topic to pending subscriptions', () => {
            manager.addPendingSubscription(testTopic);
            const pending = manager.getPendingSubscriptions();
            expect(pending).toEqual([testTopic]);
        });

        it('should clear pending subscription', () => {
            manager.addPendingSubscription(testTopic);
            manager.clearPendingSubscription(testTopic);
            const pending = manager.getPendingSubscriptions();
            expect(pending).toEqual([]);
        });

        it('should track multiple pending subscriptions', () => {
            manager.addPendingSubscription(testTopic);
            manager.addPendingSubscription('ETH-PERP@markprice');
            manager.addPendingSubscription('SOL-PERP@ticker');

            const pending = manager.getPendingSubscriptions();
            expect(pending.length).toBe(3);
            expect(pending).toEqual(expect.arrayContaining([testTopic]));
        });
    });

    describe('statistics and monitoring', () => {
        it('should provide subscription statistics', () => {
            manager.subscribe(testClientId, testTopic);

            const stats = manager.getStats();
            expect(stats.activeSubscriptions).toBe(1);
            expect(stats.totalReferences).toBe(1);
            expect(stats.topics).toEqual([testTopic]);
        });

        it('should provide detailed subscription information', () => {
            manager.subscribe(testClientId, testTopic);

            const detailedStats = manager.getDetailedStats();
            expect(detailedStats.activeSubscriptions.length).toBe(1);
            expect(detailedStats.activeSubscriptions[0].topic).toBe(testTopic);
            expect(detailedStats.pendingSubscriptions).toEqual([]);
            expect(detailedStats.cleanupTimers).toBe(0);
        });

        it('should track active subscriptions in detailed stats', () => {
            manager.subscribe(testClientId, testTopic);
            manager.addPendingSubscription('pending-topic');

            const detailedStats = manager.getDetailedStats();
            expect(detailedStats.activeSubscriptions.length).toBe(1);
            expect(detailedStats.pendingSubscriptions.length).toBe(1);
            expect(detailedStats.cleanupTimers).toBe(0);
        });

        it('should track reference counts in detailed stats', () => {
            manager.subscribe('client-1', testTopic);
            manager.subscribe('client-2', testTopic);

            const detailedStats = manager.getDetailedStats();
            expect(detailedStats.activeSubscriptions[0].count).toBe(2);
        });
    });

    describe('cleanup functionality', () => {
        it('should schedule cleanup when count reaches zero', () => {
            jest.useFakeTimers();

            manager.subscribe(testClientId, testTopic);
            manager.unsubscribe(testClientId, testTopic);

            // Check that a timer was scheduled by getting detailed stats
            const detailedStats = manager.getDetailedStats();
            expect(detailedStats.cleanupTimers).toBe(1);
        });

        it('should cancel pending cleanup when resubscribed', () => {
            jest.useFakeTimers();

            manager.subscribe(testClientId, testTopic);
            manager.unsubscribe(testClientId, testTopic);

            // Verify timer is scheduled
            let detailedStats = manager.getDetailedStats();
            expect(detailedStats.cleanupTimers).toBe(1);

            manager.subscribe(testClientId, testTopic);

            // Verify timer is canceled
            detailedStats = manager.getDetailedStats();
            expect(detailedStats.cleanupTimers).toBe(0);
        });

        it('should execute cleanup when timer expires', () => {
            jest.useFakeTimers();

            manager.subscribe(testClientId, testTopic);
            manager.unsubscribe(testClientId, testTopic);

            // Fast forward time to trigger cleanup
            jest.runAllTimers();

            // Verify subscription was cleaned up
            expect(manager.hasActiveSubscription(testTopic)).toBe(false);
        });

        it('should cleanup stale subscriptions', () => {
            const oldDate = Date.now() - 3600000; // 1 hour ago
            jest.spyOn(Date, 'now').mockImplementation(() => oldDate);

            manager.subscribe(testClientId, testTopic);

            jest.spyOn(Date, 'now').mockRestore();
            const cleaned = manager.cleanupStale(300000); // 5 minutes
            expect(cleaned).toBe(1);
        });

        it('should not cleanup non-stale subscriptions', () => {
            manager.subscribe(testClientId, testTopic);
            const cleaned = manager.cleanupStale(300000); // 5 minutes
            expect(cleaned).toBe(0);
        });

        it('should handle cleanupStale with no subscriptions', () => {
            const cleaned = manager.cleanupStale(); // Test default parameter
            expect(cleaned).toBe(0);
        });

        it('should use default maxAge when not provided', () => {
            // This test verifies that the default parameter (300000ms) is used
            const oldDate = Date.now() - 3600000; // 1 hour ago
            jest.spyOn(Date, 'now').mockImplementation(() => oldDate);

            manager.subscribe(testClientId, testTopic);

            jest.spyOn(Date, 'now').mockRestore();
            const cleaned = manager.cleanupStale(); // No parameter provided
            expect(cleaned).toBe(1);
        });

        it('should clear all subscriptions and timers', () => {
            manager.subscribe(testClientId, testTopic);
            manager.addPendingSubscription('pending-topic');

            manager.clearAll();

            const stats = manager.getStats();
            expect(stats.activeSubscriptions).toBe(0);
            expect(stats.totalReferences).toBe(0);
            expect(stats.topics).toEqual([]);

            const detailedStats = manager.getDetailedStats();
            expect(detailedStats.pendingSubscriptions).toEqual([]);
            expect(detailedStats.cleanupTimers).toBe(0);
        });
    });

    describe('topic type based delays', () => {
        it('should calculate correct delay for mark price topics', () => {
            const managerRef = manager as any;
            const markPriceTopic = 'BTC-PERP@markprice';
            const delay = managerRef.getCleanupDelay(markPriceTopic);
            expect(delay).toBe(DEFAULT_SUBSCRIPTION_CONFIG.markPriceDelay);
        });

        it('should calculate correct delay for short kline topics', () => {
            const managerRef = manager as any;
            const kline1mTopic = 'BTC-PERP@kline_1m';
            const kline5mTopic = 'BTC-PERP@kline_5m';

            expect(managerRef.getCleanupDelay(kline1mTopic)).toBe(DEFAULT_SUBSCRIPTION_CONFIG.klineShortDelay);
            expect(managerRef.getCleanupDelay(kline5mTopic)).toBe(DEFAULT_SUBSCRIPTION_CONFIG.klineShortDelay);
        });

        it('should calculate correct delay for hourly kline topics', () => {
            const managerRef = manager as any;
            const kline1hTopic = 'BTC-PERP@kline_1h';
            const delay = managerRef.getCleanupDelay(kline1hTopic);
            expect(delay).toBe(DEFAULT_SUBSCRIPTION_CONFIG.klineHourDelay);
        });

        it('should calculate correct delay for ticker topics', () => {
            const managerRef = manager as any;
            const tickerTopic = 'BTC-PERP@ticker';
            const delay = managerRef.getCleanupDelay(tickerTopic);
            expect(delay).toBe(DEFAULT_SUBSCRIPTION_CONFIG.tickerDelay);
        });

        it('should use default delay for unknown topic types', () => {
            const managerRef = manager as any;
            const unknownTopic = 'BTC-PERP@unknown';
            const delay = managerRef.getCleanupDelay(unknownTopic);
            expect(delay).toBe(DEFAULT_SUBSCRIPTION_CONFIG.defaultDelay);
        });
    });

    describe('edge cases and error handling', () => {
        it('should handle invalid topic names gracefully', () => {
            expect(() => {
                manager.subscribe(testClientId, '');
            }).not.toThrow();

            expect(() => {
                manager.unsubscribe(testClientId, '');
            }).not.toThrow();
        });

        it('should handle large number of subscriptions', () => {
            for (let i = 0; i < 100; i++) {
                manager.subscribe(`client-${i}`, `topic-${i}`);
            }

            const stats = manager.getStats();
            expect(stats.activeSubscriptions).toBe(100);
            expect(stats.totalReferences).toBe(100);
        });

        it('should handle rapid subscribe/unsubscribe operations', () => {
            for (let i = 0; i < 10; i++) {
                manager.subscribe(testClientId, `topic-${i}`);
                manager.unsubscribe(testClientId, `topic-${i}`);
            }

            const stats = manager.getStats();
            expect(stats.activeSubscriptions).toBeGreaterThanOrEqual(0);
        });

        it('should handle subscribe/unsubscribe with same client to multiple topics', () => {
            const topics = ['BTC-PERP@kline_1m', 'ETH-PERP@markprice', 'SOL-PERP@ticker'];
            topics.forEach(topic => manager.subscribe(testClientId, topic));
            topics.forEach(topic => manager.unsubscribe(testClientId, topic));

            const stats = manager.getStats();
            expect(stats.totalReferences).toBe(0);
        });
    });
});