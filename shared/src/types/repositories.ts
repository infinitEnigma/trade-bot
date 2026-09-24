/**
 * Repository Interfaces - Data Access Contracts
 *
 * Defines interfaces for data access patterns used by core business logic.
 * These interfaces abstract database operations behind repository patterns,
 * enabling core services to work with domain objects without knowing
 * about underlying data storage mechanisms.
 *
 * @format
 */

import {
  User,
  UserLevel,
  UserRegistration,
  Position,
  Trade,
  OrderStatus as TradeStatus,
  Strategy,
  StrategyConfig,
} from "../index";
import { Balance } from "./domain";
import type {
  ChainKind,
  ConnectExchangeAccountRequest,
  ExchangeAccount,
  ExchangeAccountStatus,
  LinkWalletRequest,
  Wallet,
} from "./accounts";

// ===========================================
// USER REPOSITORY
// ===========================================

export interface IUserRepository {
  /**
   * Find user by email address
   */
  findByEmail(email: string): Promise<User | null>;

  /**
   * Find user by email with password hash for authentication
   */
  findByEmailWithPassword(
    email: string
  ): Promise<(User & { passwordHash: string }) | null>;

  /**
   * Find user by username handle (case-insensitive; the unique index is on
   * LOWER(username)) — registration uniqueness checks, C1 identity redesign.
   */
  findByUsername(username: string): Promise<User | null>;

  /**
   * Find user by ID
   */
  findById(id: string): Promise<User | null>;

  /**
   * Create a new user
   */
  create(user: UserRegistration): Promise<User>;

  /**
   * Update user's level (BASIC, REGISTERED, VERIFIED)
   */
  updateUserLevel(id: string, level: UserLevel): Promise<boolean>;

  /**
   * Update user profile information
   */
  updateProfile(
    id: string,
    updates: Partial<{ email: string; userLevel: UserLevel }>
  ): Promise<User | null>;

  /**
   * Mirror the user's current email into user_identities (provider='email').
   *
   * C1 bookkeeping: login keeps reading users.email; this keeps the identity
   * model truthful so later phases can resolve logins via identities. Also
   * supersedes any stale email-identity rows this user owned from earlier
   * addresses (single statement: delete own rows, insert current).
   */
  upsertEmailIdentity(userId: string, email: string): Promise<void>;

  /**
   * Get authenticated user data with roles and credentials info
   */
  getAuthenticatedUserData(id: string): Promise<{
    user: User;
    roles: string[];
    hasCredentials: boolean;
    kodiakAccountId?: string;
    kodiakVerified?: boolean;
    /** Primary wallet (C2 multi-wallet model); null when none linked. */
    primaryWallet?: Wallet | null;
    /** All verified exchange accounts (C2); empty when none. */
    exchangeAccounts?: ExchangeAccount[];
  } | null>;

  /**
   * Get user's linked wallet address
   *
   * @deprecated C2 keeps this as a primary-wallet convenience while the
   * multi-wallet `IWalletRepository` below is the source of truth.
   */
  getWalletAddress(userId: string): Promise<string | null>;

  /**
   * Link a wallet address to a user (upsert)
   *
   * @deprecated Use `IWalletRepository.upsertVerified` (multi-wallet).
   */
  setWalletAddress(userId: string, walletAddress: string): Promise<boolean>;

  /**
   * Remove the wallet linked to a user
   *
   * @deprecated Use `IWalletRepository.remove` (per-wallet unlink).
   */
  clearWalletAddress(userId: string): Promise<boolean>;
}

// ===========================================
// WALLET REPOSITORY (C2 — chain-aware, many per user)
// ===========================================

export interface IWalletRepository {
  /** All wallets for a user, primary first. */
  listWallets(userId: string): Promise<Wallet[]>;

  /** The user's primary wallet, if any. */
  getPrimaryWallet(userId: string): Promise<Wallet | null>;

