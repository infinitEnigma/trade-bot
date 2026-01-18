/** @format */

import WebSocket from "ws";
import logger from "../../services/logger";
import { CircuitState, WebSocketConfig, DEFAULT_WS_CONFIG } from "./types";

/**
 * Message priority levels for queue-based backpressure
 */
export enum MessagePriority {
  CRITICAL = 0,    // Trading executions, emergency signals
  HIGH = 1,        // Real-time market data, order updates
  MEDIUM = 2,      // Analytics data, status updates
  LOW = 3,         // Background tasks, maintenance
}

/**
 * Queued message with metadata for backpressure handling
 */
interface QueuedMessage {
  id: string;
  priority: MessagePriority;
  topic: string;
  data: any;
  timestamp: number;
  retryCount: number;
  clientId?: string;
}

/**
 * Backpressure state for flow control
 */
interface BackpressureState {
  isActive: boolean;
  queueDepth: number;
  lastSignalTime: number;
  signalCount: number;
}

/**
 * Manages WebSocket connections, reconnections, heartbeats, and queue-based backpressure
 * Includes circuit breaker pattern for resilient connections and flow control
 */
export class WebSocketManager {
  private websockets: Map<string, WebSocket> = new Map();
  private reconnectIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private circuitStates: Map<string, CircuitState> = new Map();
  private lastFailureTime: Map<string, number> = new Map();
  private circuitBreakerTimeouts: Map<string, NodeJS.Timeout> = new Map();

  // Backpressure queue management
  private messageQueue: QueuedMessage[] = [];
  private backpressureStates: Map<string, BackpressureState> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;
  private queueProcessorRunning: boolean = false;

  private config: WebSocketConfig;
  private readonly maxQueueSize: number = 10000; // Configurable max queue size
  private readonly processingBatchSize: number = 50; // Messages per processing batch
  private readonly backpressureThreshold: number = 1000; // Queue depth to trigger backpressure
  private readonly backpressureCooldownMs: number = 5000; // Min time between backpressure signals

  constructor(config: WebSocketConfig = DEFAULT_WS_CONFIG) {
    this.config = config;
    this.startQueueProcessor();
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

  // ===============================
  // QUEUE-BASED BACKPRESSURE SYSTEM
  // ===============================

  /**
   * Queue a message for processing with priority-based backpressure
   */
  queueMessage(
    topic: string,
    data: any,
    priority: MessagePriority = MessagePriority.MEDIUM,
    clientId?: string
  ): boolean {
    // Check if queue is at capacity
    if (this.messageQueue.length >= this.maxQueueSize) {
      logger.warn("Message queue at capacity, dropping low priority message", {
        queueSize: this.messageQueue.length,
        maxSize: this.maxQueueSize,
        priority,
        topic,
      });

      // Only drop LOW priority messages when at capacity
      if (priority === MessagePriority.LOW) {
        return false;
      }

      // For higher priority, remove oldest low priority message
      this.evictOldestLowPriorityMessage();
    }

    const queuedMessage: QueuedMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      priority,
      topic,
      data,
      timestamp: Date.now(),
      retryCount: 0,
      clientId,
    };

    // Insert message based on priority (lower number = higher priority)
    const insertIndex = this.messageQueue.findIndex(msg => msg.priority > priority);
    if (insertIndex === -1) {
      this.messageQueue.push(queuedMessage);
    } else {
      this.messageQueue.splice(insertIndex, 0, queuedMessage);
    }

    // Check if backpressure should be activated
    this.checkAndSignalBackpressure();

    logger.debug("Message queued for processing", {
      messageId: queuedMessage.id,
      priority,
      topic,
      queueDepth: this.messageQueue.length,
    });

    return true;
  }

