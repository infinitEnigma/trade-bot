/** @format */

/**
 * Database health probe (review P3 Phase 2).
 *
 * The `database/`-owned implementation of the `HealthDbPort` consumed by
 * `interfaces/http/system/health.ts` — routes must not import the pool
 * directly, so the `pg_stat_activity` SQL and the `SELECT 1` ping live here,
 * beside `getPool`/`getPoolMetrics`. Wired in `server/route-config.ts` via
 * `setHealthDb(databaseHealth)`.
 */
import { getPool, getPoolMetrics } from "./pool";

/** `pg_stat_activity` aggregate counts (pg driver returns count(*) as text). */
export interface ConnectionStats {
  total_connections: string;
  active_connections: string;
  idle_connections: string;
}

export const databaseHealth = {
  /** SELECT 1 connectivity probe (readiness + database health). */
  async ping(): Promise<void> {
    await getPool().query("SELECT 1");
  },

  /** Connection counts for /health/database. */
  async connectionStats(): Promise<ConnectionStats> {
    const result = await getPool().query<ConnectionStats>(`
      SELECT
        count(*) as total_connections,
        count(*) filter (where state = 'active') as active_connections,
        count(*) filter (where state = 'idle') as idle_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);
    return result.rows[0];
  },

  /** Pool metrics snapshot for /metrics/database (delegates to getPoolMetrics). */
  metrics(): ReturnType<typeof getPoolMetrics> {
    return getPoolMetrics();
  },
};
