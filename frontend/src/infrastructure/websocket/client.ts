/** @format */

import { io, Socket } from "socket.io-client";
import { getWebSocketUrl } from "../config";
import { TickData, KlineData, MarkPriceData } from "@trade-bot/shared";

/**
 * WebSocket connection status
 */
export enum WebSocketStatus {
    DISCONNECTED = "disconnected",
    CONNECTING = "connecting",
    CONNECTED = "connected",
    RECONNECTING = "reconnecting",
    ERROR = "error",
}

/**
 * Event data for bot.stateChanged events from backend.
 */
export interface BotStateChangedEventData {
    botId: string;
    from: string;
    to: string;
    correlationId: string;
    timestamp: number;
}

/**
 * WebSocket client for real-time market data and bot lifecycle events.
 * Manages socket connections and subscriptions with reconnection logic.
 */
export class WebSocketClient {
    private socket: Socket | null = null;
    private static instance: WebSocketClient;
    private status: WebSocketStatus = WebSocketStatus.DISCONNECTED;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 2000;
    /** Slow retry cadence once the fast attempts are exhausted (never give up). */
    private slowReconnectDelay: number = 30_000;
    private reconnectTimer: NodeJS.Timeout | null = null;
    /** Fires once per failure episode so re-auth is requested exactly once. */
    private authFailureNotified: boolean = false;
    /** Single-flight guard: at most one connection attempt in progress. */
    private connectPromise: Promise<Socket> | null = null;
    /** Deferred settle hooks for the in-flight connect() promise. */
    private pendingConnect: { resolve: (socket: Socket) => void; reject: (err: Error) => void } | null = null;
    private connectionListeners: Array<(status: WebSocketStatus) => void> = [];
    private errorListeners: Array<(error: Error) => void> = [];
    private tickListeners: Array<(data: TickData) => void> = [];
    private klineListeners: Array<(data: KlineData) => void> = [];
    private markPriceListeners: Array<(data: MarkPriceData) => void> = [];
    private botStateChangedListeners: Array<(data: BotStateChangedEventData) => void> = [];
    private subscribedSymbols: Set<string> = new Set();

    private constructor() {
        // Reconnect proactively when the network returns or the tab becomes
        // visible again (single-flight connect() guards duplicate attempts).
        if (typeof window !== "undefined") {
            window.addEventListener("online", () => {
                if (!this.socket?.connected && !this.reconnectTimer && !this.connectPromise) {
                    console.log("📡 Network online - reconnecting");
                    this.connect().catch(() => { /* handled by connection error listeners */ });
                }
            });
            document.addEventListener("visibilitychange", () => {
                if (
                    document.visibilityState === "visible" &&
                    !this.socket?.connected &&
                    !this.reconnectTimer &&
                    !this.connectPromise &&
                    this.status !== WebSocketStatus.DISCONNECTED
                ) {
                    console.log("📡 Tab visible - reconnecting");
                    this.connect().catch(() => { /* handled by connection error listeners */ });
                }
            });
        }
    }

    public static getInstance(): WebSocketClient {
        if (!WebSocketClient.instance) {
            WebSocketClient.instance = new WebSocketClient();
        }
        return WebSocketClient.instance;
    }

    /**
     * Connect to WebSocket server with reconnection logic.
     * Single-flight: concurrent callers receive the in-flight promise.
     */
    public connect(url: string = getWebSocketUrl()): Promise<Socket> {
        if (this.connectPromise) {
            console.log("📡 WebSocket connection already in progress");
            return this.connectPromise;
        }

        if (this.socket?.connected) {
            console.log("📡 WebSocket already connected");
            return Promise.resolve(this.socket);
        }

        // A manual connect supersedes any scheduled retry timer.
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.status = WebSocketStatus.CONNECTING;
        this.notifyStatusChange();

        console.log(`📡 Attempting to connect to WebSocket server: ${url}`);
        this.connectPromise = new Promise<Socket>((resolve, reject) => {
            this.pendingConnect = { resolve, reject };
            // NOTE: We no longer need to get token from localStorage
            // Backend now extracts token from httpOnly cookies, which are automatically included
            // when withCredentials: true is set
            this.socket = io(url, {
                withCredentials: true,
                transports: ["polling", "websocket"], // "polling"],
                reconnection: false, // We handle reconnection manually
                timeout: 10000,
                path: "/socket.io/", // Match nginx proxy path
                // No need to pass auth token - backend extracts from cookies
            });
            this.setupEventListeners();
        });
        return this.connectPromise;
    }

