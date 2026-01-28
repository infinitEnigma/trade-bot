/** @format */

/**
 * GLOBAL BALANCE MANAGER
 *
 * Prevents balance auto-refresh flood by coordinating all balance updates.
 * Single timer for entire app instead of individual timers per component.
 * Dramatically reduces API calls while maintaining data freshness.
 */

import { balanceApi } from "../../infrastructure/api";
import { Balance } from "../../../../shared/src";

interface BalanceSubscriber {
    callback: (balance: Balance) => void;
    id: string;
}

class GlobalBalanceManager {
    private static instance: GlobalBalanceManager;
    private subscribers = new Map<string, BalanceSubscriber>();
    private refreshTimer: NodeJS.Timeout | null = null;
    private lastBalanceData: Balance | null = null;
    private isRefreshing = false;

    private constructor() { }

    static getInstance(): GlobalBalanceManager {
        if (!GlobalBalanceManager.instance) {
            GlobalBalanceManager.instance = new GlobalBalanceManager();
        }
        return GlobalBalanceManager.instance;
    }

    /**
     * Subscribe to balance updates
     */
    subscribe(id: string, callback: (balance: Balance) => void): () => void {
        console.log(`💰 Global Balance: Subscribing ${id}`);

        this.subscribers.set(id, { callback, id });

        // Start global timer if this is the first subscriber
        if (this.subscribers.size === 1) {
            this.startGlobalTimer();
        }

        // Return unsubscribe function
        return () => this.unsubscribe(id);
    }

    /**
     * Unsubscribe from balance updates
     */
    private unsubscribe(id: string): void {
        console.log(`💰 Global Balance: Unsubscribing ${id}`);

        this.subscribers.delete(id);

        // Stop timer if no more subscribers
        if (this.subscribers.size === 0) {
            this.stopGlobalTimer();
        }
    }

    /**
     * Start global refresh timer
     */
    private startGlobalTimer(): void {
        if (this.refreshTimer) return;

        console.log('💰 Global Balance: Starting global timer (5 minutes)');

        this.refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.refreshBalance();
            }
        }, 300000); // 5 minutes - ONE timer for entire app
    }

    /**
     * Stop global refresh timer
     */
    private stopGlobalTimer(): void {
        if (this.refreshTimer) {
            console.log('💰 Global Balance: Stopping global timer');
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Refresh balance data and notify all subscribers
     */
    private async refreshBalance(): Promise<void> {
        if (this.isRefreshing || this.subscribers.size === 0) return;

        this.isRefreshing = true;
        console.log(`💰 Global Balance: Refreshing for ${this.subscribers.size} subscribers`);

        try {
            const response = await balanceApi.getCurrentBalance();

            if (response.success && response.data) {
                this.lastBalanceData = response.data;
                console.log('💰 Global Balance: Updated, notifying subscribers');

                // Notify all subscribers
                this.subscribers.forEach(subscriber => {
                    try {
                        subscriber.callback(response.data);
                    } catch (error) {
                        console.error(`💰 Global Balance: Subscriber ${subscriber.id} callback failed:`, error);
                    }
                });
            } else {
                console.warn('💰 Global Balance: Refresh failed:', response.error);
            }
        } catch (error) {
            console.error('💰 Global Balance: Refresh error:', error);
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Get last known balance data
     */
    getLastBalanceData(): Balance | null {
        return this.lastBalanceData;
    }

    /**
     * Force immediate refresh
     */
    async forceRefresh(): Promise<void> {
        console.log('💰 Global Balance: Force refresh requested');
        await this.refreshBalance();
    }

    /**
     * Get subscriber count (for debugging)
     */
    getSubscriberCount(): number {
        return this.subscribers.size;
    }

    /**
     * Cleanup all subscribers and timers
     */
    cleanup(): void {
        console.log('💰 Global Balance: Cleaning up');
        this.subscribers.clear();
        this.stopGlobalTimer();
        this.lastBalanceData = null;
    }
}

// Export singleton instance
export const globalBalanceManager = GlobalBalanceManager.getInstance();