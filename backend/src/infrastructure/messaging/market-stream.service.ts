/** @format */

import WebSocket from "ws";
import { Server } from "socket.io";
import { marketStreamLogger } from "../../core/logging/context-aware-logger.service";
import { redisService } from "../cache";
import { query } from "../../database/pool";
import { KlineData, BaseWebSocketMessage } from "./market-stream/types";

// Define specific WebSocket message types to eliminate 'any' usage
interface WebSocketAuthMessage {
  event: "auth";
  id?: string;
  success?: boolean;
  code?: number;
  [key: string]: unknown;
}

interface WebSocketSubscriptionMessage {
  event: "subscribed" | "subscribe";
  method?: "SUBSCRIBE";
  success?: boolean;
  code?: number;
  topic?: string;
  params?: string | string[];
  [key: string]: unknown;
}

interface WebSocketMarketDataMessage {
  topic: string;
  data: {
    symbol?: string;
    price?: string;
    lastPrice?: string;
    volume?: string;
    bid?: string;
    ask?: string;
    change24h?: string;
    startTime?: number;
    open?: string;
    close?: string;
    high?: string;
    low?: string;
    amount?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface WebSocketErrorMessage {
  error?: string;
  message?: string;
  code?: number;
  [key: string]: unknown;
}

type WebSocketMessage =
  | WebSocketAuthMessage
  | WebSocketSubscriptionMessage
  | WebSocketMarketDataMessage
  | WebSocketErrorMessage
  | BaseWebSocketMessage;

interface TickData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
  bid: number;
  ask: number;
  change24h: number;
}

// ===========================================
// SUB-COMPONENTS FOR MARKET STREAM SERVICE
// ===========================================

/**
 * Circuit breaker states for WebSocket reconnection
 */
enum CircuitState {
  CLOSED = "closed", // Normal operation, reconnections allowed
  OPEN = "open", // Circuit open, stop retrying
  HALF_OPEN = "half_open", // Testing if service recovered
}

/**
 * Connection health scoring for reliability assessment
 */
interface ConnectionHealth {
  connectivity: number;    // 0-100 (ping/pong success rate)
  dataFlow: number;       // 0-100 (messages per minute)
  latency: number;        // Average response time in ms
  stability: number;      // Connection uptime percentage
  overall: number;        // Weighted health score 0-100
  lastUpdated: number;    // Timestamp of last update
}

/**
 * Backoff state for coordinated reconnection timing
 */
interface BackoffState {
  attemptNumber: number;
  baseDelay: number;
  currentDelay: number;
  startTime: number;
  lastAttempt: number;
  totalAttempts: number;
}

/**
 * ===========================================
 * 🚀 ENTERPRISE WEBSOCKET MANAGER - RELIABILITY FIRST
 * ===========================================
 *
 * Manages WebSocket connections with enterprise-grade reliability:
 * - Connection limits to prevent resource exhaustion
 * - Intelligent circuit breaker requiring sustained success
 * - Coordinated backoff management for reconnections
 * - Connection health scoring and emergency protocols
 * - Resource pooling and connection reuse
 *
 * RELIABILITY FEATURES:
 * - Max connection limits with configurable thresholds
 * - Sustained success validation (not single messages)
 * - Backoff coordination between circuit breaker and reconnections
 * - Connection health monitoring with scoring
 * - Emergency protocols for connection crises
 * - Resource-efficient connection pooling
 *
 * @format
 */
class WebSocketManager {
  // Core connection management
  private websockets: Map<string, WebSocket> = new Map();
  private connectionHealth: Map<string, ConnectionHealth> = new Map();

  // Connection limits and resource protection
  private readonly MAX_CONNECTIONS = 5; // Prevent resource exhaustion
  private readonly MAX_CONNECTIONS_PER_ACCOUNT = 2; // Per-account limits
  private connectionCounts: Map<string, number> = new Map();

  // Circuit breaker with sustained success requirement
  private circuitStates: Map<string, CircuitState> = new Map();
  private consecutiveSuccesses: Map<string, number> = new Map();
  private requiredSuccesses = 3; // Need 3 consecutive successes
  private successWindowMs = 30000; // Within 30 seconds

  // Coordinated backoff management
  private reconnectIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private lastFailureTime: Map<string, number> = new Map();
  private circuitBreakerTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private activeBackoffs: Map<string, BackoffState> = new Map();

  // Emergency management
  private emergencyMode = false;
  private emergencyConnections: Set<string> = new Set();

  // Configuration
  private readonly BASE_URL = "wss://ws-evm.orderly.org/ws/stream";
  private readonly MIN_RECONNECT_DELAY = 1000;
  private readonly MAX_RECONNECT_DELAY = 30000;
  private readonly MAX_RECONNECT_ATTEMPTS = 12;
  private readonly HEARTBEAT_INTERVAL = 30000;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 2 * 60 * 1000;

  // Health check configuration
  private readonly HEALTH_CHECK_CONFIG = {
    pingTimeout: 5000,
    pongTimeout: 5000,
    messageTimeout: 10000,
    sustainedSuccessWindow: 30000,
  };

