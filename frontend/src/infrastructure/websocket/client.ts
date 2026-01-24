/** @format */

import { io, Socket } from "socket.io-client";
import { getWebSocketUrl } from "../config";

/**
 * WebSocket client for real-time market data
 * Manages socket connections and subscriptions
 */
class WebSocketClient {
    private socket: Socket | null = null;
    private static instance: WebSocketClient;

    private constructor() {
        // Private constructor for singleton
    }

    public static getInstance(): WebSocketClient {
        if (!WebSocketClient.instance) {
            WebSocketClient.instance = new WebSocketClient();
        }
        return WebSocketClient.instance;
    }

    public connect(url: string = getWebSocketUrl()): Socket {
        if (this.socket?.connected) {
            return this.socket;
        }

        this.socket = io(url, {
            withCredentials: true,
            transports: ["websocket", "polling"],
        });

        console.log("📡 WebSocket connection initialized");

        return this.socket;
    }

    public disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            console.log("📡 WebSocket disconnected");
        }
    }

    public getSocket(): Socket | null {
        return this.socket;
    }

    public isConnected(): boolean {
        return this.socket?.connected ?? false;
    }

    // Cleanup method for app unmount
    public cleanup(): void {
        this.disconnect();
    }
}

export const websocketClient = WebSocketClient.getInstance();
