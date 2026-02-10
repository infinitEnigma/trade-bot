/** @format */

import { marketStreamLogger as logger } from "../../../core/logging/context-aware-logger.service";
import {
  SubscriptionStats,
  SubscriptionConfig,
  DEFAULT_SUBSCRIPTION_CONFIG,
} from "./types";

/**
 * Manages market data subscriptions with reference counting and cleanup
 * Handles automatic cleanup of unused subscriptions to prevent resource leaks
 */
export class SubscriptionManager {
  private activeSubscriptions: Map<
    string,
    { count: number; lastUsed: number }
  > = new Map();
  private subscriptionTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingSubscriptions: Set<string> = new Set();

  private config: SubscriptionConfig;

  constructor(config: SubscriptionConfig = DEFAULT_SUBSCRIPTION_CONFIG) {
    this.config = config;
  }

  /**
   * Subscribe to a market data topic with reference counting
   */
  subscribe(clientId: string, topic: string): void {
    const existing = this.activeSubscriptions.get(topic);
    const now = Date.now();

    if (existing) {
      existing.count += 1;
      existing.lastUsed = now;
      logger.debug("Subscription reference incremented", {
        topic,
        count: existing.count,
        clientId,
      });
    } else {
      this.activeSubscriptions.set(topic, { count: 1, lastUsed: now });
      logger.info("New subscription activated", { topic, clientId });
    }

    // Cancel any pending cleanup timer
    const cleanupTimer = this.subscriptionTimers.get(topic);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.subscriptionTimers.delete(topic);
    }
  }

  /**
   * Unsubscribe from a market data topic with reference counting
   */
  unsubscribe(clientId: string, topic: string): void {
    const existing = this.activeSubscriptions.get(topic);
    if (!existing) {
      logger.warn("Attempted to unsubscribe from non-existent topic", {
        topic,
        clientId,
      });
      return;
    }

    existing.count -= 1;
    existing.lastUsed = Date.now();

    if (existing.count <= 0) {
      // Schedule cleanup after delay
      const cleanupDelay = this.getCleanupDelay(topic);
      const cleanupTimer = setTimeout(() => {
        this.cleanupSubscription(topic);
      }, cleanupDelay);

      this.subscriptionTimers.set(topic, cleanupTimer);
      logger.debug("Subscription scheduled for cleanup", {
        topic,
        delay: cleanupDelay,
      });
    } else {
      logger.debug("Subscription reference decremented", {
        topic,
        count: existing.count,
        clientId,
      });
    }
  }

  /**
   * Add a topic to pending subscriptions queue
   */
  addPendingSubscription(topic: string): void {
    this.pendingSubscriptions.add(topic);
    logger.debug("Topic added to pending subscriptions", { topic });
  }

  /**
   * Remove a topic from pending subscriptions queue
   */
  clearPendingSubscription(topic: string): void {
    this.pendingSubscriptions.delete(topic);
    logger.debug("Topic cleared from pending subscriptions", { topic });
  }

  /**
   * Get all pending subscriptions
   */
  getPendingSubscriptions(): string[] {
    return Array.from(this.pendingSubscriptions);
  }

  /**
   * Check if a topic has active subscriptions
   */
  hasActiveSubscription(topic: string): boolean {
    const subscription = this.activeSubscriptions.get(topic);
    return subscription ? subscription.count > 0 : false;
  }

  /**
   * Get cleanup delay based on topic type
   */
  private getCleanupDelay(topic: string): number {
    if (topic.includes("@markprice")) {
      return this.config.markPriceDelay;
    }

    if (topic.includes("@kline_1m") || topic.includes("@kline_5m")) {
      return this.config.klineShortDelay;
    }

    if (topic.includes("@kline_1h")) {
      return this.config.klineHourDelay;
    }

    if (topic.includes("@ticker")) {
      return this.config.tickerDelay;
    }

    return this.config.defaultDelay;
  }

  /**
   * Clean up a subscription that has no active references
   */
  private cleanupSubscription(topic: string): void {
    this.activeSubscriptions.delete(topic);
    this.pendingSubscriptions.delete(topic);
    logger.info("Subscription cleaned up", { topic });
  }

  /**
   * Get subscription statistics
   */
  getStats(): SubscriptionStats {
    const topics = Array.from(this.activeSubscriptions.keys());
    const totalReferences = Array.from(
      this.activeSubscriptions.values()
    ).reduce((sum, sub) => sum + sub.count, 0);

    return {
      activeSubscriptions: this.activeSubscriptions.size,
      totalReferences,
      topics,
    };
  }

  /**
   * Clear all subscriptions and timers
   */
  clearAll(): void {
    // Clear all active subscriptions
    this.activeSubscriptions.clear();

    // Clear all pending subscriptions
    this.pendingSubscriptions.clear();

    // Clear all cleanup timers
    this.subscriptionTimers.forEach(timer => clearTimeout(timer));
    this.subscriptionTimers.clear();

    logger.info("All subscriptions cleared");
  }

  /**
   * Get detailed subscription information
   */
  getDetailedStats(): {
    activeSubscriptions: Array<{
      topic: string;
      count: number;
      lastUsed: number;
      age: number;
    }>;
    pendingSubscriptions: string[];
    cleanupTimers: number;
  } {
    const activeSubscriptions = Array.from(
      this.activeSubscriptions.entries()
    ).map(([topic, data]) => ({
      topic,
      count: data.count,
      lastUsed: data.lastUsed,
      age: Date.now() - data.lastUsed,
    }));

    return {
      activeSubscriptions,
      pendingSubscriptions: Array.from(this.pendingSubscriptions),
      cleanupTimers: this.subscriptionTimers.size,
    };
  }

  /**
   * Force cleanup of stale subscriptions
   */
  cleanupStale(maxAge: number = 300000): number {
    // 5 minutes default
    const now = Date.now();
    let cleaned = 0;

    for (const [topic, data] of this.activeSubscriptions.entries()) {
      if (now - data.lastUsed > maxAge) {
        this.cleanupSubscription(topic);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info("Stale subscriptions cleaned up", { cleaned });
    }

    return cleaned;
  }
}
