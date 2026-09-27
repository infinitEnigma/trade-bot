/** @format */

/**
 * Drop every application table in the `public` schema — including the
 * `schema_migrations` ledger, so a following `npm run db:migrate:files`
 * replays the full history from 001 (that is what `npm run db:reset`
 * = `db:drop` + `db:migrate:files` expects).
 *
 * Run via `npm run db:drop`. Pass `--dry-run` to print the table list
 * without dropping anything.
 *
 * ⚠️ DESTRUCTIVE: deletes all data (users, bots, trades, accounts,
 *    snapshots). The C3b legacy `kodiak_*` tables are simply part of
 *    "everything" here — they exist only in migration history since 014.
 */

import path from "path";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "trade_bot",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
  });

  try {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    const tables = result.rows.map(row => row.table_name);

    if (tables.length === 0) {
      console.log("🗑️  No tables to drop.");
      return;
    }

    if (dryRun) {
      console.log(`DRY RUN — would drop ${tables.length} tables:`);
      for (const table of tables) console.log(`   - ${table}`);
      return;
    }

    // One statement for the whole set: intra-set FK dependencies (cycles
    // included) are legal when every table is listed together; CASCADE
    // clears dependents such as views outside the set.
    const list = tables.map(table => `public."${table}"`).join(", ");
    await pool.query(`DROP TABLE ${list} CASCADE`);

    console.log(`🗑️  Dropped ${tables.length} tables:`);
    for (const table of tables) console.log(`   - ${table}`);
    console.log("\nRun `npm run db:migrate:files` to rebuild the schema.");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("❌ drop-tables failed:", error);
  process.exit(1);
});