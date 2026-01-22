/**
 * ===========================================
 * 🌐 HTTP INTERFACES - API Routes
 * ===========================================
 *
 * Main HTTP API routes index - centralizes all domain-based route exports.
 * Provides clean API boundaries and modular architecture.
 *
 * ORGANIZATION:
 * - Domain-based routing (auth, users, trading, bots, wallet, system)
 * - Centralized exports for easy consumption
 * - Clean separation of concerns
 *
 * @format
 */

// Export domain-based route handlers
export * from './auth';
export * from './users';
export * from './trading';
export * from './bots';
export * from './wallet';
export * from './system';

// Export middleware (shared across domains)
export * from '../middleware/index';
