/** @format */

import { Pool, PoolClient } from 'pg';
import logger from '../services/logger';

// ✅ Singleton pattern - only one pool instance ever created
let pool: Pool | null = null;

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
    logger.warn('Pool already initialized, returning existing instance');
    return pool;
  }

  pool = new Pool({
    host: getRequiredEnv('DB_HOST'),
    port: parseInt(getRequiredEnv('DB_PORT'), 10),
    database: getRequiredEnv('DB_NAME'),
    user: getRequiredEnv('DB_USER'),
    password: getRequiredEnv('DB_PASSWORD'),
    // ✅ Connection pool settings for production reliability
    max: 20,                          // Maximum pool size
    idleTimeoutMillis: 30000,         // Idle connection timeout (30 seconds)
    connectionTimeoutMillis: 2000,    // Connection timeout (2 seconds)
    application_name: 'trade-bot',    // Identifies connections in PostgreSQL logs
  });

  // ✅ Error event handler
  pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', { error: err.message });
    process.exit(-1);
  });

  // ✅ Connect event handler
  pool.on('connect', () => {
    logger.info('New database connection established');
  });

  logger.info('Database pool initialized');
  return pool;
}

/**
 * Get the database pool instance
 * Must call initializePool() first
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error(
      'Database pool not initialized. Call initializePool() at startup.'
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

  logger.info('Closing database pool...');
  await pool.end();
  pool = null;
  logger.info('Database pool closed');
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
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
