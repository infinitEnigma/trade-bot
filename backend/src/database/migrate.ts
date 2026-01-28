/** @format */

import { Pool } from "pg";
import { logger } from "../core/logging";
import { DatabaseSchemaParser } from "../shared/validation/database-schema-parser";
import { SchemaGenerator } from "../shared/validation/schema-generator";
import { getSchemaValidationMiddleware } from "../shared/validation/schema-validation-middleware";

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

/**
 * Initialize schema validation middleware after database is ready
 * This replaces the old migration logic that was causing conflicts
 */
async function initializeSchemaValidation() {
  logger.info("Initializing schema validation middleware...");

  try {
    // Initialize the schema validation middleware
    const schemaValidationMiddleware = getSchemaValidationMiddleware();

    // Wait for schema to be loaded
    if (!schemaValidationMiddleware.isInitialized()) {
      logger.info("Schema validation middleware not yet initialized, waiting...");
      // The middleware initializes itself asynchronously, so we just log the status
    }

    const stats = schemaValidationMiddleware.getSchemaStats();
    logger.info("Schema validation middleware initialization completed", {
      initialized: stats.initialized,
      tablesValidated: stats.tablesValidated,
      totalTables: stats.totalTables,
      relationships: stats.relationships,
    });

  } catch (error) {
    logger.error("Schema validation middleware initialization failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await pool.end();
  }
}

// Only initialize schema validation, not run migrations
// Migrations are handled by scripts/run-migrations.js
initializeSchemaValidation().catch(error => {
  logger.error("Failed to initialize schema validation", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});