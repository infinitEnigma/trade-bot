/** @format */

import { Pool, PoolClient } from "pg";
import logger from "../services/logger";

// ✅ Singleton pattern - only one pool instance ever created
let pool: Pool | null = null;

// Pool metrics tracking
interface PoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  connectionWaitTimes: number[];
  connectionCheckoutTimes: Map<string, number>;
  totalCheckouts: number;
  totalWaits: number;
  lastMetricsUpdate: number;
}

const poolMetrics: PoolMetrics = {
  totalConnections: 0,
  idleConnections: 0,
  waitingClients: 0,
  connectionWaitTimes: [],
  connectionCheckoutTimes: new Map(),
  totalCheckouts: 0,
  totalWaits: 0,
  lastMetricsUpdate: Date.now(),
};

const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
};

/**
 * Initialize the database connection pool
 * Call this once at application startup
 */
export function initializePool(): Pool {
  if (pool) {
    logger.warn("Pool already initialized, returning existing instance");
    return pool;
  }

  pool = new Pool({
    host: getRequiredEnv("DB_HOST"),
    port: parseInt(getRequiredEnv("DB_PORT"), 10),
    database: getRequiredEnv("DB_NAME"),
    user: getRequiredEnv("DB_USER"),
    password: getRequiredEnv("DB_PASSWORD"),
    // ✅ Connection pool settings for production reliability
    max: 20, // Maximum pool size
    idleTimeoutMillis: 30000, // Idle connection timeout (30 seconds)
    connectionTimeoutMillis: 2000, // Connection timeout (2 seconds)
    application_name: "trade-bot", // Identifies connections in PostgreSQL logs
  });

  // ✅ Error event handler
  pool.on("error", err => {
    logger.error("Unexpected error on idle client", { error: err.message });
    process.exit(-1);
  });

  // ✅ Connect event handler
  pool.on("connect", client => {
    poolMetrics.totalConnections++;
    logger.info("New database connection established", {
      totalConnections: poolMetrics.totalConnections,
    });
  });

  // ✅ Connection removed from pool
  pool.on("remove", client => {
    poolMetrics.totalConnections = Math.max(
      0,
      poolMetrics.totalConnections - 1
    );
    logger.debug("Database connection removed from pool", {
      totalConnections: poolMetrics.totalConnections,
    });
  });

  logger.info("Database pool initialized");
  return pool;
}

/**
 * Get the database pool instance
 * Must call initializePool() first
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error(
      "Database pool not initialized. Call initializePool() at startup."
    );
  }
  return pool;
}

/**
 * Get a client from the pool
 * Useful for transactions or long-running queries
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return await pool.connect();
}

/**
 * Close the connection pool gracefully
 * Call this during application shutdown
 */
export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }

  logger.info("Closing database pool...");
  await pool.end();
  pool = null;
  logger.info("Database pool closed");
}

/**
 * Execute a query using the pool
 */
export async function query(
  text: string,
  params?: any[]
): Promise<{ rows: any[]; rowCount: number }> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount || 0,
  };
}

/**
 * Execute a query with timeout protection
 */
export async function queryWithTimeout(
  text: string,
  params?: any[],
  timeoutMs: number = 5000
): Promise<{ rows: any[]; rowCount: number }> {
  const pool = getPool();

  // Create a promise that rejects after timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Query timeout after ${timeoutMs}ms: ${text.substring(0, 100)}...`));
    }, timeoutMs);
  });

  // Race the query against the timeout
  try {
    const queryPromise = pool.query(text, params);
    const result = await Promise.race([queryPromise, timeoutPromise]);
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Query timeout')) {
      logger.error("Database query timeout", {
        query: text.substring(0, 200),
        timeoutMs,
        paramsCount: params?.length || 0,
      });
    }
    throw error;
  }
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get a client with metrics tracking
 */
export async function getClientWithMetrics(): Promise<PoolClient> {
  const pool = getPool();
  const startTime = Date.now();

  try {
    const client = await pool.connect();
    const waitTime = Date.now() - startTime;

    if (waitTime > 10) {
      // Log waits > 10ms
      poolMetrics.connectionWaitTimes.push(waitTime);
      poolMetrics.totalWaits++;
      logger.debug("Connection wait time", { waitTimeMs: waitTime });
    }

    const clientId = `${Date.now()}-${Math.random()}`;
    poolMetrics.connectionCheckoutTimes.set(clientId, Date.now());
    poolMetrics.totalCheckouts++;

    // Track when client is released
    const originalRelease = client.release.bind(client);
    client.release = () => {
      const checkoutTime = poolMetrics.connectionCheckoutTimes.get(clientId);
      if (checkoutTime) {
        const duration = Date.now() - checkoutTime;
        poolMetrics.connectionCheckoutTimes.delete(clientId);
        logger.debug("Connection checkout duration", { durationMs: duration });
      }
      originalRelease();
    };

    return client;
  } catch (error) {
    poolMetrics.waitingClients++;
    throw error;
  }
}

