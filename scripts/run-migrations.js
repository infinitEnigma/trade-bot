#!/usr/bin/env node

/**
 * Database Migration Runner
 * Executes SQL migration files in order
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');

/**
 * Split a SQL file into individual statements, respecting single/double
 * quotes, dollar-quoted blocks, and line/block comments, so that
 * CREATE INDEX CONCURRENTLY (which cannot run inside a multi-statement
 * implicit transaction) executes standalone.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : '';

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') { current += next; i++; inBlockComment = false; }
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (next === "'") { current += next; i++; } // escaped quote
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { current += dollarTag; i += dollarTag.length - 1; dollarTag = null; }
      else current += ch;
      continue;
    }
    if (ch === '-' && next === '-') { inLineComment = true; current += ch; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; current += ch; continue; }
    if (ch === "'") { inSingle = true; current += ch; continue; }
    if (ch === '"') { inDouble = true; current += ch; continue; }
    if (ch === '$') {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (match) { dollarTag = match[0]; current += dollarTag; i += dollarTag.length - 1; continue; }
    }
    if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());

  // Drop statements that are pure comments/whitespace
  return statements.filter(s => !/^(?:\s|--[^\n]*|\/\*[\s\S]*?\*\/)*$/.test(s));
}

async function runMigrations() {
  console.log('🚀 Starting database migrations...');

  // Create database connection
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trade_bot',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection established');

    // Get migration files
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort alphabetically (001_, 002_, etc.)

    if (migrationFiles.length === 0) {
      console.log('❌ No migration files found');
      return;
    }

    console.log(`📁 Found ${migrationFiles.length} migration files:`);
    migrationFiles.forEach(file => console.log(`   - ${file}`));

    // Migration ledger: skip files already applied to this database.
    const force = process.argv.includes('--force') || process.env.FORCE_MIGRATIONS === '1';
    await ensureLedger(pool);
    const applied = await getAppliedMigrations(pool);
    const baselined = await baselineLedgerIfNeeded(pool, migrationFiles, applied);
    const appliedSet = new Set(applied.concat(baselined));

    let pending = selectPendingFiles(migrationFiles, [...appliedSet]);
    if (force) {
      console.log('♻️  --force / FORCE_MIGRATIONS=1: re-executing all migration files (ledger ignored)');
      pending = migrationFiles;
    } else {
      const skipped = migrationFiles.length - pending.length;
      if (skipped > 0) {
        console.log(`⏭️  Skipping ${skipped} already-applied migrations (tracked in ${LEDGER_TABLE})`);
      }
    }

    if (pending.length === 0) {
      console.log('\n🎉 Nothing to do - database schema is up to date.');
      return;
    }

    // Execute pending migrations in order
    for (const file of pending) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      console.log(`\n🔄 Executing migration: ${file}`);

      const sql = fs.readFileSync(filePath, 'utf8');
      const statements = splitStatements(sql);

      if (statements.length === 0) {
        console.log(`   ⚠️  No executable statements found, skipping`);
        await recordApplied(pool, file);
        continue;
      }

      for (let i = 0; i < statements.length; i++) {
        try {
          await pool.query(statements[i]);
        } catch (error) {
          // Only tolerate genuine idempotency duplicates ("already exists",
          // seed-row "duplicate key"). Everything else - including
          // "does not exist" - is a real failure and must abort the run.
          if (error.message.includes('already exists') ||
              error.message.includes('duplicate key value')) {
            console.log(`   ⚠️  Statement ${i + 1}/${statements.length} skipped (already applied): ${error.message.split('\n')[0]}`);
          } else {
            console.error(`   ❌ Statement ${i + 1}/${statements.length} failed:`, error.message);
            console.error(`      Statement: ${statements[i].split('\n')[0]}`);
            throw error;
          }
        }
      }

      // Record in the ledger only after the whole file succeeded.
      await recordApplied(pool, file);
      console.log(`✅ Migration ${file} completed successfully`);
    }

    console.log(`\n🎉 All migrations completed successfully! (applied: ${pending.length}, ledger-tracked: ${migrationFiles.length - pending.length})`);
    console.log('\n📊 Database schema ready. You can now:');
    console.log('   - Start the server: npm run dev');
    console.log('   - Register users and connect Kodiak accounts');
    console.log('   - Create trading strategies and start bots');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations if called directly
const LEDGER_TABLE = 'schema_migrations';

/**
 * Pure decision: should the ledger be baselined (all current files marked
 * applied without executing)? True when the ledger has no rows but the
 * database already has the core schema (pre-ledger deployment). A fresh
 * empty database must run every migration for real.
 */
function needsBaseline(appliedCount, hasCoreSchema) {
  return appliedCount === 0 && hasCoreSchema;
}

/** Pure helper: which migration files still need to be applied? */
function selectPendingFiles(files, appliedFilenames) {
  const applied = new Set(appliedFilenames);
  return files.filter(file => !applied.has(file));
}

async function ensureLedger(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(pool) {
  const result = await pool.query(`SELECT filename FROM ${LEDGER_TABLE}`);
  return result.rows.map(row => row.filename);
}

async function recordApplied(pool, filename) {
  await pool.query(
    `INSERT INTO ${LEDGER_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
    [filename]
  );
}

/**
 * Pre-ledger baseline: if the ledger is empty but the database already has
 * the core schema, mark every current migration file as applied so a legacy
 * deployment is not re-executed. Returns the list of baselined files.
 */
async function baselineLedgerIfNeeded(pool, migrationFiles, applied) {
  if (applied.length > 0) {
    return [];
  }
  const coreSchema = await pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS exists`);
  if (!needsBaseline(applied.length, coreSchema.rows[0].exists)) {
    return [];
  }
  for (const file of migrationFiles) {
    await recordApplied(pool, file);
  }
  console.log(`📓 Ledger baseline: ${migrationFiles.length} migrations marked as applied (pre-ledger schema detected)`);
  return migrationFiles;
}

// Run migrations if called directly
if (require.main === module) {
  runMigrations().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runMigrations, splitStatements, needsBaseline, selectPendingFiles };
