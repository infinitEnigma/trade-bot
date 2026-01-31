/** @format */

import { io, Socket } from "socket.io-client";
import { getWebSocketUrl } from "../config";

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
    public connect(url: string = getWebSocketUrl()): Socket {
        if (this.socket?.connected) {
            return this.socket;
        }

        if (this.status === WebSocketStatus.CONNECTING || this.status === WebSocketStatus.RECONNECTING) {
            console.log("📡 WebSocket connection already in progress");
            return this.socket!;
        }

        this.status = WebSocketStatus.CONNECTING;
        this.reconnectAttempts = 0;
        this.notifyStatusChange();

        this.socket = io(url, {
            withCredentials: true,
            transports: ["websocket", "polling"],
            reconnection: false, // We handle reconnection manually
            timeout: 10000,
        });

        this.setupEventListeners();
        console.log("📡 WebSocket connection initialized");

        return this.socket;
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
     * Cleanup method for app unmount
     */
    public cleanup(): void {
        this.disconnect();
        this.connectionListeners = [];
        this.errorListeners = [];
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
