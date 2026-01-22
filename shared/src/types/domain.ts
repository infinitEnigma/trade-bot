/**
 * Domain Models - Rich Business Objects
 *
 * Defines domain entities with rich behavior and business rules.
 * These models encapsulate data and behavior while maintaining
 * shared package discipline (no external dependencies or side effects).
 *
 * Domain models can contain:
 * ✅ Data structures with validation
 * ✅ Pure business logic methods
 * ✅ Value object operations
 * ✅ Basic calculations and transformations
 *
 * Domain models cannot contain:
 * ❌ External API calls
 * ❌ Database operations
 * ❌ Side effects
 * ❌ Complex business workflows
 *
 * @format
 */

// ===========================================
// BALANCE DOMAIN MODEL
// ===========================================

export class Balance {
    constructor(
        public total: number,
        public available: number,
        public locked: number,
        public currency: string,
        public lastUpdated: Date
    ) {
        this.validate();
    }

    /**
     * Create a zero balance for a currency
     */
    static zero(currency: string = 'USD'): Balance {
        return new Balance(0, 0, 0, currency, new Date());
    }

    /**
     * Create balance from total amount (all available)
     */
    static fromTotal(total: number, currency: string = 'USD'): Balance {
        return new Balance(total, total, 0, currency, new Date());
    }

    /**
     * Check if withdrawal is possible
     */
    canWithdraw(amount: number): boolean {
        return this.available >= amount && amount > 0;
    }

    /**
     * Check if balance is valid
     */
    isValid(): boolean {
        return (
            this.total >= 0 &&
            this.available >= 0 &&
            this.locked >= 0 &&
            this.total >= this.available + this.locked &&
            this.currency.length > 0
        );
    }

    /**
     * Get utilization percentage (locked/total)
     */
    getUtilizationPercentage(): number {
        return this.total > 0 ? (this.locked / this.total) * 100 : 0;
    }

    /**
     * Lock funds for a trade/order
     */
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

    /**
     * Unlock previously locked funds
     */
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

    /**
     * Add funds to balance
     */
    add(amount: number): Balance {
        return new Balance(
            this.total + amount,
            this.available + amount,
            this.locked,
            this.currency,
            new Date()
        );
    }

    /**
     * Subtract funds from balance
     */
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

    /**
     * Check if balance is zero
     */
    isZero(): boolean {
        return this.total === 0;
    }

    /**
     * Check if balance is positive
     */
    isPositive(): boolean {
        return this.total > 0;
    }

    private validate(): void {
        if (!this.isValid()) {
            throw new Error('Invalid balance state');
        }
    }
}

// ===========================================
// POSITION DOMAIN MODEL
// ===========================================

export class Position {
    constructor(
        public symbol: string,
        public side: 'LONG' | 'SHORT',
        public quantity: number,
        public entryPrice: number,
        public markPrice: number,
        public leverage: number = 1,
        public marginRatio: number = 0,
        public liquidationPrice?: number
    ) {
        this.validate();
    }

    /**
     * Create position from order execution
     */
    static fromOrder(
        symbol: string,
        side: 'BUY' | 'SELL',
        quantity: number,
        price: number,
        leverage: number = 1
    ): Position {
        const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';

        return new Position(
            symbol,
            positionSide,
            quantity,
            price,
            price,
            leverage
        );
    }

    /**
     * Calculate current unrealized PnL
     */
    calculatePnL(): number {
        const priceDiff = this.side === 'LONG'
            ? this.markPrice - this.entryPrice
            : this.entryPrice - this.markPrice;

        return priceDiff * this.quantity;
    }

    /**
     * Calculate PnL percentage
     */
    calculatePnLPercentage(): number {
        if (this.entryPrice === 0) return 0;

        const pnl = this.calculatePnL();
        const entryValue = this.entryPrice * this.quantity;

        return entryValue > 0 ? (pnl / entryValue) * 100 : 0;
    }

    /**
     * Calculate position value
     */
    getPositionValue(): number {
        return this.markPrice * this.quantity;
    }

    /**
     * Calculate required margin
     */
    getRequiredMargin(): number {
        return (this.entryPrice * this.quantity) / this.leverage;
    }

    /**
     * Check if position is profitable
     */
    isProfitable(): boolean {
        return this.calculatePnL() > 0;
    }

    /**
     * Check if position is in loss
     */
    isInLoss(): boolean {
        return this.calculatePnL() < 0;
    }

    /**
     * Check if liquidation is near (within 5% of liquidation price)
     */
    isNearLiquidation(): boolean {
        if (!this.liquidationPrice) return false;

        const threshold = this.liquidationPrice * 0.05; // 5% threshold

        if (this.side === 'LONG') {
            return this.markPrice <= this.liquidationPrice + threshold;
        } else {
            return this.markPrice >= this.liquidationPrice - threshold;
        }
    }

    /**
     * Update mark price and recalculate values
     */
    updateMarkPrice(newPrice: number): Position {
        return new Position(
            this.symbol,
            this.side,
            this.quantity,
            this.entryPrice,
            newPrice,
            this.leverage,
            this.marginRatio,
            this.liquidationPrice
        );
    }

    /**
     * Check if position is valid
     */
    isValid(): boolean {
        return (
            this.symbol.length > 0 &&
            this.quantity > 0 &&
            this.entryPrice > 0 &&
            this.markPrice > 0 &&
            this.leverage > 0 &&
            this.marginRatio >= 0
        );
    }

    private validate(): void {
        if (!this.isValid()) {
            throw new Error('Invalid position data');
        }
    }
}

// ===========================================
// TRADE DOMAIN MODEL
// ===========================================

