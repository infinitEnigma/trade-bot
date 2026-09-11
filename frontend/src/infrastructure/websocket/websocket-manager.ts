/** @format */

/**
 * Shared WebSocket Subscription Manager
 *
 * Prevents race conditions and duplicate subscriptions by maintaining
 * reference counting for each symbol subscription.
 */
import { Socket } from "socket.io-client";

/**
 * WebSocket Data Types
 * These interfaces define the structure of data received from WebSocket connections
 */

interface MarketData {
    symbol: string;
    timestamp: number;
    type: 'ticker' | 'kline' | 'orderbook' | 'markprice';
}

interface TickerData extends MarketData {
    type: 'ticker';
    price: string;
    change24h: string;
    volume24h: string;
    high24h: string;
    low24h: string;
    mark_price: string;
    index_price: string;
    open_interest: string;
    est_funding_rate: string;
}

interface KlineData extends MarketData {
    type: 'kline';
    time: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    interval: string;
}

interface OrderbookData extends MarketData {
    type: 'orderbook';
    bids: Array<[string, string]>; // [price, quantity]
    asks: Array<[string, string]>; // [price, quantity]
    timestamp: number;
}

interface MarkPriceData extends MarketData {
    type: 'markprice';
    price: string;
    funding_rate: string;
    next_funding_time: number;
    impact_ask_price: string;
    impact_bid_price: string;
}

/**
 * Union type for all possible WebSocket data types
 */
type WebSocketData = TickerData | KlineData | OrderbookData | MarkPriceData;

interface SubscriptionCallback {
    id: string;
    callback: (data: WebSocketData) => void;
}

interface SubscriptionInfo {
    symbol: string;
    refCount: number;
    callbacks: Map<string, SubscriptionCallback>;
    isSubscribed: boolean;
}

class WebSocketSubscriptionManager {
    private subscriptions = new Map<string, SubscriptionInfo>();
    private socket: Socket | null = null;
    private connectionId: string | null = null;

    // Set the WebSocket connection
    setSocket(socket: Socket, connectionId?: string) {
        // Clean up previous connection
        if (this.socket && this.connectionId !== connectionId) {
            this.cleanup();
        }

        this.socket = socket;
        this.connectionId = connectionId || null;

        // Re-subscribe to all active subscriptions
        this.resubscribeAll();
    }

    // Subscribe to a symbol with ref counting
    subscribe(symbol: string, callback: (data: WebSocketData) => void): string {
        const callbackId = `cb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        let subscription = this.subscriptions.get(symbol);
        if (!subscription) {
            subscription = {
                symbol,
                refCount: 0,
                callbacks: new Map(),
                isSubscribed: false,
            };
            this.subscriptions.set(symbol, subscription);
        }

        // Add callback
        subscription.callbacks.set(callbackId, { id: callbackId, callback });
        subscription.refCount++;

        // Subscribe to WebSocket if this is the first subscription
        if (subscription.refCount === 1 && this.socket) {
            this.socketSubscribe(symbol);
            subscription.isSubscribed = true;
        }

        console.log(`📡 WebSocket: Subscribed to ${symbol} (${subscription.refCount} refs)`);
        return callbackId;
    }

    // Unsubscribe from a symbol with ref counting
    unsubscribe(symbol: string, callbackId: string): void {
        const subscription = this.subscriptions.get(symbol);
        if (!subscription) return;

        // Remove callback
        subscription.callbacks.delete(callbackId);
        subscription.refCount = Math.max(0, subscription.refCount - 1);

        // Unsubscribe from WebSocket if no more refs
        if (subscription.refCount === 0) {
            if (this.socket && subscription.isSubscribed) {
                this.socketUnsubscribe(symbol);
            }
            this.subscriptions.delete(symbol);
            console.log(`📡 WebSocket: Fully unsubscribed from ${symbol}`);
        } else {
            console.log(`📡 WebSocket: Unsubscribed from ${symbol} (${subscription.refCount} refs remaining)`);
        }
    }

    // Force unsubscribe from a symbol (removes all refs)
    forceUnsubscribe(symbol: string): void {
        const subscription = this.subscriptions.get(symbol);
        if (!subscription) return;

        if (this.socket && subscription.isSubscribed) {
            this.socketUnsubscribe(symbol);
        }

        this.subscriptions.delete(symbol);
        console.log(`📡 WebSocket: Force unsubscribed from ${symbol}`);
    }

    // Check if subscribed to a symbol
    isSubscribed(symbol: string): boolean {
        const subscription = this.subscriptions.get(symbol);
        return subscription?.isSubscribed || false;
    }

    // Get subscription info for debugging
    getSubscriptionInfo(symbol: string): SubscriptionInfo | null {
        return this.subscriptions.get(symbol) || null;
    }

    // Get all active subscriptions
    getActiveSubscriptions(): string[] {
        return Array.from(this.subscriptions.keys());
    }

    // Get total ref count across all subscriptions
    getTotalRefCount(): number {
        let total = 0;
        for (const subscription of this.subscriptions.values()) {
            total += subscription.refCount;
        }
        return total;
    }

    // Clean up all subscriptions
    cleanup(): void {
        if (!this.socket) return;

        for (const [symbol, subscription] of this.subscriptions) {
            if (subscription.isSubscribed) {
                this.socketUnsubscribe(symbol);
            }
        }

        this.subscriptions.clear();
        this.socket = null;
        this.connectionId = null;

        console.log('📡 WebSocket: Subscription manager cleaned up');
    }

    // Private: Subscribe to WebSocket
    private socketSubscribe(symbol: string): void {
        if (this.socket) {
            this.socket.emit('subscribe_market', symbol);
        }
    }

    // Private: Unsubscribe from WebSocket
    private socketUnsubscribe(symbol: string): void {
        if (this.socket) {
            this.socket.emit('unsubscribe_market', symbol);
        }
    }

    // Private: Re-subscribe to all active subscriptions (after reconnection)
    private resubscribeAll(): void {
        if (!this.socket) return;

        for (const [symbol, subscription] of this.subscriptions) {
            if (subscription.refCount > 0 && !subscription.isSubscribed) {
                this.socketSubscribe(symbol);
                subscription.isSubscribed = true;
                console.log(`📡 WebSocket: Re-subscribed to ${symbol}`);
            }
        }
    }

    // Handle incoming data for a symbol
    handleData(symbol: string, data: WebSocketData): void {
        const subscription = this.subscriptions.get(symbol);
        if (!subscription) return;

        // Call all callbacks for this symbol
        for (const callback of subscription.callbacks.values()) {
            try {
                callback.callback(data);
            } catch (error) {
                console.error(`📡 WebSocket: Error in callback for ${symbol}:`, error);
            }
        }
    }
}

// Global singleton instance
export const websocketSubscriptionManager = new WebSocketSubscriptionManager();

export default websocketSubscriptionManager;