    /**
     * Disconnect from WebSocket server
     */
    public disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.connectPromise = null;
        this.pendingConnect = null;

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.status = WebSocketStatus.DISCONNECTED;
        this.reconnectAttempts = 0;
        this.authFailureNotified = false;
        this.notifyStatusChange();
        console.log("📡 WebSocket disconnected");
    }

    /**
     * Get current socket instance
     */
    public getSocket(): Socket | null {
        return this.socket;
    }

    /**
     * Get current connection status
     */
    public getStatus(): WebSocketStatus {
        return this.status;
    }

    /**
     * Check if socket is connected
     */
    public isConnected(): boolean {
        return this.socket?.connected ?? false;
    }

    /**
     * Add status change listener
     */
    public onStatusChange(listener: (status: WebSocketStatus) => void): void {
        this.connectionListeners.push(listener);
    }

    /**
     * Remove status change listener
     */
    public offStatusChange(listener: (status: WebSocketStatus) => void): void {
        const index = this.connectionListeners.indexOf(listener);
        if (index !== -1) {
            this.connectionListeners.splice(index, 1);
        }
    }

    /**
     * Add error listener
     */
    public onError(listener: (error: Error) => void): void {
        this.errorListeners.push(listener);
    }

    /**
     * Remove error listener
     */
    public offError(listener: (error: Error) => void): void {
        const index = this.errorListeners.indexOf(listener);
        if (index !== -1) {
            this.errorListeners.splice(index, 1);
        }
    }

    /**
     * Subscribe to market data for a specific symbol
     */
    public async subscribeToSymbol(symbol: string): Promise<void> {
        // Connect to WebSocket if not already connected
        if (!this.socket?.connected) {
            try {
                console.log("📡 Connecting WebSocket before subscribing");
                await this.connect();
            } catch (error) {
                console.error("📡 Failed to connect WebSocket for subscription:", error);
                this.subscribedSymbols.add(symbol);
                return;
            }
        }

        // Check socket is available and connected before emitting
        if (this.socket?.connected) {
            console.log(`📡 Subscribing to market data for ${symbol}`);
            this.socket.emit("subscribe_market", symbol);
            this.subscribedSymbols.add(symbol);
        } else {
            console.warn("📡 WebSocket not connected, cannot subscribe");
            this.subscribedSymbols.add(symbol);
        }
    }

    /**
     * Unsubscribe from market data for a specific symbol
     */
    public unsubscribeFromSymbol(symbol: string): void {
        if (this.socket?.connected) {
            console.log(`📡 Unsubscribing from market data for ${symbol}`);
            this.socket.emit("unsubscribe_market", symbol);
        }
        this.subscribedSymbols.delete(symbol);
    }

    /**
     * Add tick data listener
     */
    public onTick(listener: (data: TickData) => void): void {
        this.tickListeners.push(listener);
    }

    /**
     * Remove tick data listener
     */
    public offTick(listener: (data: TickData) => void): void {
        const index = this.tickListeners.indexOf(listener);
        if (index !== -1) {
            this.tickListeners.splice(index, 1);
        }
    }

    /**
     * Add kline data listener
     */
    public onKline(listener: (data: KlineData) => void): void {
        this.klineListeners.push(listener);
    }

    /**
     * Remove kline data listener
     */
    public offKline(listener: (data: KlineData) => void): void {
        const index = this.klineListeners.indexOf(listener);
        if (index !== -1) {
            this.klineListeners.splice(index, 1);
        }
    }

    /**
     * Add mark price data listener
     */
    public onMarkPrice(listener: (data: MarkPriceData) => void): void {
        this.markPriceListeners.push(listener);
    }

    /**
     * Remove mark price data listener
     */
    public offMarkPrice(listener: (data: MarkPriceData) => void): void {
        const index = this.markPriceListeners.indexOf(listener);
        if (index !== -1) {
            this.markPriceListeners.splice(index, 1);
        }
    }

    /**
     * Add bot state changed listener.
     * Called when the backend emits a `bot.stateChanged` event.
     */
    public onBotStateChanged(listener: (data: BotStateChangedEventData) => void): void {
        this.botStateChangedListeners.push(listener);
    }

    /**
     * Remove bot state changed listener.
     */
    public offBotStateChanged(listener: (data: BotStateChangedEventData) => void): void {
        const index = this.botStateChangedListeners.indexOf(listener);
        if (index !== -1) {
            this.botStateChangedListeners.splice(index, 1);
        }
    }

    /**
     * Cleanup method for app unmount
     */
    public cleanup(): void {
        this.disconnect();
        this.connectionListeners = [];
        this.errorListeners = [];
        this.tickListeners = [];
        this.klineListeners = [];
        this.markPriceListeners = [];
        this.botStateChangedListeners = [];
        this.subscribedSymbols.clear();
    }

    /**
     * Setup socket event listeners. Registered exactly once per socket —
     * this is the ONLY place that schedules reconnection attempts, so a
     * failing connect() can never double-schedule retries.
     */
    private setupEventListeners(): void {
        if (!this.socket) return;

        this.socket.on("connect", () => {
            console.log("📡 WebSocket connected successfully");
            this.status = WebSocketStatus.CONNECTED;
            this.reconnectAttempts = 0;
            this.authFailureNotified = false;
            // Settle the single-flight connect() promise first so concurrent
            // callers unblock, then notify listeners and resubscribe.
            this.pendingConnect?.resolve(this.socket!);
            this.pendingConnect = null;
            this.connectPromise = null;
            this.notifyStatusChange();
            this.resubscribe();
        });

        this.socket.on("disconnect", (reason) => {
            console.log("📡 WebSocket disconnected", reason);

            if (this.status === WebSocketStatus.DISCONNECTED) {
                return;
            }

            if (reason === "io server disconnect") {
                // Server initiated disconnect - don't automatically reconnect
                this.status = WebSocketStatus.DISCONNECTED;
                this.notifyStatusChange();
            } else {
                // Client or network issue - attempt reconnection
                this.attemptReconnection();
            }
        });

        this.socket.on("connect_error", (error) => {
            const wsError = error as Error & { data?: { code?: string; definitive?: boolean } };

            // Definitive auth failure (dead/expired cookie, unknown user): retrying
            // the same handshake can never succeed. Stop the reconnect loop and ask
            // the app to re-authenticate (HTTP refresh or re-login) instead.
            if (wsError.data?.definitive) {
                console.error("📡 WebSocket auth failure is definitive - stopping reconnection:", wsError.message);
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                this.status = WebSocketStatus.ERROR;
                this.pendingConnect?.reject(error instanceof Error ? error : new Error(String(error)));
                this.pendingConnect = null;
                this.connectPromise = null;
                this.notifyStatusChange();
                if (!this.authFailureNotified) {
                    this.authFailureNotified = true;
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("auth:session-expired"));
                    }
                }
                this.notifyError(error);
                return;
            }

            console.error("📡 WebSocket connection error", error);
            this.status = WebSocketStatus.ERROR;
            // Settle the single-flight promise; a retry is scheduled by
            // attemptReconnection() below (exactly once for this failure).
            this.pendingConnect?.reject(error instanceof Error ? error : new Error(String(error)));
            this.pendingConnect = null;
            this.connectPromise = null;
            this.notifyStatusChange();
            this.notifyError(error);
            this.attemptReconnection();
        });

        this.socket.on("connect_timeout", () => {
            console.error("📡 WebSocket connection timeout");
            this.status = WebSocketStatus.ERROR;
            this.pendingConnect?.reject(new Error("Connection timeout"));
            this.pendingConnect = null;
            this.connectPromise = null;
            this.notifyStatusChange();
            this.attemptReconnection();
        });

        // Market data event listeners - dynamically handle symbol-specific events
        this.socket.onAny((event, data) => {
            // Handle ticker events: "market:${symbol}"
            if (event.startsWith("market:")) {
                this.notifyTickListeners(data);
            }
            // Handle kline events: "kline:${symbol}:${interval}"
            else if (event.startsWith("kline:")) {
                this.notifyKlineListeners(data);
            }
            // Handle mark price events: "markprice:${symbol}"
            else if (event.startsWith("markprice:")) {
                this.notifyMarkPriceListeners(data);
            }
            // Handle bot state changed events from backend
            else if (event === "bot.stateChanged") {
                this.notifyBotStateChanged(data as BotStateChangedEventData);
            }
        });
    }

    /**
     * Resubscribe to symbols on reconnection
     */
    private async resubscribe(): Promise<void> {
        if (!this.isConnected() || this.subscribedSymbols.size === 0) {
            return;
        }

        console.log(`📡 Resubscribing to ${this.subscribedSymbols.size} symbols`);
        for (const symbol of this.subscribedSymbols) {
            await this.subscribeToSymbol(symbol);
        }
    }

    /**
     * Notify tick listeners
     */
    private notifyTickListeners(data: TickData): void {
        for (const listener of this.tickListeners) {
            try {
                listener(data);
            } catch (error) {
                console.error("Error in tick listener", error);
            }
        }
    }

    /**
     * Notify kline listeners
     */
    private notifyKlineListeners(data: KlineData): void {
        for (const listener of this.klineListeners) {
            try {
                listener(data);
            } catch (error) {
                console.error("Error in kline listener", error);
            }
        }
    }

    /**
     * Notify mark price listeners
     */
    private notifyMarkPriceListeners(data: MarkPriceData): void {
        for (const listener of this.markPriceListeners) {
            try {
                listener(data);
            } catch (error) {
                console.error("Error in mark price listener", error);
            }
        }
    }

    /**
     * Notify bot state changed listeners.
     * Called when the backend emits a `bot.stateChanged` event.
     */
    private notifyBotStateChanged(data: BotStateChangedEventData): void {
        for (const listener of this.botStateChangedListeners) {
            try {
                listener(data);
            } catch (error) {
                console.error("Error in bot state changed listener", error);
            }
        }
    }

    /**
     * Attempt to reconnect to WebSocket server.
     * Fast retries with exponential backoff for the first attempts, then a
     * slow periodic cadence forever - the client never permanently gives up
     * (the backend may come back hours later; the tab may sit in background).
     */
    private attemptReconnection(): void {
        // Guard against double-scheduling (e.g. disconnect + connect_error
        // firing in quick succession for the same socket failure).
        if (this.reconnectTimer) {
            return;
        }

        this.reconnectAttempts++;
        this.status = WebSocketStatus.RECONNECTING;
        this.notifyStatusChange();

        const fast = this.reconnectAttempts <= this.maxReconnectAttempts;
        const delay = fast
            ? this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1)
            : this.slowReconnectDelay;

        if (fast) {
            console.log(`📡 Attempting reconnection #${this.reconnectAttempts} in ${Math.round(delay / 1000)}s`);
        } else {
            console.log(`📡 Reconnection attempts exhausted - retrying every ${Math.round(delay / 1000)}s`);
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch(() => {
                // connect_error already scheduled the next attempt.
            });
        }, delay);
    }

    /**
     * Notify listeners of status change
     */
    private notifyStatusChange(): void {
        for (const listener of this.connectionListeners) {
            try {
                listener(this.status);
            } catch (error) {
                console.error("Error in status change listener", error);
            }
        }
    }

    /**
     * Notify listeners of error
     */
    private notifyError(error: Error): void {
        for (const listener of this.errorListeners) {
            try {
                listener(error);
            } catch (err) {
                console.error("Error in error listener", err);
            }
        }
    }
}

export const websocketClient = WebSocketClient.getInstance();