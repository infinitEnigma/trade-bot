/** @format */

import WebSocket from "ws";
import { marketStreamLogger as logger } from "../../../core/logging/context-aware-logger.service";
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
  data: unknown;
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
 * Health check configuration for circuit breaker recovery
 */
interface HealthCheckConfig {
  timeout: number;           // How long to wait for health check response (ms)
  retries: number;          // Number of retries before declaring unhealthy
  interval: number;         // Time between health checks (ms)
  successThreshold: number; // Consecutive successes needed to pass
  failureThreshold: number; // Consecutive failures before circuit opens
  enablePingPong: boolean;  // Use WebSocket ping/pong for basic health
  enableAuthCheck: boolean; // Test authentication flow
  enableSubscriptionCheck: boolean; // Test subscription capability
}

/**
 * Health check result
 */
interface HealthCheckResult {
  healthy: boolean;
  responseTime: number;
  error?: string;
  checksPerformed: string[];
  timestamp: number;
}

/**
 * Circuit breaker recovery state
 */
interface RecoveryState {
  healthChecksPerformed: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastHealthCheck: HealthCheckResult | null;
  recoveryStartTime: number;
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

  // Circuit breaker health check and recovery
  private recoveryStates: Map<string, RecoveryState> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();

  private config: WebSocketConfig;
  private readonly maxQueueSize: number = 10000; // Configurable max queue size
  private readonly processingBatchSize: number = 50; // Messages per processing batch
  private readonly backpressureThreshold: number = 1000; // Queue depth to trigger backpressure
  private readonly backpressureCooldownMs: number = 5000; // Min time between backpressure signals

  // Health check configuration - can be made configurable
  private readonly healthCheckConfig: HealthCheckConfig = {
    timeout: 5000,           // 5 second timeout
    retries: 2,             // 2 retries
    interval: 10000,        // Check every 10 seconds
    successThreshold: 2,    // 2 consecutive successes
    failureThreshold: 3,    // 3 consecutive failures
    enablePingPong: true,   // Basic ping/pong check
    enableAuthCheck: false, // Skip auth for now (requires credentials)
    enableSubscriptionCheck: false, // Skip subscription for now
  };

  constructor(config: WebSocketConfig = DEFAULT_WS_CONFIG) {
    this.config = config;
    // Queue processor will not start automatically - must be explicitly started
  }

  /**
   * Explicitly start the queue processor
   */
  startQueueProcessor(): void {
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
   * Alias for startQueueProcessor (for backward compatibility)
   */
  startQueueProcessorForTests(): void {
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
      const existingWs = this.websockets.get(connectionKey);
      if (existingWs) {
        return existingWs;
      }
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
        logger.error("WebSocket connection error", error, { connectionKey });
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

        // CRITICAL: Start explicit health check monitoring for HALF_OPEN state
        this.startHealthCheckMonitoring(connectionKey);
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
      logger.warn(
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
        if (ws) {
          ws.close();
        }
      } catch (error) {
        logger.error("Error closing WebSocket", error as Error, { connectionKey });
      }
    });

    // Clear all connections
    this.websockets.clear();

    // Clear all timers
    this.reconnectIntervals.forEach(timer => clearTimeout(timer));
    this.reconnectIntervals.clear();

    this.heartbeatIntervals.forEach(timer => clearInterval(timer));
    this.heartbeatIntervals.clear();

    // Clear processing interval
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Clear health check intervals
    this.healthCheckIntervals.forEach(timer => clearInterval(timer));
    this.healthCheckIntervals.clear();

    // Clear circuit breaker state
    this.reconnectAttempts.clear();
    this.circuitStates.clear();
    this.lastFailureTime.clear();
    this.circuitBreakerTimeouts.forEach(timer => clearTimeout(timer));
    this.circuitBreakerTimeouts.clear();

