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
} from "./types/strategies.types";

// Strategies subdomain
export { StrategyList, StrategyCard } from "./components";
export { useStrategies } from "./strategies/hooks";
export { strategyService } from "./services";

// Bots subdomain
export { BotControls } from "./bots/components";

// Balance subdomain
export { useBalance } from "./balance/hooks";
