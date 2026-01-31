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
    KodiakCredentials
} from '../index';

import { Balance } from './domain';

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
    findByEmailWithPassword(email: string): Promise<(User & { passwordHash: string }) | null>;

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
    updateProfile(id: string, updates: Partial<{ email: string; userLevel: UserLevel }>): Promise<User | null>;

    /**
     * Get authenticated user data with roles and credentials info
     */
    getAuthenticatedUserData(id: string): Promise<{
        user: User;
        roles: string[];
        hasCredentials: boolean;
    } | null>;
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
    getTradesByStrategy(userId: string, strategyId: string, limit?: number): Promise<Trade[]>;

    /**
     * Create a new trade record
     */
    createTrade(trade: Omit<Trade, 'id' | 'executedAt'>): Promise<Trade>;

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
    createStrategy(strategy: Omit<Strategy, 'id' | 'createdAt' | 'updatedAt'>): Promise<Strategy>;

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
// KODIAK CREDENTIALS REPOSITORY
// ===========================================

export interface IKodiakCredentialsRepository {
    /**
     * Get Kodiak credentials for a user
     */
    getCredentials(userId: string): Promise<KodiakCredentials | null>;

    /**
     * Save Kodiak credentials for a user
     */
    saveCredentials(credentials: Omit<KodiakCredentials, 'id' | 'createdAt' | 'updatedAt'>): Promise<KodiakCredentials>;

    /**
     * Update credentials verification status
     */
    updateVerificationStatus(userId: string, verified: boolean): Promise<void>;

    /**
     * Update wallet address for credentials
     */
    updateWalletAddress(userId: string, walletAddress: string): Promise<void>;

    /**
     * Delete credentials for a user
     */
    deleteCredentials(userId: string): Promise<void>;
}

// ===========================================
// BOT INSTANCE REPOSITORY
// ===========================================

export interface IBotInstanceRepository {
    /**
     * Get all bot instances for a user
     */
    getBotInstances(userId: string): Promise<any[]>;

    /**
     * Get bot instance by ID
     */
    getBotInstance(id: string): Promise<any | null>;

    /**
     * Create a new bot instance
     */
    createBotInstance(bot: Omit<any, 'id' | 'createdAt' | 'updatedAt'>): Promise<any>;

    /**
     * Update bot instance status
     */
    updateBotStatus(id: string, status: string): Promise<void>;

    /**
     * Update bot instance performance metrics
     */
    updateBotPerformance(id: string, metrics: { runningTime?: number; totalTrades?: number; totalPnL?: number }): Promise<void>;

    /**
     * Delete bot instance
     */
    deleteBotInstance(id: string): Promise<void>;

    /**
     * Get active bot instances
     */
    getActiveBotInstances(): Promise<any[]>;
}

// ===========================================
// AUDIT LOG REPOSITORY
// ===========================================

export interface IAuditLogRepository {
    /**
     * Log an audit event
     */
    logEvent(event: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void>;

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
    userId: string;
    action: string;
    details: Record<string, unknown>;
    timestamp: Date;
    ipAddress?: string;
    userAgent?: string;
}
