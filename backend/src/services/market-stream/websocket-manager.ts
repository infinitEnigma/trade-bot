/** @format */

import WebSocket from "ws";
import logger from "../../services/logger";
import { CircuitState, WebSocketConfig, DEFAULT_WS_CONFIG } from "./types";

/**
 * Manages WebSocket connections, reconnections, and heartbeats
 * Includes circuit breaker pattern for resilient connections
 */
export class WebSocketManager {
  private websockets: Map<string, WebSocket> = new Map();
  private reconnectIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private circuitStates: Map<string, CircuitState> = new Map();
  private lastFailureTime: Map<string, number> = new Map();
  private circuitBreakerTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private config: WebSocketConfig;

  constructor(config: WebSocketConfig = DEFAULT_WS_CONFIG) {
    this.config = config;
  }

  /**
   * Create a new WebSocket connection with circuit breaker protection
   */
  async createConnection(
    accountId: string,
    connectionKey: string = "market"
  ): Promise<WebSocket> {
    // Check if already connected
    if (this.websockets.has(connectionKey)) {
      logger.debug("WebSocket already exists", { connectionKey });
      return this.websockets.get(connectionKey)!;
    }

    const wsUrl = `${this.config.baseUrl}/${accountId}`;
    logger.info("Connecting to WebSocket", {
      url: wsUrl,
      accountId,
      connectionKey,
    });

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        logger.info("WebSocket connected successfully", { connectionKey });
        this.websockets.set(connectionKey, ws);
        this.reconnectAttempts.set(connectionKey, 0);

        // Reset circuit breaker on successful connection
        this.circuitStates.set(connectionKey, CircuitState.CLOSED);
        this.startHeartbeat(connectionKey, ws);

        resolve(ws);
      });

      ws.on("error", (error: Error) => {
        logger.error("WebSocket connection error", {
          connectionKey,
          error: error.message,
        });
        reject(error);
      });

      ws.on("close", (code: number, reason: string) => {
        logger.warn("WebSocket closed", {
          connectionKey,
          code,
          reason,
        });
        this.websockets.delete(connectionKey);
        this.stopHeartbeat(connectionKey);
        this.scheduleReconnect(connectionKey);
      });

      ws.on("pong", () => {
        logger.debug("Heartbeat pong received", { connectionKey });
      });
    });
  }

  /**
   * Get an existing WebSocket connection
   */
  getConnection(connectionKey: string = "market"): WebSocket | null {
    return this.websockets.get(connectionKey) || null;
  }

  /**
   * Check if a WebSocket connection is active
   */
  isConnected(connectionKey: string = "market"): boolean {
    const ws = this.websockets.get(connectionKey);
    return ws ? ws.readyState === WebSocket.OPEN : false;
  }

  /**
   * Start heartbeat monitoring for a connection
   */
  private startHeartbeat(connectionKey: string, ws: WebSocket): void {
    this.stopHeartbeat(connectionKey);

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        logger.debug("Heartbeat ping sent", { connectionKey });
      } else {
        clearInterval(heartbeat);
        this.heartbeatIntervals.delete(connectionKey);
      }
    }, this.config.heartbeatInterval);

    this.heartbeatIntervals.set(connectionKey, heartbeat);
  }

  /**
   * Stop heartbeat monitoring for a connection
   */
  private stopHeartbeat(connectionKey: string): void {
    const heartbeat = this.heartbeatIntervals.get(connectionKey);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeatIntervals.delete(connectionKey);
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoff(connectionKey: string): number {
    const attempts = this.reconnectAttempts.get(connectionKey) || 0;
    const exponentialDelay = Math.min(
      this.config.minReconnectDelay * Math.pow(2, Math.min(attempts, 5)),
      this.config.maxReconnectDelay
    );
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }

  /**
   * Schedule a reconnection attempt with circuit breaker logic
   */
  private scheduleReconnect(connectionKey: string): void {
    if (this.reconnectIntervals.has(connectionKey)) return;

    const attempts = this.reconnectAttempts.get(connectionKey) || 0;
    const circuitState =
      this.circuitStates.get(connectionKey) || CircuitState.CLOSED;

    // Check if circuit breaker is open (stop retrying)
    if (circuitState === CircuitState.OPEN) {
      const lastFailure = this.lastFailureTime.get(connectionKey) || 0;
      const timeSinceFailure = Date.now() - lastFailure;

      // If enough time has passed, try half-open state
      if (timeSinceFailure >= this.config.circuitBreakerTimeout) {
        logger.info("Circuit breaker transitioning to half-open", {
          connectionKey,
          timeSinceFailureMs: timeSinceFailure,
        });
        this.circuitStates.set(connectionKey, CircuitState.HALF_OPEN);
        this.reconnectAttempts.set(connectionKey, 0); // Reset attempts for half-open
      } else {
        logger.debug("Circuit breaker open, skipping reconnect", {
          connectionKey,
          attempts,
          timeSinceFailureMs: timeSinceFailure,
          remainingMs: this.config.circuitBreakerTimeout - timeSinceFailure,
        });
        return;
      }
    }

    // Check if we've exceeded maximum retry attempts
    if (attempts >= this.config.maxReconnectAttempts) {
      logger.error(
        "Maximum reconnection attempts exceeded, opening circuit breaker",
        {
          connectionKey,
          attempts,
          maxAttempts: this.config.maxReconnectAttempts,
        }
      );
      this.circuitStates.set(connectionKey, CircuitState.OPEN);
      this.lastFailureTime.set(connectionKey, Date.now());

      // Schedule circuit breaker reset
      this.scheduleCircuitBreakerReset(connectionKey);
      return;
    }

    const delay = this.calculateBackoff(connectionKey);
    logger.info("Scheduling reconnect", {
      connectionKey,
      attempt: attempts + 1,
      maxAttempts: this.config.maxReconnectAttempts,
      delayMs: Math.round(delay),
      circuitState,
    });

    const timer = setTimeout(async () => {
      logger.info("Attempting reconnect", {
        connectionKey,
        attempt: attempts + 1,
      });
      this.reconnectIntervals.delete(connectionKey);
      this.reconnectAttempts.set(connectionKey, attempts + 1);

      // Note: Actual reconnection will be handled by the service
      // This just updates the attempt counter and schedules the next try
    }, delay);

    this.reconnectIntervals.set(connectionKey, timer);
  }

  /**
   * Schedule circuit breaker reset after timeout
   */
  private scheduleCircuitBreakerReset(connectionKey: string): void {
    if (this.circuitBreakerTimeouts.has(connectionKey)) return;

    logger.info("Scheduling circuit breaker reset", {
      connectionKey,
      resetDelayMs: this.config.circuitBreakerTimeout,
    });

    const timer = setTimeout(() => {
      logger.info("Circuit breaker reset timeout reached", { connectionKey });
      this.circuitBreakerTimeouts.delete(connectionKey);
      // Note: circuit breaker will transition to half-open on next reconnect attempt
    }, this.config.circuitBreakerTimeout);

    this.circuitBreakerTimeouts.set(connectionKey, timer);
  }

  /**
   * Disconnect a specific WebSocket connection
   */
  disconnect(connectionKey: string): void {
    const ws = this.websockets.get(connectionKey);
    if (ws) {
      ws.close();
      this.websockets.delete(connectionKey);
    }

    // Clean up timers
    const timer = this.reconnectIntervals.get(connectionKey);
    if (timer) {
      clearTimeout(timer);
      this.reconnectIntervals.delete(connectionKey);
    }

    this.stopHeartbeat(connectionKey);
    this.reconnectAttempts.delete(connectionKey);
    logger.info("WebSocket disconnected", { connectionKey });
  }

  /**
   * Disconnect all WebSocket connections and clean up all state
   */
  disconnectAll(): void {
    // Close all WebSocket connections
    this.websockets.forEach((ws, connectionKey) => {
      try {
        ws.close();
      } catch (error) {
        logger.warn("Error closing WebSocket", {
          connectionKey,
          error: (error as Error).message,
        });
      }
    });

    // Clear all connections
    this.websockets.clear();

    // Clear all timers
    this.reconnectIntervals.forEach(timer => clearTimeout(timer));
    this.reconnectIntervals.clear();

    this.heartbeatIntervals.forEach(timer => clearInterval(timer));
    this.heartbeatIntervals.clear();

    // Clear circuit breaker state
    this.reconnectAttempts.clear();
    this.circuitStates.clear();
    this.lastFailureTime.clear();
    this.circuitBreakerTimeouts.forEach(timer => clearTimeout(timer));
    this.circuitBreakerTimeouts.clear();

    logger.info("All WebSocket connections and circuit breaker state cleared");
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    activeConnections: number;
    connectionKeys: string[];
    circuitBreakerStates: Record<string, CircuitState>;
  } {
    const circuitBreakerStates: Record<string, CircuitState> = {};
    for (const [key, state] of this.circuitStates.entries()) {
      circuitBreakerStates[key] = state;
    }

    return {
      activeConnections: this.websockets.size,
      connectionKeys: Array.from(this.websockets.keys()),
      circuitBreakerStates,
    };
  }
}