    logger.info("All WebSocket connections and circuit breaker state cleared");
  }

  /**
   * Cleanup method for tests to clear all timers and state
   */
  cleanupForTests(): void {
    this.disconnectAll();
    this.messageQueue = [];
    this.backpressureStates.clear();
    this.recoveryStates.clear();

    // Ensure all possible timers are cleared
    // This fixes the open handles issue in Jest tests
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.healthCheckIntervals.forEach(timer => clearInterval(timer));
    this.healthCheckIntervals.clear();
  }

  /**
   * Explicitly stop the queue processor interval
   */
  stopQueueProcessor(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.info("Queue processor stopped");
    }
  }

  /**
   * Cleanup all intervals and timers - alias for cleanupForTests
   */
  cleanupAllIntervals(): void {
    this.cleanupForTests();
  }

  /**
   * Destructor to ensure proper cleanup when instance is garbage collected
   * This acts as a safety net for any scenarios where explicit cleanup wasn't called
   */
  [Symbol.dispose](): void {
    this.cleanupForTests();
  }

  /**
   * Static method to create a WebSocketManager instance with automatic cleanup
   * This is useful for test scenarios where we want to ensure cleanup happens
   */
  static createWithAutoCleanup(config?: WebSocketConfig): WebSocketManager {
    const manager = new WebSocketManager(config);

    // In test environment, automatically register cleanup
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      const originalDispose = manager[Symbol.dispose].bind(manager);
      manager[Symbol.dispose] = () => {
        originalDispose();
        if (manager.processingInterval) {
          clearInterval(manager.processingInterval);
          manager.processingInterval = null;
        }
      };
    }

    return manager;
  }
  // ===============================
  // QUEUE-BASED BACKPRESSURE SYSTEM
  // ===============================

  /**
   * Queue a message for processing with priority-based backpressure
   */
  queueMessage(
    topic: string,
    data: unknown,
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
    data: unknown,
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
      });
      return this.queueMessage(topic, data, priority, clientId);
    }
  }


  /**
   * Check if queue processor is running
   */
  isQueueProcessorRunning(): boolean {
    return this.processingInterval !== null;
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
      logger.error("Error processing message batch", error as Error, {
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

      const ws = this.getConnection(availableConnection);
      if (!ws) {
        logger.error("Available connection not found", undefined, {
          messageId: message.id,
          topic: message.topic,
        });
        return;
      }

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
      logger.error("Failed to process queued message", error as Error, {
        messageId: message.id,
        topic: message.topic,
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
          logger.error("Failed to send backpressure signal", error as Error, {
            connectionKey,
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
          logger.error("Failed to send backpressure resume signal", error as Error, {
            connectionKey,
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
    logger.warn("Queue full but no low priority messages to evict", {
      queueDepth: this.messageQueue.length,
      maxQueueSize: this.maxQueueSize,
    });
  }

  // ===============================
  // CIRCUIT BREAKER HEALTH VALIDATION
  // ===============================

  /**
   * Perform explicit health check for a connection
   */
  async performHealthCheck(connectionKey: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checksPerformed: string[] = [];

    try {
      const ws = this.getConnection(connectionKey);

      // Check 1: Basic connectivity
      if (!ws || !this.isConnected(connectionKey)) {
        return {
          healthy: false,
          responseTime: Date.now() - startTime,
          error: "Connection not available",
          checksPerformed,
          timestamp: startTime,
        };
      }
      checksPerformed.push("connectivity");

      // Check 2: Ping/Pong (if enabled)
      if (this.healthCheckConfig.enablePingPong) {
        try {
          await this.performPingPongCheck(ws, connectionKey);
          checksPerformed.push("ping_pong");
        } catch (error) {
          return {
            healthy: false,
            responseTime: Date.now() - startTime,
            error: `Ping/pong check failed: ${(error as Error).message}`,
            checksPerformed,
            timestamp: startTime,
          };
        }
      }

      // Additional checks can be added here (auth, subscription tests)
      // For now, basic connectivity and ping/pong are sufficient

      return {
        healthy: true,
        responseTime: Date.now() - startTime,
        checksPerformed,
        timestamp: startTime,
      };

    } catch (error) {
      return {
        healthy: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message,
        checksPerformed,
        timestamp: startTime,
      };
    }
  }

  /**
   * Perform ping/pong health check
   */
  private async performPingPongCheck(ws: WebSocket, _connectionKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Ping timeout"));
      }, this.healthCheckConfig.timeout);

      const originalPongHandler = ws.listeners('pong')[0];

      // Temporary pong handler for health check
      ws.once('pong', () => {
        clearTimeout(timeout);
        // Restore original handler if it existed
        if (originalPongHandler) {
          ws.on('pong', originalPongHandler);
        }
        resolve();
      });

      // Send ping
      try {
        ws.ping();
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Start health check monitoring for HALF_OPEN state
   */
  private startHealthCheckMonitoring(connectionKey: string): void {
    // Initialize recovery state
    const recoveryState: RecoveryState = {
      healthChecksPerformed: 0,
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      lastHealthCheck: null,
      recoveryStartTime: Date.now(),
    };

    this.recoveryStates.set(connectionKey, recoveryState);

    logger.info("Started health check monitoring for HALF_OPEN state", {
      connectionKey,
      checkInterval: this.healthCheckConfig.interval,
    });

    const healthCheckInterval = setInterval(async () => {
      await this.performRecoveryHealthCheck(connectionKey);
    }, this.healthCheckConfig.interval);

    this.healthCheckIntervals.set(connectionKey, healthCheckInterval);

    // Perform initial health check immediately
    setImmediate(() => this.performRecoveryHealthCheck(connectionKey));
  }

  /**
   * Stop health check monitoring
   */
  private stopHealthCheckMonitoring(connectionKey: string): void {
    const interval = this.healthCheckIntervals.get(connectionKey);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(connectionKey);
    }

    this.recoveryStates.delete(connectionKey);

    logger.debug("Stopped health check monitoring", { connectionKey });
  }

  /**
   * Perform health check during recovery (HALF_OPEN state)
   */
  private async performRecoveryHealthCheck(connectionKey: string): Promise<void> {
    const recoveryState = this.recoveryStates.get(connectionKey);
    if (!recoveryState) return;

    const healthResult = await this.performHealthCheck(connectionKey);
    recoveryState.healthChecksPerformed++;
    recoveryState.lastHealthCheck = healthResult;

    if (healthResult.healthy) {
      recoveryState.consecutiveSuccesses++;
      recoveryState.consecutiveFailures = 0;

      logger.info("Health check passed during recovery", {
        connectionKey,
        consecutiveSuccesses: recoveryState.consecutiveSuccesses,
        requiredSuccesses: this.healthCheckConfig.successThreshold,
        responseTime: healthResult.responseTime,
        checksPerformed: healthResult.checksPerformed,
      });

      // Check if we've reached success threshold
      if (recoveryState.consecutiveSuccesses >= this.healthCheckConfig.successThreshold) {
        await this.transitionToClosed(connectionKey, recoveryState);
      }

    } else {
      recoveryState.consecutiveFailures++;
      recoveryState.consecutiveSuccesses = 0;

      logger.warn("Health check failed during recovery", {
        connectionKey,
        consecutiveFailures: recoveryState.consecutiveFailures,
        maxFailures: this.healthCheckConfig.failureThreshold,
        error: healthResult.error,
        responseTime: healthResult.responseTime,
      });

      // Check if we've exceeded failure threshold
      if (recoveryState.consecutiveFailures >= this.healthCheckConfig.failureThreshold) {
        this.transitionToOpen(connectionKey, recoveryState, healthResult);
      }
    }
  }

  /**
   * Transition from HALF_OPEN to CLOSED (service recovered)
   */
  private async transitionToClosed(connectionKey: string, recoveryState: RecoveryState): Promise<void> {
    this.circuitStates.set(connectionKey, CircuitState.CLOSED);
    this.stopHealthCheckMonitoring(connectionKey);

    const recoveryDuration = Date.now() - recoveryState.recoveryStartTime;

    logger.info("Circuit breaker transitioned to CLOSED - service recovered", {
      connectionKey,
      recoveryDurationMs: recoveryDuration,
      healthChecksPerformed: recoveryState.healthChecksPerformed,
      finalSuccessCount: recoveryState.consecutiveSuccesses,
    });

    // Reset reconnection attempts on successful recovery
    this.reconnectAttempts.set(connectionKey, 0);

    // Attempt immediate reconnection if not already connected
    if (!this.isConnected(connectionKey)) {
      logger.info("Attempting immediate reconnection after recovery", {
        connectionKey,
      });
      // Note: Actual reconnection will be handled by the service layer
    }
  }

  /**
   * Transition from HALF_OPEN back to OPEN (recovery failed)
   */
  private transitionToOpen(
    connectionKey: string,
    recoveryState: RecoveryState,
    lastHealthResult: HealthCheckResult
  ): void {
    this.circuitStates.set(connectionKey, CircuitState.OPEN);
    this.lastFailureTime.set(connectionKey, Date.now());
    this.stopHealthCheckMonitoring(connectionKey);

    const recoveryDuration = Date.now() - recoveryState.recoveryStartTime;

    logger.warn("Circuit breaker transitioned back to OPEN - recovery failed", {
      connectionKey,
      recoveryDurationMs: recoveryDuration,
      healthChecksPerformed: recoveryState.healthChecksPerformed,
      finalFailureCount: recoveryState.consecutiveFailures,
      lastError: lastHealthResult.error,
    });

    // Schedule circuit breaker reset
    this.scheduleCircuitBreakerReset(connectionKey);
  }

  /**
   * Get comprehensive statistics including backpressure and health check metrics
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
    recoveryStates: Record<string, RecoveryState>;
    healthCheckConfig: HealthCheckConfig;
  } {
    const circuitBreakerStates: Record<string, CircuitState> = {};
    for (const [key, state] of this.circuitStates.entries()) {
      circuitBreakerStates[key] = state;
    }

    const backpressureStates: Record<string, BackpressureState> = {};
    for (const [key, state] of this.backpressureStates.entries()) {
      backpressureStates[key] = state;
    }

    const recoveryStates: Record<string, RecoveryState> = {};
    for (const [key, state] of this.recoveryStates.entries()) {
      recoveryStates[key] = state;
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
      recoveryStates,
      healthCheckConfig: this.healthCheckConfig,
    };
  }
}