  /**
   * Send message immediately or queue if backpressure is active
   */
  async sendMessage(
    connectionKey: string,
    topic: string,
    data: any,
    priority: MessagePriority = MessagePriority.MEDIUM,
    clientId?: string
  ): Promise<boolean> {
    // Check if backpressure is active for this connection
    const backpressureState = this.backpressureStates.get(connectionKey);
    if (backpressureState?.isActive) {
      logger.debug("Backpressure active, queuing message", {
        connectionKey,
        topic,
        priority,
        queueDepth: this.messageQueue.length,
      });
      return this.queueMessage(topic, data, priority, clientId);
    }

    // Try to send immediately
    const ws = this.getConnection(connectionKey);
    if (!ws || !this.isConnected(connectionKey)) {
      logger.debug("Connection not available, queuing message", {
        connectionKey,
        topic,
        priority,
      });
      return this.queueMessage(topic, data, priority, clientId);
    }

    try {
      const message = JSON.stringify({ topic, data, timestamp: Date.now() });
      ws.send(message);

      logger.debug("Message sent immediately", {
        connectionKey,
        topic,
        priority,
        messageSize: message.length,
      });

      return true;
    } catch (error) {
      logger.warn("Failed to send message immediately, queuing", {
        connectionKey,
        topic,
        error: (error as Error).message,
      });
      return this.queueMessage(topic, data, priority, clientId);
    }
  }

  /**
   * Start the queue processor that handles backpressure
   */
  private startQueueProcessor(): void {
    if (this.processingInterval) return;

    this.processingInterval = setInterval(() => {
      if (!this.queueProcessorRunning) {
        this.processQueueBatch();
      }
    }, 100); // Process every 100ms

    logger.info("Queue processor started", {
      processingInterval: 100,
      batchSize: this.processingBatchSize,
    });
  }

  /**
   * Process a batch of queued messages
   */
  private async processQueueBatch(): Promise<void> {
    if (this.queueProcessorRunning || this.messageQueue.length === 0) return;

    this.queueProcessorRunning = true;

    try {
      const batchSize = Math.min(this.processingBatchSize, this.messageQueue.length);
      const messagesToProcess = this.messageQueue.splice(0, batchSize);

      for (const message of messagesToProcess) {
        await this.processQueuedMessage(message);
      }

      // Check if backpressure should be deactivated
      this.checkAndDeactivateBackpressure();

      if (messagesToProcess.length > 0) {
        logger.debug("Processed message batch", {
          batchSize: messagesToProcess.length,
          remainingQueueDepth: this.messageQueue.length,
        });
      }

    } catch (error) {
      logger.error("Error processing message batch", {
        error: (error as Error).message,
        queueDepth: this.messageQueue.length,
      });
    } finally {
      this.queueProcessorRunning = false;
    }
  }

  /**
   * Process a single queued message
   */
  private async processQueuedMessage(message: QueuedMessage): Promise<void> {
    try {
      // Find an available connection to send the message
      const availableConnection = Array.from(this.websockets.keys()).find(key =>
        this.isConnected(key)
      );

      if (!availableConnection) {
        logger.debug("No available connections, re-queuing message", {
          messageId: message.id,
          topic: message.topic,
          retryCount: message.retryCount,
        });

        // Re-queue with incremented retry count
        message.retryCount++;
        if (message.retryCount < 3) { // Max 3 retries
          this.messageQueue.push(message);
        } else {
          logger.warn("Dropping message after max retries", {
            messageId: message.id,
            topic: message.topic,
            retryCount: message.retryCount,
          });
        }
        return;
      }

      const ws = this.getConnection(availableConnection)!;
      const messageData = JSON.stringify({
        topic: message.topic,
        data: message.data,
        timestamp: message.timestamp,
        queued: true,
        priority: message.priority,
      });

      ws.send(messageData);

      logger.debug("Queued message processed successfully", {
        messageId: message.id,
        topic: message.topic,
        connectionKey: availableConnection,
        processingDelay: Date.now() - message.timestamp,
      });

    } catch (error) {
      logger.error("Failed to process queued message", {
        messageId: message.id,
        topic: message.topic,
        error: (error as Error).message,
        retryCount: message.retryCount,
      });

      // Re-queue on failure
      message.retryCount++;
      if (message.retryCount < 3) {
        this.messageQueue.push(message);
      }
    }
  }