/**
 * Update pool metrics from the actual pool state
 */
function updatePoolMetrics(): void {
  if (!pool) return;

  try {
    // Get current pool stats
    poolMetrics.idleConnections = pool.idleCount;
    poolMetrics.waitingClients = pool.waitingCount;
    poolMetrics.totalConnections = pool.totalCount;
    poolMetrics.lastMetricsUpdate = Date.now();

    // Clean up old checkout times (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [
      clientId,
      checkoutTime,
    ] of poolMetrics.connectionCheckoutTimes.entries()) {
      if (checkoutTime < fiveMinutesAgo) {
        poolMetrics.connectionCheckoutTimes.delete(clientId);
      }
    }

    // Keep only last 100 wait times for memory efficiency
    if (poolMetrics.connectionWaitTimes.length > 100) {
      poolMetrics.connectionWaitTimes =
        poolMetrics.connectionWaitTimes.slice(-100);
    }
  } catch (error) {
    logger.warn("Failed to update pool metrics", {
      error: (error as Error).message,
    });
  }
}

/**
 * Get comprehensive pool metrics
 */
export function getPoolMetrics(): {
  pool: {
    totalConnections: number;
    idleConnections: number;
    activeConnections: number;
    waitingClients: number;
    utilizationPercent: number;
  };
  performance: {
    totalCheckouts: number;
    totalWaits: number;
    averageWaitTime: number;
    maxWaitTime: number;
    activeCheckouts: number;
  };
  config: {
    maxConnections: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
  };
  health: {
    status: "healthy" | "warning" | "critical";
    issues: string[];
  };
} {
  updatePoolMetrics();

  const activeConnections =
    poolMetrics.totalConnections - poolMetrics.idleConnections;
  const utilizationPercent =
    poolMetrics.totalConnections > 0
      ? Math.round((activeConnections / poolMetrics.totalConnections) * 100)
      : 0;

  const averageWaitTime =
    poolMetrics.connectionWaitTimes.length > 0
      ? Math.round(
        poolMetrics.connectionWaitTimes.reduce((a, b) => a + b, 0) /
        poolMetrics.connectionWaitTimes.length
      )
      : 0;

  const maxWaitTime =
    poolMetrics.connectionWaitTimes.length > 0
      ? Math.max(...poolMetrics.connectionWaitTimes)
      : 0;

  const issues: string[] = [];
  let status: "healthy" | "warning" | "critical" = "healthy";

  if (utilizationPercent > 95) {
    issues.push(`Pool utilization is ${utilizationPercent}% (critical - ${activeConnections}/${poolMetrics.totalConnections} connections)`);
    status = "critical";
    logger.error("CRITICAL: Database connection pool nearly exhausted", {
      utilizationPercent,
      activeConnections,
      totalConnections: poolMetrics.totalConnections,
      waitingClients: poolMetrics.waitingClients,
    });
  } else if (utilizationPercent > 80) {
    issues.push(`Pool utilization is ${utilizationPercent}% (warning - ${activeConnections}/${poolMetrics.totalConnections} connections)`);
    status = "warning";
    logger.warn("WARNING: Database connection pool usage high", {
      utilizationPercent,
      activeConnections,
      totalConnections: poolMetrics.totalConnections,
      waitingClients: poolMetrics.waitingClients,
    });
  }

  if (poolMetrics.waitingClients > 5) {
    issues.push(
      `${poolMetrics.waitingClients} clients waiting for connections`
    );
    status = status === "healthy" ? "warning" : status;
  }

  if (averageWaitTime > 1000) {
    issues.push(`Average connection wait time is ${averageWaitTime}ms`);
    status = status === "healthy" ? "warning" : status;
  }

  return {
    pool: {
      totalConnections: poolMetrics.totalConnections,
      idleConnections: poolMetrics.idleConnections,
      activeConnections,
      waitingClients: poolMetrics.waitingClients,
      utilizationPercent,
    },
    performance: {
      totalCheckouts: poolMetrics.totalCheckouts,
      totalWaits: poolMetrics.totalWaits,
      averageWaitTime,
      maxWaitTime,
      activeCheckouts: poolMetrics.connectionCheckoutTimes.size,
    },
    config: {
      maxConnections: 20,
      idleTimeoutMs: 30000,
      connectionTimeoutMs: 2000,
    },
    health: {
      status,
      issues,
    },
  };
}

// Update metrics every 30 seconds
setInterval(updatePoolMetrics, 30000);
