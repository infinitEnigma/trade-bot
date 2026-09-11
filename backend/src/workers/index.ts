/**
 * ===========================================
 * ⚙️ WORKERS - Background Processing
 * ===========================================
 *
 * Background workers and job processors for the Trade Bot platform.
 * Handles CPU-intensive operations and scheduled tasks.
 *
 * RESPONSIBILITIES:
 * - Password hashing (non-blocking CPU operations)
 * - Bot reconciliation and background processing
 * - Scheduled maintenance tasks
 * - Asynchronous job processing
 *
 * @format
 */

// Export worker modules
export { hashPassword, comparePassword } from './password-worker';
export { botReconciliationWorker } from './bot-reconciliation';