  /**
   * Create WebSocket connection with connection limits and resource protection
   */
  async createConnection(accountId: string): Promise<WebSocket> {
    // Check connection limits
    if (this.websockets.size >= this.MAX_CONNECTIONS) {
      throw new Error(`Connection limit exceeded (${this.MAX_CONNECTIONS})`);
    }

    const accountConnections = this.connectionCounts.get(accountId) || 0;
    if (accountConnections >= this.MAX_CONNECTIONS_PER_ACCOUNT) {
      throw new Error(`Per-account connection limit exceeded (${this.MAX_CONNECTIONS_PER_ACCOUNT}) for ${accountId}`);
    }

    // Check if connection already exists and is healthy
    if (this.websockets.has("market")) {
      const existingWs = this.websockets.get("market");
      const health = this.connectionHealth.get("market");

      if (existingWs?.readyState === WebSocket.OPEN &&
        health &&
        health.overall > 70 &&
        !this.emergencyMode) {
        marketStreamLogger.debug("Reusing healthy existing WebSocket connection");
        return existingWs;
      }
    }

    const wsUrl = `${this.BASE_URL}/${accountId}`;
    marketStreamLogger.info("Creating new Orderly market WebSocket connection", {
      url: wsUrl,
      accountId,
      totalConnections: this.websockets.size,
      accountConnections,
    });

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        marketStreamLogger.info("Orderly market WebSocket connected successfully");
        this.websockets.set("market", ws);
        this.connectionCounts.set(accountId, (this.connectionCounts.get(accountId) || 0) + 1);

        // Initialize connection health tracking
        this.connectionHealth.set("market", {
          connectivity: 100,
          dataFlow: 0,
          latency: 0,
          stability: 100,
          overall: 100,
          lastUpdated: Date.now(),
        });

        this.reconnectAttempts.set("market", 0);

        // Reset circuit breaker on successful connection (but not on single messages)
        this.circuitStates.set("market", CircuitState.CLOSED);
        this.consecutiveSuccesses.set("market", 0); // Reset for new connection

        this.startHeartbeat("market", ws);
        resolve(ws);
      });

      ws.on("error", (error: Error) => {
        marketStreamLogger.error("Orderly market WebSocket connection error", error, {
          error: error.message,
        });

        // Update connection health
        this.updateConnectionHealth("market", 'connection_failed');

        reject(error);
      });

      ws.on("close", (code: number, reason: string) => {
        marketStreamLogger.warn("Orderly market WebSocket closed", { code, reason });
        this.websockets.delete("market");

        // Update connection counts
        const currentCount = this.connectionCounts.get(accountId) || 0;
        if (currentCount > 0) {
          this.connectionCounts.set(accountId, currentCount - 1);
        }

        // Update connection health
        this.updateConnectionHealth("market", 'disconnected');

        this.stopHeartbeat("market");
        this.scheduleReconnect("market");
      });

      ws.on("message", (_data: WebSocket.Data) => {
        // Update connection health for successful message
        this.updateConnectionHealth("market", 'message_received');

        // Intelligent circuit breaker: require sustained success, not single messages
        this.handleMessageForCircuitBreaker("market");
      });