  /**
   * Insert or re-verify a wallet. The first verified wallet for a user
   * becomes primary; later wallets are secondary unless `makePrimary`.
   */
  upsertVerified(
    userId: string,
    wallet: Pick<LinkWalletRequest, "chain" | "address" | "label"> & {
      makePrimary?: boolean;
    }
  ): Promise<Wallet>;

  /** Mark one of the user's wallets as primary. */
  setPrimary(userId: string, walletId: string): Promise<boolean>;

  /** Remove a single wallet (explicit, audited unlink). */
  remove(userId: string, walletId: string): Promise<boolean>;

  /** How many verified wallets does the user hold (level computation). */
  countVerified(userId: string): Promise<number>;
}

// ===========================================
// EXCHANGE ACCOUNT REPOSITORY (C2 — generic venue/environment)
// ===========================================

export interface ExchangeAccountWithSecret extends ExchangeAccount {
  /** Versioned single-envelope ciphertext (Q1 decision). */
  credentialsEncrypted: string;
  encryptionVersion: number | null;
}

export interface IExchangeAccountRepository {
  /** All accounts for a user (metadata only — never secrets). */
  listAccounts(userId: string): Promise<ExchangeAccount[]>;

  /** One account with its ciphertext (verify / engine-issue paths only). */
  getAccountWithSecret(
    userId: string,
    accountId: string
  ): Promise<ExchangeAccountWithSecret | null>;

  /**
   * Create a PENDING account. Caller encrypts `credentials` into
   * `credentialsEncrypted` first — the repository never sees plaintext.
   */
  createPending(input: {
    userId: string;
    request: ConnectExchangeAccountRequest;
    credentialsEncrypted: string;
    encryptionVersion: number | null;
    chain?: ChainKind;
  }): Promise<ExchangeAccount>;

  /** Transition status; ACTIVE stamps verified_at/last_verified_at. */
  setStatus(
    userId: string,
    accountId: string,
    status: ExchangeAccountStatus,
    verified: boolean
  ): Promise<boolean>;

  /**
   * Rewrite the envelope after a successful verify (backfilled
   * `kodiak-legacy` wrappers graduate to full single-envelope rows here).
   */
  rewriteEnvelope(
    userId: string,
    accountId: string,
    credentialsEncrypted: string,
    encryptionVersion: number | null
  ): Promise<boolean>;

  /** Hard-delete one account (explicit, audited disconnect). */
  deleteAccount(userId: string, accountId: string): Promise<boolean>;

  /** How many ACTIVE accounts does the user hold (level computation). */
  countActive(userId: string): Promise<number>;
}

// ===========================================
// BALANCE REPOSITORY
// ===========================================

export interface IBalanceRepository {
  /**
   * Get user's current balance
   */
  getBalance(userId: string): Promise<Balance>;

  /**
   * Update user's balance
   */
  updateBalance(userId: string, balance: Balance): Promise<void>;

  /**
   * Get balance history for a user
   */
  getBalanceHistory(userId: string, limit?: number): Promise<BalanceHistory[]>;
}

// ===========================================
// POSITION REPOSITORY
// ===========================================

export interface IPositionRepository {
  /**
   * Get all positions for a user
   */
  getPositions(userId: string): Promise<Position[]>;

  /**
   * Get position by symbol for a user
   */
  getPosition(userId: string, symbol: string): Promise<Position | null>;

  /**
   * Update position data
   */
  updatePosition(userId: string, position: Position): Promise<void>;

  /**
   * Close position for a user
   */
  closePosition(userId: string, symbol: string): Promise<void>;
}

// ===========================================
// TRADE REPOSITORY
// ===========================================

export interface ITradeRepository {
  /**
   * Get trades for a user
   */
  getTrades(userId: string, limit?: number): Promise<Trade[]>;

  /**
   * Get trades for a specific strategy
   */
  getTradesByStrategy(
    userId: string,
    strategyId: string,
    limit?: number
  ): Promise<Trade[]>;

