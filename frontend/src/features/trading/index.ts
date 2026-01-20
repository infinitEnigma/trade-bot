/** @format */

/**
 * Trading Feature
 *
 * Comprehensive trading functionality including strategies, bots, and balance management.
 * Organized into subdomains for clear separation of concerns.
 */

// Shared types
export type {
    BotInstance,
    TradingBalance,
    StrategyFormData,
    BotStatus,
    MarketDataPoint,
    TradingState,
    TradingActions,
} from "./types/trading.types";

// Strategies subdomain
export { StrategyList, StrategyCard } from "./strategies/components";
export { useStrategies } from "./strategies/hooks";
export { strategyService } from "./strategies/services";

// Bots subdomain
export { BotControls } from "./bots/components";

// Balance subdomain
export { useBalance } from "./balance/hooks";
