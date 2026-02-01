/** @format */

import { describe, it, expect } from "vitest";
import { UserRole, UserLevel, User, Balance, StrategyType, Strategy, StrategyConfig } from "./types";

describe("types.ts", () => {
    describe("Enums", () => {
        it("should export UserRole enum with correct values", () => {
            expect(UserRole.QUALIFIED_ALPHA).toBe("QUALIFIED_ALPHA");
        });

        it("should export UserLevel enum with correct values", () => {
            expect(UserLevel.BASIC).toBe("BASIC");
            expect(UserLevel.REGISTERED).toBe("REGISTERED");
            expect(UserLevel.VERIFIED).toBe("VERIFIED");
        });

        it("should export StrategyType enum with correct values", () => {
            expect(StrategyType.GRID).toBe("GRID");
            expect(StrategyType.TREND_FOLLOWING).toBe("TREND_FOLLOWING");
            expect(StrategyType.ARBITRAGE).toBe("ARBITRAGE");
        });
    });

    describe("Balance class", () => {
        it("should create a Balance instance", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());
            expect(balance.total).toBe(100);
            expect(balance.available).toBe(50);
            expect(balance.locked).toBe(50);
            expect(balance.currency).toBe("USD");
            expect(balance.lastUpdated).toBeInstanceOf(Date);
        });

        it("should create zero balance", () => {
            const balance = Balance.zero();
            expect(balance.total).toBe(0);
            expect(balance.available).toBe(0);
            expect(balance.locked).toBe(0);
        });

        it("should create balance from total", () => {
            const balance = Balance.fromTotal(100);
            expect(balance.total).toBe(100);
            expect(balance.available).toBe(100);
            expect(balance.locked).toBe(0);
        });

        it("should check if balance is valid", () => {
            const validBalance = new Balance(100, 50, 50, "USD", new Date());
            expect(validBalance.isValid()).toBe(true);

            const invalidBalance = new Balance(-100, 50, 50, "USD", new Date());
            expect(invalidBalance.isValid()).toBe(false);
        });

        it("should check if balance is zero", () => {
            const zeroBalance = Balance.zero();
            expect(zeroBalance.isZero()).toBe(true);

            const nonZeroBalance = new Balance(100, 50, 50, "USD", new Date());
            expect(nonZeroBalance.isZero()).toBe(false);
        });

        it("should check if balance is positive", () => {
            const positiveBalance = new Balance(100, 50, 50, "USD", new Date());
            expect(positiveBalance.isPositive()).toBe(true);

            const zeroBalance = Balance.zero();
            expect(zeroBalance.isPositive()).toBe(false);
        });

        it("should calculate utilization percentage", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());
            expect(balance.getUtilizationPercentage()).toBe(50);
        });

        it("should lock and unlock amounts", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());

            const lockedBalance = balance.lock(25);
            expect(lockedBalance.available).toBe(25);
            expect(lockedBalance.locked).toBe(75);

            const unlockedBalance = lockedBalance.unlock(25);
            expect(unlockedBalance.available).toBe(50);
            expect(unlockedBalance.locked).toBe(50);
        });

        it("should throw error when locking more than available", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());
            expect(() => balance.lock(51)).toThrow('Insufficient available balance');
        });

        it("should throw error when unlocking more than locked", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());
            expect(() => balance.unlock(51)).toThrow('Insufficient locked balance');
        });

        it("should add and subtract amounts", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());

            const addedBalance = balance.add(50);
            expect(addedBalance.total).toBe(150);
            expect(addedBalance.available).toBe(100);

            const subtractedBalance = addedBalance.subtract(25);
            expect(subtractedBalance.total).toBe(125);
            expect(subtractedBalance.available).toBe(75);
        });

        it("should throw error when subtracting more than available", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());
            expect(() => balance.subtract(51)).toThrow('Insufficient available balance');
        });

        it("should check if can withdraw", () => {
            const balance = new Balance(100, 50, 50, "USD", new Date());

            expect(balance.canWithdraw(50)).toBe(true);
            expect(balance.canWithdraw(51)).toBe(false);
        });
    });

    describe("Strategy class", () => {
        const baseConfig: StrategyConfig = {
            leverage: 2,
            orderQuantity: 10,
            gridSize: 5,
            gridRange: 10,
            entryThreshold: 0.01,
            exitThreshold: 0.02,
            stopLoss: 0.05
        };

        it("should create a Strategy instance", () => {
            const strategy = new Strategy("1", "user1", "Test Strategy", StrategyType.GRID, "BTC/USD", baseConfig);

            expect(strategy.id).toBe("1");
            expect(strategy.userId).toBe("user1");
            expect(strategy.name).toBe("Test Strategy");
            expect(strategy.type).toBe(StrategyType.GRID);
            expect(strategy.symbol).toBe("BTC/USD");
            expect(strategy.config).toEqual(baseConfig);
            expect(strategy.active).toBe(false);
        });

        it("should check if strategy is valid", () => {
            const validStrategy = new Strategy("1", "user1", "Test Strategy", StrategyType.GRID, "BTC/USD", baseConfig);
            expect(validStrategy.isValid()).toBe(true);

            const invalidStrategy = new Strategy("", "user1", "Test Strategy", StrategyType.GRID, "BTC/USD", baseConfig);
            expect(invalidStrategy.isValid()).toBe(false);
        });

        it("should determine risk level", () => {
            const lowRisk = new Strategy("1", "user1", "Low Risk", StrategyType.GRID, "BTC/USD", { ...baseConfig, leverage: 2 });
            const mediumRisk = new Strategy("1", "user1", "Medium Risk", StrategyType.GRID, "BTC/USD", { ...baseConfig, leverage: 4 });
            const highRisk = new Strategy("1", "user1", "High Risk", StrategyType.GRID, "BTC/USD", { ...baseConfig, leverage: 6 });

            expect(lowRisk.getRiskLevel()).toBe("LOW");
            expect(mediumRisk.getRiskLevel()).toBe("MEDIUM");
            expect(highRisk.getRiskLevel()).toBe("HIGH");
        });

        it("should check if strategy is tradable", () => {
            const strategy = new Strategy("1", "user1", "Test Strategy", StrategyType.GRID, "BTC/USD", baseConfig);

            expect(strategy.isTradable(100)).toBe(true);
            expect(strategy.isTradable(0)).toBe(false);
        });

        it("should validate configuration based on strategy type", () => {
            const gridStrategy = new Strategy("1", "user1", "Grid Strategy", StrategyType.GRID, "BTC/USD", baseConfig);
            expect(gridStrategy.isValid()).toBe(true);

            const invalidGridStrategy = new Strategy("1", "user1", "Invalid Grid", StrategyType.GRID, "BTC/USD", { ...baseConfig, gridSize: undefined });
            expect(invalidGridStrategy.isValid()).toBe(false);

            const trendStrategy = new Strategy("1", "user1", "Trend Strategy", StrategyType.TREND_FOLLOWING, "BTC/USD", baseConfig);
            expect(trendStrategy.isValid()).toBe(true);

            const invalidTrendStrategy = new Strategy("1", "user1", "Invalid Trend", StrategyType.TREND_FOLLOWING, "BTC/USD", { ...baseConfig, entryThreshold: undefined });
            expect(invalidTrendStrategy.isValid()).toBe(false);

            const arbitrageStrategy = new Strategy("1", "user1", "Arbitrage Strategy", StrategyType.ARBITRAGE, "BTC/USD", {});
            expect(arbitrageStrategy.isValid()).toBe(true);
        });

        it("should invalidate strategy with invalid config values", () => {
            const strategyWithInvalidLeverage = new Strategy("1", "user1", "Invalid Leverage", StrategyType.GRID, "BTC/USD", { ...baseConfig, leverage: 0 });
            expect(strategyWithInvalidLeverage.isValid()).toBe(false);

            const strategyWithInvalidQuantity = new Strategy("1", "user1", "Invalid Quantity", StrategyType.GRID, "BTC/USD", { ...baseConfig, orderQuantity: 0 });
            expect(strategyWithInvalidQuantity.isValid()).toBe(false);
        });
    });

});