  /**
   * Create a new trade record
   */
  createTrade(trade: Omit<Trade, "id" | "executedAt">): Promise<Trade>;

  /**
   * Update trade status
   */
  updateTradeStatus(tradeId: string, status: TradeStatus): Promise<void>;
}

// ===========================================
// STRATEGY REPOSITORY
// ===========================================

export interface IStrategyRepository {
  /**
   * Get all strategies for a user
   */
  getStrategies(userId: string): Promise<Strategy[]>;

  /**
   * Get strategy by ID
   */
  getStrategy(id: string): Promise<Strategy | null>;

  /**
   * Create a new strategy
   */
  createStrategy(
    strategy: Omit<Strategy, "id" | "createdAt" | "updatedAt">
  ): Promise<Strategy>;

  /**
   * Update strategy configuration
   */
  updateStrategy(id: string, updates: Partial<StrategyConfig>): Promise<void>;

  /**
   * Delete strategy
   */
  deleteStrategy(id: string): Promise<void>;

  /**
   * Toggle strategy active status
   */
  toggleStrategy(id: string, active: boolean): Promise<void>;
}

// ===========================================
// BOT INSTANCE REPOSITORY
// ===========================================

/**
 * Raw `bot_instances` row (snake_case DB columns) as returned by the
 * repository layer. The `strategy_*` fields are populated by the list/detail
 * queries, which join the `strategies` table.
 */
export interface BotInstanceRecord {
  id: string;
  strategy_id: string;
  user_id: string;
  status: string;
  running_time: number;
  total_trades: number;
  total_pnl: number;
  created_at: Date;
  updated_at: Date;
  /** Canonical lifecycle states; present on `SELECT *` row reads. */
  desired_state?: string;
  actual_state?: string;
  /** Id of the engine currently owning the instance (may be null). */
  engine_id?: string | null;
  /** Joined from `strategies.name` (list/detail queries only). */
  strategy_name?: string;
  /** Joined from `strategies.type` (list/detail queries only). */
  strategy_type?: string;
  /** Joined from `strategies.config` (list/detail queries only). */
  strategy_config?: Record<string, unknown>;
}

export interface IBotInstanceRepository {
  /**
   * Get all bot instances for a user
   */
  getBotInstances(userId: string): Promise<BotInstanceRecord[]>;

  /**
   * Get bot instance by ID
   */
  getBotInstance(id: string): Promise<BotInstanceRecord | null>;

  /**
   * Create a new bot instance
   */
  createBotInstance(
    bot: Omit<BotInstanceRecord, "created_at" | "updated_at">
  ): Promise<BotInstanceRecord>;

  /**
   * Update bot instance status
   */
  updateBotStatus(id: string, status: string): Promise<void>;

  /**
   * Update bot instance performance metrics
   */
  updateBotPerformance(
    id: string,
    metrics: { runningTime?: number; totalTrades?: number; totalPnL?: number }
  ): Promise<void>;

  /**
   * Delete bot instance
   */
  deleteBotInstance(id: string): Promise<void>;

  /**
   * Get active bot instances
   */
  getActiveBotInstances(): Promise<BotInstanceRecord[]>;
}

// ===========================================
// AUDIT LOG REPOSITORY
// ===========================================

export interface IAuditLogRepository {
  /**
   * Log an audit event
   */
  logEvent(event: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void>;

  /**
   * Get audit logs for a user
   */
  getUserLogs(userId: string, limit?: number): Promise<AuditLogEntry[]>;
}

// ===========================================
// ADDITIONAL DOMAIN TYPES (Specific to repositories)
// ===========================================

// Additional domain types for repositories
export interface BalanceHistory {
  id: string;
  userId: string;
  balance: Balance;
  changeReason: string;
  changeAmount: number;
  timestamp: Date;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  details: Record<string, unknown>;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}