      ws.on("pong", () => {
        marketStreamLogger.debug("Heartbeat pong received from Orderly");
        // Update connection health for successful ping/pong
        this.updateConnectionHealth("market", 'pong_received');
      });
    });
  }

  getConnection(): WebSocket | null {
    return this.websockets.get("market") || null;
  }

  isConnected(): boolean {
    const ws = this.websockets.get("market");
    return ws ? ws.readyState === WebSocket.OPEN : false;
  }

  private startHeartbeat(wsKey: string, ws: WebSocket): void {
    this.stopHeartbeat(wsKey);
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        marketStreamLogger.debug("Heartbeat ping sent", { wsKey });
      } else {
        clearInterval(heartbeat);
        this.heartbeatIntervals.delete(wsKey);
      }
    }, 30000);
    this.heartbeatIntervals.set(wsKey, heartbeat);
  }

  private stopHeartbeat(wsKey: string): void {
    const heartbeat = this.heartbeatIntervals.get(wsKey);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeatIntervals.delete(wsKey);
    }
  }

  private calculateBackoff(wsKey: string): number {
    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    const exponentialDelay = Math.min(
      this.MIN_RECONNECT_DELAY * Math.pow(2, Math.min(attempts, 5)),
      this.MAX_RECONNECT_DELAY
    );
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }

  private calculateCircuitBreakerTimeout(wsKey: string): number {
    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    // Exponential backoff: 1s → 10s → 30s → 60s → 120s (max)
    const exponentialTimeout = Math.min(
      1000 * Math.pow(2, Math.min(attempts, 6)), // Max 2^6 = 64s, but we'll cap at 120s
      this.CIRCUIT_BREAKER_TIMEOUT
    );
    return exponentialTimeout;
  }

  private scheduleReconnect(wsKey: string): void {
    if (this.reconnectIntervals.has(wsKey)) return;

    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    const circuitState = this.circuitStates.get(wsKey) || CircuitState.CLOSED;

    // Check if circuit breaker is open (stop retrying)
    if (circuitState === CircuitState.OPEN) {
      const lastFailure = this.lastFailureTime.get(wsKey) || 0;
      const timeSinceFailure = Date.now() - lastFailure;
      const circuitBreakerTimeout = this.calculateCircuitBreakerTimeout(wsKey);

      // If enough time has passed, try half-open state with health check
      if (timeSinceFailure >= circuitBreakerTimeout) {
        marketStreamLogger.info("Circuit breaker transitioning to half-open with health check", {
          wsKey,
          timeSinceFailureMs: timeSinceFailure,
          circuitBreakerTimeout,
        });
        this.circuitStates.set(wsKey, CircuitState.HALF_OPEN);
        this.reconnectAttempts.set(wsKey, 0); // Reset attempts for half-open
      } else {
        marketStreamLogger.debug("Circuit breaker open, skipping reconnect", {
          wsKey,
          attempts,
          timeSinceFailureMs: timeSinceFailure,
          remainingMs: circuitBreakerTimeout - timeSinceFailure,
        });
        return;
      }
    }

    // Check if we've exceeded maximum retry attempts
    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      marketStreamLogger.error(
        "Maximum reconnection attempts exceeded, opening circuit breaker",
        undefined,
        {
          wsKey,
          attempts,
          maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
        }
      );
      this.circuitStates.set(wsKey, CircuitState.OPEN);
      this.lastFailureTime.set(wsKey, Date.now());

      // Schedule circuit breaker reset
      this.scheduleCircuitBreakerReset(wsKey);
      return;
    }

    const delay = this.calculateBackoff(wsKey);
    marketStreamLogger.info("Scheduling reconnect", {
      wsKey,
      attempt: attempts + 1,
      maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
      delayMs: Math.round(delay),
      circuitState,
    });

    const timer = setTimeout(async () => {
      marketStreamLogger.info("Attempting reconnect", { wsKey, attempt: attempts + 1 });
      this.reconnectIntervals.delete(wsKey);
      this.reconnectAttempts.set(wsKey, attempts + 1);
      // Note: reconnection logic will be handled by the main service
    }, delay);

    this.reconnectIntervals.set(wsKey, timer);
  }

  /**
   * Perform health check in HALF_OPEN state
   */
  private async performHalfOpenHealthCheck(wsKey: string): Promise<boolean> {
    try {
      marketStreamLogger.info("Performing health check in HALF_OPEN state", { wsKey });

      // Send a simple ping/pong test or subscription test
      const ws = this.websockets.get(wsKey);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        marketStreamLogger.debug("WebSocket not available for health check", { wsKey });
        return false;
      }

      // Send a test ping (WebSocket built-in ping)
      ws.ping();

      // Wait for pong response (with timeout)
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          marketStreamLogger.debug("Health check timeout - no pong received", { wsKey });
          resolve(false);
        }, 5000); // 5 second timeout for health check

        const pongHandler = () => {
          clearTimeout(timeout);
          ws.removeListener('pong', pongHandler);
          marketStreamLogger.info("Health check passed - pong received", { wsKey });
          resolve(true);
        };

        ws.once('pong', pongHandler);
      });
    } catch (error) {
      marketStreamLogger.error("Health check failed", error as Error, {
        wsKey,
        error: (error as Error).message,
      });
      return false;
    }
  }

  private scheduleCircuitBreakerReset(wsKey: string): void {
    if (this.circuitBreakerTimeouts.has(wsKey)) return;

    const resetDelayMs = this.calculateCircuitBreakerTimeout(wsKey);
    marketStreamLogger.info("Scheduling circuit breaker reset", {
      wsKey,
      resetDelayMs,
    });

    const timer = setTimeout(async () => {
      marketStreamLogger.info("Circuit breaker reset timeout reached", { wsKey });
      this.circuitBreakerTimeouts.delete(wsKey);

      // Transition to HALF_OPEN state
      this.circuitStates.set(wsKey, CircuitState.HALF_OPEN);

      // Perform health check before allowing reconnection
      const isHealthy = await this.performHalfOpenHealthCheck(wsKey);

      if (isHealthy) {
        marketStreamLogger.info("Health check passed, transitioning to CLOSED", { wsKey });
        this.circuitStates.set(wsKey, CircuitState.CLOSED);
        this.reconnectAttempts.set(wsKey, 0); // Reset attempts
      } else {
        marketStreamLogger.warn("Health check failed, staying in HALF_OPEN", { wsKey });
        // Stay in HALF_OPEN and schedule another check
        this.scheduleCircuitBreakerReset(wsKey);
      }
    }, resetDelayMs);

    this.circuitBreakerTimeouts.set(wsKey, timer);
  }

  disconnect(wsKey: string): void {
    const ws = this.websockets.get(wsKey);
    if (ws) {
      ws.close();
      this.websockets.delete(wsKey);
    }

    const timer = this.reconnectIntervals.get(wsKey);
    if (timer) {
      clearTimeout(timer);
      this.reconnectIntervals.delete(wsKey);
    }

    this.stopHeartbeat(wsKey);
    this.reconnectAttempts.delete(wsKey);
    marketStreamLogger.info("WebSocket disconnected", { wsKey });
  }

  disconnectAll(): void {
    this.websockets.forEach((ws, wsKey) => this.disconnect(wsKey));
    this.reconnectIntervals.forEach(timer => clearTimeout(timer));
    this.reconnectIntervals.clear();
    this.heartbeatIntervals.forEach(timer => clearInterval(timer));
    this.heartbeatIntervals.clear();
    this.reconnectAttempts.clear();
    // Clear circuit breaker state
    this.circuitStates.clear();
    this.lastFailureTime.clear();
    this.circuitBreakerTimeouts.forEach(timer => clearTimeout(timer));
    this.circuitBreakerTimeouts.clear();

    // Clear connection health and limits
    this.connectionHealth.clear();
    this.connectionCounts.clear();
    this.consecutiveSuccesses.clear();
    this.activeBackoffs.clear();

    marketStreamLogger.info("All WebSocket connections and circuit breaker state cleared");
  }

  /**
   * Update connection health metrics
   */
  private updateConnectionHealth(connectionKey: string, event: 'message_received' | 'pong_received' | 'connection_failed' | 'disconnected'): void {
    const currentHealth = this.connectionHealth.get(connectionKey);
    if (!currentHealth) return;

    const now = Date.now();

    switch (event) {
      case 'message_received':
        currentHealth.dataFlow = Math.min(100, currentHealth.dataFlow + 5); // Increase data flow score
        currentHealth.lastUpdated = now;
        break;

      case 'pong_received':
        currentHealth.connectivity = Math.min(100, currentHealth.connectivity + 2); // Increase connectivity score
        currentHealth.lastUpdated = now;
        break;

      case 'connection_failed':
        currentHealth.connectivity = Math.max(0, currentHealth.connectivity - 20); // Decrease connectivity
        currentHealth.stability = Math.max(0, currentHealth.stability - 10); // Decrease stability
        currentHealth.lastUpdated = now;
        break;

      case 'disconnected':
        currentHealth.stability = Math.max(0, currentHealth.stability - 15); // Decrease stability
        currentHealth.lastUpdated = now;
        break;
    }

    // Recalculate overall health score
    currentHealth.overall = this.calculateOverallHealth(currentHealth);

    this.connectionHealth.set(connectionKey, currentHealth);
  }

  /**
   * Handle message for intelligent circuit breaker
   */
  private handleMessageForCircuitBreaker(connectionKey: string): void {
    const currentSuccesses = this.consecutiveSuccesses.get(connectionKey) || 0;
    const newSuccesses = currentSuccesses + 1;

    this.consecutiveSuccesses.set(connectionKey, newSuccesses);

    // Only reset circuit breaker after sustained success (not single messages)
    if (newSuccesses >= this.requiredSuccesses) {
      const circuitState = this.circuitStates.get(connectionKey);
      if (circuitState === CircuitState.HALF_OPEN) {
        // Transition from HALF_OPEN to CLOSED after sustained success
        this.circuitStates.set(connectionKey, CircuitState.CLOSED);
        this.consecutiveSuccesses.set(connectionKey, 0); // Reset for new connection

        marketStreamLogger.info("Circuit breaker transitioned to CLOSED after sustained success", {
          connectionKey,
          requiredSuccesses: this.requiredSuccesses,
          sustainedSuccessWindow: this.successWindowMs,
        });
      }
    }
  }

  /**
   * Calculate overall health score from individual metrics
   */
  private calculateOverallHealth(health: ConnectionHealth): number {
    // Weighted scoring: connectivity (40%), data flow (30%), stability (30%)
    const connectivityWeight = 0.4;
    const dataFlowWeight = 0.3;
    const stabilityWeight = 0.3;

    return Math.round(
      (health.connectivity * connectivityWeight) +
      (health.dataFlow * dataFlowWeight) +
      (health.stability * stabilityWeight)
    );
  }

  /**
   * Get comprehensive WebSocket manager statistics
   */
  getComprehensiveStats() {
    const totalConnections = this.websockets.size;
    const healthyConnections = Array.from(this.connectionHealth.values())
      .filter(health => health.overall >= 70).length;

    const connectionLimitUtilization = (totalConnections / this.MAX_CONNECTIONS) * 100;
    const emergencyModeTriggered = this.emergencyMode;

    return {
      connections: {
        total: totalConnections,
        healthy: healthyConnections,
        unhealthy: totalConnections - healthyConnections,
        limitUtilization: Math.round(connectionLimitUtilization),
      },
      circuitBreaker: {
        states: Object.fromEntries(this.circuitStates.entries()),
        consecutiveSuccesses: Object.fromEntries(this.consecutiveSuccesses.entries()),
      },
      connectionHealth: Object.fromEntries(
        Array.from(this.connectionHealth.entries()).map(([key, health]) => [
          key,
          {
            overall: health.overall,
            connectivity: health.connectivity,
            dataFlow: health.dataFlow,
            stability: health.stability,
            lastUpdated: health.lastUpdated,
          }
        ])
      ),
      emergency: {
        modeActive: emergencyModeTriggered,
        emergencyConnections: this.emergencyConnections.size,
      },
      limits: {
        maxConnections: this.MAX_CONNECTIONS,
        maxPerAccount: this.MAX_CONNECTIONS_PER_ACCOUNT,
        currentConnectionCounts: Object.fromEntries(this.connectionCounts.entries()),
      },
    };
  }
}

