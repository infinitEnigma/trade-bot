/** @format */

/**
 * Dashboard Feature
 *
 * Main dashboard displaying portfolio overview, charts, and key metrics.
 * Aggregates data from multiple domains for high-level user insights.
 */

// Components
//export { BalanceCards, QuickActions, PositionsTable, RecentTrades } from "./components";
export { QuickActions } from "./components";

// Hooks
export { useDashboard } from "./hooks";

// Services
export { dashboardService } from "./services";

// Types
export type {
    BalanceData,
    Position,
    Trade,
    PortfolioData,
    PortfolioPerformancePoint,
    DashboardState,
    DashboardActions,
} from "./types";