  /**
   * Check and signal backpressure when queue threshold is exceeded
   */
  private checkAndSignalBackpressure(): void {
    const queueDepth = this.messageQueue.length;

    // Check if backpressure should be activated
    if (queueDepth >= this.backpressureThreshold) {
      // Signal backpressure to all connected clients
      this.websockets.forEach((ws, connectionKey) => {
        const backpressureState = this.backpressureStates.get(connectionKey);

        // Check cooldown period
        if (backpressureState &&
          (Date.now() - backpressureState.lastSignalTime) < this.backpressureCooldownMs) {
          return; // Too soon since last signal
        }

        // Send backpressure signal
        try {
          const signalData = JSON.stringify({
            type: 'backpressure',
            action: 'pause',
            queueDepth,
            threshold: this.backpressureThreshold,
            timestamp: Date.now(),
          });

          ws.send(signalData);

          // Update backpressure state
          this.backpressureStates.set(connectionKey, {
            isActive: true,
            queueDepth,
            lastSignalTime: Date.now(),
            signalCount: (backpressureState?.signalCount || 0) + 1,
          });

          logger.warn("Backpressure signal sent", {
            connectionKey,
            queueDepth,
            threshold: this.backpressureThreshold,
            signalCount: this.backpressureStates.get(connectionKey)?.signalCount,
          });

        } catch (error) {
          logger.error("Failed to send backpressure signal", {
            connectionKey,
            error: (error as Error).message,
          });
        }
      });
    }
  }

  /**
   * Check and deactivate backpressure when queue drops below threshold
   */
  private checkAndDeactivateBackpressure(): void {
    const queueDepth = this.messageQueue.length;

    if (queueDepth < this.backpressureThreshold * 0.7) { // 70% of threshold
      // Send resume signals to clients with active backpressure
      this.backpressureStates.forEach((state, connectionKey) => {
        if (!state.isActive) return;

        const ws = this.getConnection(connectionKey);
        if (!ws || !this.isConnected(connectionKey)) return;

        try {
          const signalData = JSON.stringify({
            type: 'backpressure',
            action: 'resume',
            queueDepth,
            threshold: this.backpressureThreshold,
            timestamp: Date.now(),
          });

          ws.send(signalData);

          // Update backpressure state
          state.isActive = false;
          state.lastSignalTime = Date.now();

          logger.info("Backpressure resume signal sent", {
            connectionKey,
            queueDepth,
            threshold: this.backpressureThreshold,
          });

        } catch (error) {
          logger.error("Failed to send backpressure resume signal", {
            connectionKey,
            error: (error as Error).message,
          });
        }
      });
    }
  }

  /**
   * Evict the oldest low-priority message when queue is full
   */
  private evictOldestLowPriorityMessage(): void {
    for (let i = this.messageQueue.length - 1; i >= 0; i--) {
      if (this.messageQueue[i].priority === MessagePriority.LOW) {
        const evictedMessage = this.messageQueue.splice(i, 1)[0];
        logger.warn("Evicted low priority message from queue", {
          messageId: evictedMessage.id,
          topic: evictedMessage.topic,
          queueDepth: this.messageQueue.length,
        });
        return;
      }
    }

    // If no low priority messages found, log warning
    logger.error("Queue full but no low priority messages to evict", {
      queueDepth: this.messageQueue.length,
      maxQueueSize: this.maxQueueSize,
    });
  }

  /**
   * Get comprehensive statistics including backpressure metrics
   */
  getStats(): {
    activeConnections: number;
    connectionKeys: string[];
    circuitBreakerStates: Record<string, CircuitState>;
    queueDepth: number;
    maxQueueSize: number;
    backpressureActive: boolean;
    backpressureStates: Record<string, BackpressureState>;
    processingBatchSize: number;
    backpressureThreshold: number;
  } {
    const circuitBreakerStates: Record<string, CircuitState> = {};
    for (const [key, state] of this.circuitStates.entries()) {
      circuitBreakerStates[key] = state;
    }

    const backpressureStates: Record<string, BackpressureState> = {};
    for (const [key, state] of this.backpressureStates.entries()) {
      backpressureStates[key] = state;
    }

    return {
      activeConnections: this.websockets.size,
      connectionKeys: Array.from(this.websockets.keys()),
      circuitBreakerStates,
      queueDepth: this.messageQueue.length,
      maxQueueSize: this.maxQueueSize,
      backpressureActive: Array.from(this.backpressureStates.values()).some(state => state.isActive),
      backpressureStates,
      processingBatchSize: this.processingBatchSize,
      backpressureThreshold: this.backpressureThreshold,
    };
  }
}
