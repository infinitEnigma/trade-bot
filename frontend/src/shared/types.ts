/** @format */

// UserRole enum for frontend use
export enum UserRole {
    QUALIFIED_ALPHA = "QUALIFIED_ALPHA",
}

// UserLevel enum for frontend use
export enum UserLevel {
    BASIC = "BASIC",
    REGISTERED = "REGISTERED",
    VERIFIED = "VERIFIED",
}

// User interface for frontend use
export interface User {
    id: string;
    email: string;
    userLevel: UserLevel;
    roles?: UserRole[];
    createdAt: Date;
    updatedAt: Date;
}

// Balance class for frontend use
export class Balance {
    constructor(
        public total: number,
        public available: number,
        public locked: number,
        public currency: string,
        public lastUpdated: Date
    ) { }

    static zero(currency: string = 'USD'): Balance {
        return new Balance(0, 0, 0, currency, new Date());
    }

    static fromTotal(total: number, currency: string = 'USD'): Balance {
        return new Balance(total, total, 0, currency, new Date());
    }

    canWithdraw(amount: number): boolean {
        return this.available >= amount && amount > 0;
    }

    isValid(): boolean {
        return (
            this.total >= 0 &&
            this.available >= 0 &&
            this.locked >= 0 &&
            this.total >= this.available + this.locked &&
            this.currency.length > 0
        );
    }

    getUtilizationPercentage(): number {
        return this.total > 0 ? (this.locked / this.total) * 100 : 0;
    }

    lock(amount: number): Balance {
        if (!this.canWithdraw(amount)) {
            throw new Error('Insufficient available balance');
        }

        return new Balance(
            this.total,
            this.available - amount,
            this.locked + amount,
            this.currency,
            new Date()
        );
    }

    unlock(amount: number): Balance {
        if (this.locked < amount) {
            throw new Error('Insufficient locked balance');
        }

        return new Balance(
            this.total,
            this.available + amount,
            this.locked - amount,
            this.currency,
            new Date()
        );
    }

    add(amount: number): Balance {
        return new Balance(
            this.total + amount,
            this.available + amount,
            this.locked,
            this.currency,
            new Date()
        );
    }

    subtract(amount: number): Balance {
        if (this.available < amount) {
            throw new Error('Insufficient available balance');
        }

        return new Balance(
            this.total - amount,
            this.available - amount,
            this.locked,
            this.currency,
            new Date()
        );
    }

    isZero(): boolean {
        return this.total === 0;
    }

    isPositive(): boolean {
        return this.total > 0;
    }
}

// StrategyType enum for frontend use
export enum StrategyType {
    GRID = "GRID",
    TREND_FOLLOWING = "TREND_FOLLOWING",
    ARBITRAGE = "ARBITRAGE"
}

// Strategy class for frontend use
export class Strategy {
    constructor(
        public id: string,
        public userId: string,
        public name: string,
        public type: StrategyType,
        public symbol: string,
        public config: StrategyConfig,
        public active: boolean = false
    ) { }

    isTradable(currentPrice: number): boolean {
        return currentPrice > 0;
    }

    getRiskLevel(): 'LOW' | 'MEDIUM' | 'HIGH' {
        const leverage = this.config.leverage || 1;
        if (leverage <= 2) return 'LOW';
        if (leverage <= 5) return 'MEDIUM';
        return 'HIGH';
    }

    isValid(): boolean {
        return (
            this.id.length > 0 &&
            this.userId.length > 0 &&
            this.name.length > 0 &&
            this.symbol.length > 0 &&
            this.isValidConfig()
        );
    }

    private isValidConfig(): boolean {
        const config = this.config;

        if (config.leverage && config.leverage <= 0) return false;
        if (config.orderQuantity && config.orderQuantity <= 0) return false;

        switch (this.type) {
            case StrategyType.GRID:
                return !!(config.gridSize && config.gridRange);
            case StrategyType.TREND_FOLLOWING:
                return !!(config.entryThreshold && config.exitThreshold);
            case StrategyType.ARBITRAGE:
                return true;
            default:
                return false;
        }
    }
}

// StrategyConfig interface for frontend use
export interface StrategyConfig {
    leverage?: number;
    gridSize?: number;
    gridRange?: number;
    orderQuantity?: number;
    takeProfit?: number;
    entryThreshold?: number;
    exitThreshold?: number;
    stopLoss?: number;
}

// Re-export from monorepo shared package for consistency
export type { UserRole as SharedUserRole, UserLevel as SharedUserLevel, User as SharedUser, StrategyType as SharedStrategyType, Strategy as SharedStrategy, StrategyConfig as SharedStrategyConfig } from "@trade-bot/shared";
