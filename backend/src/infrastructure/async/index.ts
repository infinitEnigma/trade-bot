/**
 * ===========================================
 * 🔄 ASYNC INFRASTRUCTURE - Background Operations
 * ===========================================
 *
 * Infrastructure for managing background jobs and async operations
 * with proper context propagation and lifecycle management.
 *
 * RESPONSIBILITIES:
 * - Background job queuing and execution
 * - Context preservation across async boundaries
 * - Async operation lifecycle management
 * - Job scheduling and monitoring
 *
 * @format
 */

// Export async operation manager
export { getAsyncOperationManager, executeAsync, submitBackgroundJob, createContextLogger } from './async-operation-manager.service';