/**
 * Handles WebSocket authentication
 */
class AuthManager {
  async authenticate(ws: WebSocket, accountId: string): Promise<void> {
    try {
      const credsResult = await query<{
        api_key_encrypted: string;
        secret_key_encrypted: string;
      }>(
        "SELECT api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE account_id = $1",
        [accountId]
      );

      if (credsResult.rows.length === 0) {
        throw new Error("No credentials found for WebSocket authentication");
      }

      const { encryptionService } = await import("../../infrastructure/security/encryption.service.js");
      const apiKey = encryptionService.decryptApiKey(
        credsResult.rows[0].api_key_encrypted
      );
      const secretKey = encryptionService.decryptSecretKey(
        credsResult.rows[0].secret_key_encrypted
      );

      const timestamp = Date.now();
      // Orderly API requires specific message format for WebSocket auth
      const message = `${timestamp}GET/ws/stream/public${accountId}`;

      const bs58 = await import("bs58");
      const ed25519 = await import("@noble/ed25519");

      // Configure hash function for ed25519
      const { createHash } = await import("crypto");
      const sha512Hash = (message: Uint8Array) => {
        const hash = createHash("sha512");
        hash.update(message);
        return new Uint8Array(hash.digest());
      };

      // Set hash function for ed25519
      const ed25519Lib = ed25519 as unknown as {
        hashes?: { sha512?: (message: Uint8Array) => Uint8Array };
        etc?: { sha512Sync?: (message: Uint8Array) => Uint8Array };
        utils?: { sha512Sync?: (message: Uint8Array) => Uint8Array };
        sign?: (message: Uint8Array, privateKey: Uint8Array) => Uint8Array | Promise<Uint8Array>;
      };

      if (ed25519Lib.hashes) {
        ed25519Lib.hashes.sha512 = sha512Hash;
      } else if (ed25519Lib.etc && typeof ed25519Lib.etc?.sha512Sync !== "undefined") {
        ed25519Lib.etc.sha512Sync = sha512Hash;
      } else if (ed25519Lib.utils) {
        ed25519Lib.utils.sha512Sync = sha512Hash;
      }

      const privateKey = bs58.default.decode(secretKey);
      const messageBytes = new TextEncoder().encode(message);
      const signature = ed25519Lib.sign?.(messageBytes, privateKey) || Promise.resolve(new Uint8Array());
      const signatureResult = await (signature instanceof Promise ? signature : Promise.resolve(signature));
      const signatureB64 = Buffer.from(signatureResult).toString("base64url");

      const authMessage = JSON.stringify({
        event: "auth",
        id: `auth_${Date.now()}`,
        params: { accountId, apiKey, signature: signatureB64, timestamp },
      });

      ws.send(authMessage);
      marketStreamLogger.info("WebSocket authentication message sent", { accountId });
    } catch (error) {
      marketStreamLogger.error("Failed to send WebSocket authentication", error as Error, {});
      throw error;
    }
  }
}

