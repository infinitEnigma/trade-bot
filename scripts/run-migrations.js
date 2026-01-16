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

    // Execute migrations in order
    for (const file of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      console.log(`\n🔄 Executing migration: ${file}`);

      const sql = fs.readFileSync(filePath, 'utf8');

      // Split by migration separator and execute each part
      const migrations = sql.split('-- Migration completed successfully');

      for (let i = 0; i < migrations.length - 1; i++) { // Last element is empty
        const migration = migrations[i].trim();
        if (migration) {
          try {
            await pool.query(migration);
            console.log(`   ✅ Migration part ${i + 1} executed successfully`);
          } catch (error) {
            console.error(`   ❌ Migration part ${i + 1} failed:`, error.message);
            throw error;
          }
        }
      }

      console.log(`✅ Migration ${file} completed successfully`);
    }

    console.log('\n🎉 All migrations completed successfully!');
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
if (require.main === module) {
  runMigrations().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runMigrations };
