/** @format */

/**
 * Migration status report: compares database/migrations/*.sql against the
 * `schema_migrations` ledger and prints which files are applied, baselined
 * or pending. Run via `npm run db:status`.
 */

import fs from "fs";
import path from "path";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "database", "migrations");
const LEDGER_TABLE = "schema_migrations";

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "trade_bot",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
  });

  try {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith(".sql"))
      .sort();

    // The runner creates the ledger on first run; create it here too so the
    // report works on a database that has never been migrated with a ledger.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await pool.query(`SELECT filename, applied_at FROM ${LEDGER_TABLE}`);
    const applied = new Map<string, Date>(
      appliedResult.rows.map(row => [row.filename as string, new Date(row.applied_at as string)])
    );

    // Pre-ledger baseline notice: ledger empty but core schema present.
    if (applied.size === 0) {
      const core = await pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS exists`);
      if (core.rows[0].exists) {
        console.log("⚠️  Ledger is empty but the core schema exists.");
        console.log("   Run `npm run db:migrate:files` once to baseline the ledger");
        console.log("   (all current migrations will be marked applied, not re-executed).\n");
      }
    }

    console.log("Migration status:");
    console.log("-".repeat(64));
    let pendingCount = 0;
    for (const file of files) {
      const appliedAt = applied.get(file);
      if (appliedAt) {
        console.log(`  ✔ ${file.padEnd(38)} applied ${appliedAt.toISOString()}`);
      } else {
        console.log(`  ✗ ${file.padEnd(38)} PENDING`);
        pendingCount++;
      }
    }
    console.log("-".repeat(64));
    console.log(`  ${files.length} migration files, ${files.length - pendingCount} applied, ${pendingCount} pending`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("Migration status failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});