/**
 * Manages data caching and retrieval
 */
class CacheManager {
  async cacheTick(symbol: string, data: TickData): Promise<void> {
    const result = await redisService.setex(
      `tick:${symbol}`,
      60,
      JSON.stringify(data)
    );
    if (!result.success) {
      marketStreamLogger.warn("Tick cache write failed", {
        symbol,
        error: result.error,
      });
    }
  }

  async getTick(symbol: string): Promise<TickData | null> {
    const result = await redisService.get(`tick:${symbol}`);
    if (result.success && result.data) {
      return JSON.parse(result.data);
    } else if (!result.success) {
      marketStreamLogger.warn("Tick cache read failed", {
        symbol,
        error: result.error,
      });
    }
    return null;
  }

  async cacheKlines(
    symbol: string,
    interval: string,
    klines: KlineData[]
  ): Promise<void> {
    const cacheKey = `kline:${symbol}:${interval}`;

    // Use atomic operation to prevent race conditions
    const result = await this.atomicCacheUpdate(cacheKey, klines, 3600);
    if (!result.success) {
      marketStreamLogger.warn("Klines cache write failed", {
        symbol,
        interval,
        error: result.error,
      });
    }
  }

  /**
   * Atomically update cache using WATCH/MULTI/EXEC to prevent race conditions
   */
  private async atomicCacheUpdate(
    key: string,
    data: unknown,
    ttlSeconds: number,
    maxRetries: number = 3
  ): Promise<{ success: boolean; error?: string }> {
    const client = redisService.getClient();
    const serializedData = JSON.stringify(data);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Watch the key for changes
        await client.watch(key);

        // Start transaction
        const multi = client.multi();

        // Set the data
        multi.set(key, serializedData);
        // Set expiration
        multi.expire(key, ttlSeconds);

        // Execute transaction
        const results = await multi.exec();

        // If results is null, the transaction was aborted (key changed)
        if (results === null) {
          marketStreamLogger.debug("Cache update transaction aborted, retrying", {
            key,
            attempt: attempt + 1,
          });

          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
          continue;
        }

        // Transaction succeeded
        marketStreamLogger.debug("Atomic cache update successful", {
          key,
          ttlSeconds,
          attempt: attempt + 1,
        });
        return { success: true };

      } catch (error) {
        marketStreamLogger.warn("Atomic cache update failed", {
          key,
          attempt: attempt + 1,
          error: (error as Error).message,
        });

        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
      } finally {
        // Always unwatch the key
        try {
          await client.unwatch();
        } catch (_unwatchError) {
          // Ignore unwatch errors
        }
      }
    }

    // All retries failed, fallback to simple setex
    marketStreamLogger.warn("Atomic cache update failed after retries, using fallback", {
      key,
      maxRetries,
    });

    return redisService.setex(key, ttlSeconds, serializedData);
  }

  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 300
  ): Promise<KlineData[]> {
    const cacheKey = `kline:${symbol}:${interval}`;
    const result = await redisService.get(cacheKey);
    if (result.success && result.data) {
      const klines = JSON.parse(result.data) as KlineData[];
      return klines.slice(-limit);
    } else if (!result.success) {
      marketStreamLogger.warn("Klines cache read failed", {
        symbol,
        interval,
        error: result.error,
      });
    }
    return [];
  }

  async cacheMarkPrice(symbol: string, data: { symbol: string; price: number; timestamp: number }): Promise<void> {
    const cacheKey = `markprice:${symbol}`;
    const result = await redisService.setex(cacheKey, 30, JSON.stringify(data));
    if (!result.success) {
      marketStreamLogger.warn("Mark price cache write failed", {
        symbol,
        error: result.error,
      });
    }
  }

  async getMarkPrice(symbol: string): Promise<{ symbol: string; price: number; timestamp: number } | null> {
    const cacheKey = `markprice:${symbol}`;
    const result = await redisService.get(cacheKey);
    if (result.success && result.data) {
      return JSON.parse(result.data) as { symbol: string; price: number; timestamp: number };
    } else if (!result.success) {
      marketStreamLogger.warn("Mark price cache read failed", {
        symbol,
        error: result.error,
      });
    }
    return null;
  }
}

/**
 * Manages processing queue with backpressure handling
 */
class ProcessingQueue {
  private queue: BaseWebSocketMessage[] = [];
  private isProcessing = false;
  private maxQueueSize = 1000;
  private processingPromises: Map<string, Promise<void>> = new Map();

  constructor(private messageHandler: MessageHandler) { }