export class Trade {
    constructor(
        public id: string,
        public userId: string,
        public orderId: string,
        public symbol: string,
        public side: 'BUY' | 'SELL',
        public quantity: number,
        public price: number,
        public fee: number = 0,
        public pnl?: number,
        public executedAt: Date = new Date()
    ) {
        this.validate();
    }

    /**
     * Calculate trade value
     */
    getTradeValue(): number {
        return this.quantity * this.price;
    }

    /**
     * Calculate net PnL (including fees)
     */
    getNetPnL(): number {
        return (this.pnl || 0) - this.fee;
    }

    /**
     * Check if trade was profitable
     */
    isProfitable(): boolean {
        return this.getNetPnL() > 0;
    }

    /**
     * Check if trade is valid
     */
    isValid(): boolean {
        return (
            this.id.length > 0 &&
            this.userId.length > 0 &&
            this.orderId.length > 0 &&
            this.symbol.length > 0 &&
            this.quantity > 0 &&
            this.price > 0 &&
            this.fee >= 0
        );
    }

    private validate(): void {
        if (!this.isValid()) {
            throw new Error('Invalid trade data');
        }
    }
}

// ===========================================
// ORDER DOMAIN MODEL
// ===========================================

export class Order {
    constructor(
        public orderId: string,
        public symbol: string,
        public side: 'BUY' | 'SELL',
        public type: 'LIMIT' | 'MARKET' | 'IOC' | 'FOK' | 'POST_ONLY',
        public quantity: number,
        public price?: number,
        public clientOrderId?: string,
        public reduceOnly: boolean = false
    ) {
        this.validate();
    }

    /**
     * Calculate order value
     */
    getOrderValue(): number {
        return this.price ? this.quantity * this.price : 0;
    }

    /**
     * Check if order is market order
     */
    isMarketOrder(): boolean {
        return this.type === 'MARKET';
    }

    /**
     * Check if order is limit order
     */
    isLimitOrder(): boolean {
        return this.type === 'LIMIT';
    }

    /**
     * Check if order is valid
     */
    isValid(): boolean {
        return (
            this.orderId.length > 0 &&
            this.symbol.length > 0 &&
            this.quantity > 0 &&
            (this.type === 'MARKET' || (this.price !== undefined && this.price > 0))
        );
    }

    private validate(): void {
        if (!this.isValid()) {
            throw new Error('Invalid order data');
        }
    }
}

// ===========================================
// STRATEGY DOMAIN MODEL
// ===========================================

export class Strategy {
    constructor(
        public id: string,
        public userId: string,
        public name: string,
        public type: 'GRID' | 'TREND_FOLLOWING' | 'ARBITRAGE',
        public symbol: string,
        public config: StrategyConfig,
        public isActive: boolean = false
    ) {
        this.validate();
    }

    /**
     * Check if strategy is tradable for current market conditions
     */
    isTradable(currentPrice: number): boolean {
        // Basic validation - strategy-specific rules would be in core services
        return currentPrice > 0;
    }

    /**
     * Get strategy risk level
     */
    getRiskLevel(): 'LOW' | 'MEDIUM' | 'HIGH' {
        // Simple risk assessment based on leverage
        const leverage = this.config.leverage || 1;
        if (leverage <= 2) return 'LOW';
        if (leverage <= 5) return 'MEDIUM';
        return 'HIGH';
    }

    /**
     * Check if strategy config is valid
     */
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

        // Basic config validation
        if (config.leverage && config.leverage <= 0) return false;
        if (config.orderQuantity && config.orderQuantity <= 0) return false;

        // Strategy-specific validation
        switch (this.type) {
            case 'GRID':
                return !!(config.gridSize && config.gridRange);
            case 'TREND_FOLLOWING':
                return !!(config.entryThreshold && config.exitThreshold);
            case 'ARBITRAGE':
                return true; // Basic validation for now
            default:
                return false;
        }
    }

    private validate(): void {
        if (!this.isValid()) {
            throw new Error('Invalid strategy configuration');
        }
    }
}

// ===========================================
// SUPPORTING INTERFACES
// ===========================================

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

export interface User {
    id: string;
    email: string;
    userLevel: 'BASIC' | 'REGISTERED' | 'VERIFIED';
    roles?: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface UserRegistration {
    email: string;
    password: string;
}

export interface UserLogin {
    email: string;
    password: string;
}

// ===========================================
// VALUE OBJECTS AND UTILITIES
// ===========================================

export class Money {
    constructor(
        public amount: number,
        public currency: string
    ) { }

    static zero(currency: string = 'USD'): Money {
        return new Money(0, currency);
    }

    add(other: Money): Money {
        if (this.currency !== other.currency) {
            throw new Error('Cannot add money with different currencies');
        }
        return new Money(this.amount + other.amount, this.currency);
    }

    subtract(other: Money): Money {
        if (this.currency !== other.currency) {
            throw new Error('Cannot subtract money with different currencies');
        }
        return new Money(this.amount - other.amount, this.currency);
    }

    multiply(factor: number): Money {
        return new Money(this.amount * factor, this.currency);
    }

    isZero(): boolean {
        return this.amount === 0;
    }

    isPositive(): boolean {
        return this.amount > 0;
    }

    toString(): string {
        return `${this.amount.toFixed(2)} ${this.currency}`;
    }
}

export class Percentage {
    constructor(public value: number) { } // 0.05 = 5%

    static fromDecimal(decimal: number): Percentage {
        return new Percentage(decimal);
    }

    static fromPercent(percent: number): Percentage {
        return new Percentage(percent / 100);
    }

    toDecimal(): number {
        return this.value;
    }

    toPercent(): number {
        return this.value * 100;
    }

    applyTo(amount: number): number {
        return amount * this.value;
    }

    toString(): string {
        return `${this.toPercent().toFixed(2)}%`;
    }
}