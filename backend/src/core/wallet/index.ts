/**
 * ===========================================
 * 💰 WALLET DOMAIN - Wallet & Balance Management
 * ===========================================
 *
 * Core business logic for wallet operations, balance management,
 * and financial data processing.
 *
 * RESPONSIBILITIES:
 * - Wallet balance tracking and updates
 * - Financial transaction processing
 * - Wallet qualification and validation
 * - Balance synchronization with exchanges
 *
 * @format
 */

// Export wallet-related services
export { selectBalanceService } from "../service-selector";
export { WalletQualificationService, createWalletQualificationService } from './wallet-qualification.service.pure';

// Export types
export type { QualificationResult, QualificationStatus, WalletRequirements, WalletQualificationServiceDependencies } from './wallet-qualification.service.pure';