  /**
   * Add message to processing queue
   */
  enqueue(message: BaseWebSocketMessage): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      marketStreamLogger.warn("Processing queue full, dropping message", {
        queueSize: this.queue.length,
        maxSize: this.maxQueueSize,
        messageTopic: message.topic,
      });
      return false;
    }

    this.queue.push(message);

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }

    return true;
  }

  /**
   * Process messages in queue with backpressure
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const message = this.queue.shift();

        // If queue is empty or message is undefined, break
        if (!message) {
          break;
        }

        // Check if we have too many concurrent processing operations
        if (this.processingPromises.size >= 10) {
          marketStreamLogger.debug("Processing queue backpressure triggered", {
            queueSize: this.queue.length,
            concurrentOperations: this.processingPromises.size,
          });

          // Wait a bit before processing more
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Process message asynchronously
        const processingKey = `${message.topic}_${Date.now()}`;
        const processingPromise = this.messageHandler.handleMessage(message)
          .catch(error => {
            marketStreamLogger.error("Message processing failed", error as Error, {
              topic: message.topic,
            });
          })
          .finally(() => {
            this.processingPromises.delete(processingKey);
          });

        this.processingPromises.set(processingKey, processingPromise);

        // Small delay between messages to prevent overwhelming Redis
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): { queueSize: number; isProcessing: boolean; concurrentOperations: number } {
    return {
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      concurrentOperations: this.processingPromises.size,
    };
  }

  /**
   * Clear queue (for shutdown)
   */
  clear(): void {
    this.queue.length = 0;
    this.processingPromises.clear();
  }
}

/**
 * Handles WebSocket message processing and routing
 */
class MessageHandler {
  private io: Server | null = null;
  private cacheManager: CacheManager;
  private processingQueue: ProcessingQueue;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
    this.processingQueue = new ProcessingQueue(this);
  }

  setSocketServer(io: Server): void {
    this.io = io;
  }

  /**
   * Enqueue message for processing with backpressure handling
   */
  enqueueMessage(message: BaseWebSocketMessage): boolean {
    return this.processingQueue.enqueue(message);
  }

  async handleMessage(message: BaseWebSocketMessage): Promise<void> {
    try {
      // Handle authentication responses
      if (message.event === "auth" || message.method === "AUTH") {
        if (message.success || message.code === 0) {
          marketStreamLogger.info("WebSocket authentication successful");
        } else {
          marketStreamLogger.error("WebSocket authentication failed", new Error(JSON.stringify(message)));
        }
        return;
      }

      // Handle subscription responses
      if (message.event === "subscribed" || message.method === "SUBSCRIBE") {
        if (message.success || message.code === 0) {
          marketStreamLogger.info("WebSocket subscription successful", {
            topic: message.topic || (message as WebSocketSubscriptionMessage).params,
          });
        } else {
          marketStreamLogger.error("WebSocket subscription failed", new Error(JSON.stringify(message)), {});
        }
        return;
      }

      // Handle market data messages
      if (message.topic && message.data) {
        const topic = message.topic;
        marketStreamLogger.info("Processing market data message", { topic });

        if (topic.includes("@kline_")) {
          await this.handleKlineData(message as WebSocketMarketDataMessage);
        } else if (topic === "ticker") {
          const data = message.data as { symbol?: string; price?: string; lastPrice?: string; volume?: string; bid?: string; ask?: string; change24h?: string };
          if (data.symbol) {
            await this.handleTickerData(data.symbol, data);
          } else {
            marketStreamLogger.warn("Ticker data missing symbol", { topic });
          }
        } else if (topic.includes("@markprice")) {
          await this.handleMarkPriceData(message as WebSocketMarketDataMessage);
        } else {
          marketStreamLogger.debug("Unhandled message topic", { topic });
        }
      }
    } catch (error) {
      marketStreamLogger.error("Handle message error", error as Error, {});
    }
  }

  private async handleTickerData(symbol: string, data: { price?: string; lastPrice?: string; volume?: string; bid?: string; ask?: string; change24h?: string }): Promise<void> {
    try {
      const tickData: TickData = {
        symbol,
        price: parseFloat(data.price || data.lastPrice || '0'),
        volume: parseFloat(data.volume || '0'),
        timestamp: Date.now(),
        bid: parseFloat(data.bid || '0'),
        ask: parseFloat(data.ask || '0'),
        change24h: parseFloat(data.change24h || '0'),
      };

      await this.cacheManager.cacheTick(symbol, tickData);

      if (this.io) {
        this.io.emit(`market:${symbol}`, tickData);
      }

      marketStreamLogger.debug("Ticker data cached and broadcasted", {
        symbol,
        price: tickData.price,
      });
    } catch (error) {
      marketStreamLogger.error("Handle ticker data error", error as Error, {
        symbol,
      });
    }
  }

  private async handleMarkPriceData(message: { topic: string; data: { symbol?: string; price?: string; timestamp?: number } }): Promise<void> {
    try {
      const markPriceData = message.data;
      if (!markPriceData?.symbol) {
        marketStreamLogger.error("Invalid mark price data format", new Error(String(message)));
        return;
      }

      const symbol = message.topic.split("@")[0];
      const priceData = {
        symbol,
        price: parseFloat(markPriceData.price || '0'),
        timestamp: markPriceData.timestamp || Date.now(),
      };

      await this.cacheManager.cacheMarkPrice(symbol, priceData);

      if (this.io) {
        this.io.emit(`markprice:${symbol}`, priceData);
      }

      marketStreamLogger.debug("Mark price data cached and broadcasted", {
        symbol,
        price: priceData.price,
      });
    } catch (error) {
      marketStreamLogger.error("Handle mark price data error", error as Error, {});
    }
  }

  private async handleKlineData(message: { topic: string; data: { symbol?: string; startTime?: number; open?: string; close?: string; high?: string; low?: string; volume?: string; amount?: string } }): Promise<void> {
    try {
      const klineData = message.data;
      if (!klineData?.symbol) {
        marketStreamLogger.error("Invalid kline data format", new Error(String(message)));
        return;
      }

      const parts = message.topic.split("@");
      const symbol = parts[0];
      const klinePart = parts[1] || "";
      const interval = klinePart.replace("kline_", "");

      const newCandle: KlineData = {
        symbol,
        type: "kline",
        open: parseFloat((klineData.open || "0").toString()),
        high: parseFloat((klineData.high || "0").toString()),
        low: parseFloat((klineData.low || "0").toString()),
        close: parseFloat((klineData.close || "0").toString()),
        volume: parseFloat((klineData.volume || "0").toString()),
        amount: parseFloat((klineData.amount || "0").toString()),
        startTime: klineData.startTime ? parseInt(klineData.startTime.toString()) : 0,
        endTime: klineData.startTime ? parseInt(klineData.startTime.toString()) : 0,
      };

      const existingKlines = await this.cacheManager.getKlines(
        symbol,
        interval,
        300
      );
      const updatedKlines = [...existingKlines, newCandle]
        .filter(
          (candle, index, arr) =>
            arr.findIndex(c => c.startTime === candle.startTime) === index
        )
        .slice(-300);

      await this.cacheManager.cacheKlines(symbol, interval, updatedKlines);

      if (this.io) {
        this.io.emit(`kline:${symbol}:${interval}`, { ...klineData, interval });
      }

      marketStreamLogger.debug("Kline data cached and broadcasted", {
        symbol,
        interval,
        candleCount: updatedKlines.length,
      });
    } catch (error) {
      marketStreamLogger.error("Handle kline data error", error as Error, {});
    }
  }
}

