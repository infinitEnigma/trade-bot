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
 * WebSocket client for real-time market data
 * Manages socket connections and subscriptions with reconnection logic
 */
class WebSocketClient {
    private socket: Socket | null = null;
    private static instance: WebSocketClient;
    private status: WebSocketStatus = WebSocketStatus.DISCONNECTED;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 2000;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private connectionListeners: Array<(status: WebSocketStatus) => void> = [];
    private errorListeners: Array<(error: Error) => void> = [];
    private tickListeners: Array<(data: TickData) => void> = [];
    private klineListeners: Array<(data: KlineData) => void> = [];
    private markPriceListeners: Array<(data: MarkPriceData) => void> = [];
    private subscribedSymbols: Set<string> = new Set();

    private constructor() {
        // Private constructor for singleton
    }

    public static getInstance(): WebSocketClient {
        if (!WebSocketClient.instance) {
            WebSocketClient.instance = new WebSocketClient();
        }
        return WebSocketClient.instance;
    }

    /**
     * Connect to WebSocket server with reconnection logic
     */
    public connect(url: string = getWebSocketUrl()): Promise<Socket> {
        return new Promise((resolve, reject) => {
            if (this.socket?.connected) {
                console.log("📡 WebSocket already connected");
                resolve(this.socket);
                return;
            }

            if (this.status === WebSocketStatus.CONNECTING || this.status === WebSocketStatus.RECONNECTING) {
                console.log("📡 WebSocket connection already in progress");
                // Wait for connection to complete
                const checkConnection = setInterval(() => {
                    if (this.socket?.connected) {
                        console.log("Websocket reconnected")
                        clearInterval(checkConnection);
                        resolve(this.socket);
                    } else if (this.status === WebSocketStatus.ERROR) {
                        clearInterval(checkConnection);
                        reject(new Error('Connection failed'));
                    }
                }, 200);
                return;
            }

            this.status = WebSocketStatus.CONNECTING;
            this.reconnectAttempts = 0;
            this.notifyStatusChange();

            // NOTE: We no longer need to get token from localStorage
            // Backend now extracts token from httpOnly cookies, which are automatically included
            // when withCredentials: true is set

            console.log(`📡 Attempting to connect to WebSocket server: ${url}`);
            this.socket = io(url, {
                withCredentials: true,
                transports: ["polling", "websocket"], // "polling"],
                reconnection: false, // We handle reconnection manually
                timeout: 10000,
                //forceNew: true, // Always create new connection
                //upgrade: true, // Disable HTTP upgrade to prevent protocol issues
                path: "/socket.io/", // Match nginx proxy path
                // No need to pass auth token - backend extracts from cookies
            });

            this.socket.on("connect", () => {
                console.log("📡 WebSocket connected successfully");
                this.status = WebSocketStatus.CONNECTED;
                this.reconnectAttempts = 0;
                this.notifyStatusChange();
                resolve(this.socket!);
            });

            this.socket.on("connect_error", (err) => {
                console.error("📡 WebSocket connection error", err.message, err.cause);
                this.status = WebSocketStatus.ERROR;
                this.notifyStatusChange();
                this.notifyError(err);
                reject(err);
            });

            this.socket.on("connect_timeout", () => {
                console.error("📡 WebSocket connection timeout");
                this.status = WebSocketStatus.ERROR;
                this.notifyStatusChange();
                reject(new Error('Connection timeout'));
            });

            this.socket.on("error", (error) => {
                console.error("📡 WebSocket error", error);
                this.status = WebSocketStatus.ERROR;
                this.notifyStatusChange();
                this.notifyError(error);
            });

            this.setupEventListeners();
            console.log("📡 WebSocket connection initialized");
        });
    }

    /**
     * Disconnect from WebSocket server
     */
    public disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.status = WebSocketStatus.DISCONNECTED;
        this.reconnectAttempts = 0;
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
     * Cleanup method for app unmount
     */
    public cleanup(): void {
        this.disconnect();
        this.connectionListeners = [];
        this.errorListeners = [];
        this.tickListeners = [];
        this.klineListeners = [];
        this.markPriceListeners = [];
        this.subscribedSymbols.clear();
    }

    /**
     * Setup socket event listeners
     */
    private setupEventListeners(): void {
        if (!this.socket) return;

        this.socket.on("connect", () => {
            this.status = WebSocketStatus.CONNECTED;
            this.reconnectAttempts = 0;
            this.notifyStatusChange();
            console.log("📡 WebSocket connected successfully");

            // Re-subscribe to previously subscribed symbols
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
            console.error("📡 WebSocket connection error", error);
            this.status = WebSocketStatus.ERROR;
            this.notifyStatusChange();
            this.notifyError(error);

            // Attempt reconnection after delay
            setTimeout(() => {
                this.attemptReconnection();
            }, this.reconnectDelay);
        });

        this.socket.on("connect_timeout", () => {
            console.error("📡 WebSocket connection timeout");
            this.status = WebSocketStatus.ERROR;
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
     * Attempt to reconnect to WebSocket server
     */
    private attemptReconnection(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.status = WebSocketStatus.DISCONNECTED;
            this.notifyStatusChange();
            console.error("📡 WebSocket reconnection attempts exhausted");
            return;
        }

        this.status = WebSocketStatus.RECONNECTING;
        this.reconnectAttempts++;
        this.notifyStatusChange();

        const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
        console.log(`📡 Attempting reconnection #${this.reconnectAttempts} in ${Math.round(delay / 1000)}s`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
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