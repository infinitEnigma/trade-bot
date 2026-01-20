/** @format */

/**
 * Analytics Feature
 *
 * Advanced trading analytics and performance insights.
 * Provides comprehensive analysis of trading performance, risk metrics, and market data.
 */

// Types
export type {
    AnalyticsTimeWindow,
    AnalyticsMetrics,
    SectorPerformance,
    PriceDataPoint,
    AnalyticsData,
    AnalyticsOptions,
    AnalyticsState,
} from "./types/analytics.types";

// Components
export {
    AnalyticsDashboard,
    PerformanceMetrics,
    RiskMetrics,
    SectorPerformance as SectorPerformanceChart,
} from "./components";

// Hooks
export { useAnalytics } from "./hooks";

// Services
export { analyticsService } from "./services";