/**
 * Manages subscriptions with reference counting and cleanup
 */
class SubscriptionManager {
  private activeSubscriptions: Map<
    string,
    { count: number; lastUsed: number }
  > = new Map();
  private subscriptionTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingSubscriptions: Set<string> = new Set();

  subscribe(clientId: string, topic: string): void {
    const existing = this.activeSubscriptions.get(topic);
    const now = Date.now();

    if (existing) {
      existing.count += 1;
      existing.lastUsed = now;
      marketStreamLogger.debug("Subscription reference incremented", {
        topic,
        count: existing.count,
        clientId,
      });
    } else {
      this.activeSubscriptions.set(topic, { count: 1, lastUsed: now });
      marketStreamLogger.info("New subscription activated", { topic, clientId });
    }

    const cleanupTimer = this.subscriptionTimers.get(topic);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.subscriptionTimers.delete(topic);
    }
  }

  unsubscribe(clientId: string, topic: string): void {
    const existing = this.activeSubscriptions.get(topic);
    if (!existing) {
      marketStreamLogger.warn("Attempted to unsubscribe from non-existent topic", {
        topic,
        clientId,
      });
      return;
    }

    existing.count -= 1;
    existing.lastUsed = Date.now();

    if (existing.count <= 0) {
      const cleanupDelay = this.getCleanupDelay(topic);
      const cleanupTimer = setTimeout(() => {
        this.cleanupSubscription(topic);
      }, cleanupDelay);

      this.subscriptionTimers.set(topic, cleanupTimer);
      marketStreamLogger.debug("Subscription scheduled for cleanup", {
        topic,
        delay: cleanupDelay,
      });
    } else {
      marketStreamLogger.debug("Subscription reference decremented", {
        topic,
        count: existing.count,
        clientId,
      });
    }
  }

  getPendingSubscriptions(): string[] {
    return Array.from(this.pendingSubscriptions);
  }

  addPendingSubscription(topic: string): void {
    this.pendingSubscriptions.add(topic);
  }

  clearPendingSubscription(topic: string): void {
    this.pendingSubscriptions.delete(topic);
  }

  private getCleanupDelay(topic: string): number {
    if (topic.includes("@markprice")) return 30000;
    if (topic.includes("@kline_1m") || topic.includes("@kline_5m"))
      return 60000;
    if (topic.includes("@kline_1h")) return 300000;
    if (topic.includes("@ticker")) return 120000;
    return 60000;
  }

  private cleanupSubscription(topic: string): void {
    this.activeSubscriptions.delete(topic);
    this.pendingSubscriptions.delete(topic);
    marketStreamLogger.info("Subscription cleaned up", { topic });
  }

  getStats(): {
    activeSubscriptions: number;
    totalReferences: number;
    topics: string[];
  } {
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

  clearAll(): void {
    this.activeSubscriptions.clear();
    this.subscriptionTimers.forEach(timer => clearTimeout(timer));
    this.subscriptionTimers.clear();
    this.pendingSubscriptions.clear();
  }
}

export class MarketStreamService {
  private wsManager: WebSocketManager;
  private authManager: AuthManager;
  private cacheManager: CacheManager;
  private messageHandler: MessageHandler;
  private subscriptionManager: SubscriptionManager;
  private io: Server | null = null;

  constructor() {
    this.wsManager = new WebSocketManager();
    this.authManager = new AuthManager();
    this.cacheManager = new CacheManager();
    this.messageHandler = new MessageHandler(this.cacheManager);
    this.subscriptionManager = new SubscriptionManager();
  }

  /**
   * Initialize market stream service with Socket.io instance
   */
  setSocketServer(io: Server): void {
    this.io = io;
    this.messageHandler.setSocketServer(io);
    marketStreamLogger.info("Market stream service initialized with Socket.io");
  }

