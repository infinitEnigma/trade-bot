/**
 * ===========================================
 * 🔗 SHARED UTILITIES & TYPES
 * ===========================================
 *
 * Common utilities, types, and validation schemas used across
 * all domains and infrastructure layers.
 *
 * RESPONSIBILITIES:
 * - TypeScript type definitions
 * - Utility functions and helpers
 * - Validation schemas and middleware
 * - Application constants
 * - Cross-cutting concerns
 *
 * @format
 */

// Export shared utilities
export * from './utils/context';

// Export shared validation
export * from './validation/database-schema-parser';
export * from './validation/schema-generator';
export * from './validation/schema-validation-middleware';

// Export shared constants (to be created)
export * from './constants/index';