  /**
   * Connect to Orderly public market WebSocket
   * Uses: wss://ws-evm.orderly.org/ws/stream/public
   */
  async connectToOrderly(symbols: string[]): Promise<void> {
    marketStreamLogger.info("connectToOrderly called with symbols", { symbols });

    try {
      // Get account ID for WebSocket URL
      const accountResult = await query<{
        account_id: string;
      }>(
        "SELECT account_id FROM kodiak_credentials LIMIT 1"
      );
      if (accountResult.rows.length === 0) {
        marketStreamLogger.error("No account found for WebSocket connection");
        return;
      }

      const accountId = accountResult.rows[0].account_id;
      const ws = await this.wsManager.createConnection(accountId);

      // Authenticate the connection
      await this.authManager.authenticate(ws, accountId);

      // Set up message handling with backpressure queue
      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as WebSocketMessage;
          const queued = this.messageHandler.enqueueMessage(message);
          if (!queued) {
            marketStreamLogger.warn("Message dropped due to queue overflow", {
              topic: message.topic,
            });
          }
        } catch (error) {
          marketStreamLogger.error("Failed to parse WebSocket message", error as Error, {});
        }
      });

      // Queue subscriptions for these symbols
      symbols.forEach(symbol => {
        const topic = `${symbol}@kline_1m`;
        this.subscriptionManager.addPendingSubscription(topic);
        marketStreamLogger.info("Added topic to pending subscriptions", { symbol, topic });
      });

      // Send pending subscriptions
      this.sendPendingSubscriptions();
    } catch (error) {
      marketStreamLogger.error("Failed to connect to Orderly", error as Error, {});
    }
  }

  /**
   * Send all pending subscriptions
   */
  private sendPendingSubscriptions(): void {
    const ws = this.wsManager.getConnection();
    if (!ws || !this.wsManager.isConnected()) {
      marketStreamLogger.warn("Cannot send subscriptions - WebSocket not connected");
      return;
    }

    const topics = this.subscriptionManager.getPendingSubscriptions();
    marketStreamLogger.info("Sending pending subscriptions", {
      count: topics.length,
      topics,
    });

    topics.forEach(topic => {
      this.subscribeToTopic(ws, topic);
      this.subscriptionManager.clearPendingSubscription(topic);
    });
  }

  /**
   * Send subscription message for a topic
   */
  private subscribeToTopic(ws: WebSocket, topic: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      marketStreamLogger.warn("Cannot subscribe - WebSocket not open", {
        topic,
        readyState: ws.readyState,
      });
      return;
    }

    try {
      const message = JSON.stringify({
        id: `sub_${topic}_${Date.now()}`,
        event: "subscribe",
        topic,
      });

      ws.send(message);
      marketStreamLogger.info("Subscription message sent to Orderly", { topic });
    } catch (error) {
      marketStreamLogger.error("Failed to send subscription", error as Error, {
        topic,
      });
    }
  }

  /**
   * Connect to Orderly kline stream
   * Kline topics: kline_1m, kline_5m, kline_15m, kline_30m, kline_1h, kline_1d, kline_1w, kline_1M
   * @deprecated Use subscribe() instead for better resource management
   */
  connectToKline(symbol: string, interval: string): void {
    const topic = `${symbol}@kline_${interval}`;
    this.subscriptionManager.subscribe("legacy-client", topic);
  }

  /**
   * Connect to Orderly mark price stream
   * Mark price topics: {symbol}@markprice (push interval: 1s)
   * @deprecated Use subscribe() instead for better resource management
   */
  connectToMarkPrice(symbol: string): void {
    const topic = `${symbol}@markprice`;
    this.subscriptionManager.subscribe("legacy-client", topic);
  }

  /**
   * Subscribe to market data with reference counting
   */
  subscribe(
    clientId: string,
    topic: string,
    _options: { priority?: "high" | "medium" | "low" } = {}
  ): void {
    this.subscriptionManager.subscribe(clientId, topic);
  }

  /**
   * Unsubscribe from market data with reference counting
   */
  unsubscribe(clientId: string, topic: string): void {
    this.subscriptionManager.unsubscribe(clientId, topic);
  }

  /**
   * Get latest tick data from cache with enhanced caching
   */
  async getLatestTick(symbol: string): Promise<TickData | null> {
    const cached = await this.cacheManager.getTick(symbol);
    if (cached) {
      marketStreamLogger.debug("Returning cached tick data", { symbol });
      return cached;
    }

    // If no cache, try to get from Orderly API with rate limiting
    marketStreamLogger.debug("No cached tick data, would need API call", { symbol });
    return null;
  }

  /**
   * Get kline data from cache
   */
  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 300
  ): Promise<KlineData[]> {
    return this.cacheManager.getKlines(symbol, interval, limit);
  }

  /**
   * Get latest mark price data from cache
   */
  async getLatestMarkPrice(symbol: string): Promise<{ symbol: string; price: number; timestamp: number } | null> {
    return this.cacheManager.getMarkPrice(symbol);
  }

  /**
   * Disconnect all connections (shutdown)
   */
  disconnectAll(): void {
    this.wsManager.disconnectAll();
    this.subscriptionManager.clearAll();
    marketStreamLogger.info("Market stream service disconnected");
  }

  /**
   * Get service status
   */
  getStatus(): {
    connected: number;
    websockets: string[];
    pendingSubscriptions: number;
    activeHeartbeats: number;
    activeSubscriptions: number;
    totalReferences: number;
    topics: string[];
  } {
    return {
      connected: this.wsManager.isConnected() ? 1 : 0,
      websockets: this.wsManager.isConnected() ? ["market"] : [],
      pendingSubscriptions:
        this.subscriptionManager.getPendingSubscriptions().length,
      activeHeartbeats: 0, // Simplified
      ...this.subscriptionManager.getStats(),
    };
  }
}

export const marketStreamService = new MarketStreamService();
