/**
 * Market HTTP layer - composer only (Phase A2 decomposition).
 *
 * Formerly a 954-line god-file containing ~13 inline handlers with
 * copy-pasted Redis boilerplate, raw kodiak_credentials SQL, and a duplicated
 * roundTo5Minutes. Each endpoint group now lives in its own module; this file
 * only mounts them so app.use("/api/market", marketRoutes) keeps working.
 *
 * Route inventory (all paths preserved):
 * - market-ticker.routes.ts        -> /ticker, /tickers
 * - market-klines.routes.ts        -> /klines
 * - market-futures.routes.ts       -> /orderbook, /futures/:symbol, /markprice/:symbol
 * - market-portfolio.routes.ts     -> /positions, /balance (auth)
 * - market-ws-url.routes.ts        -> /ws-url (auth + verified creds)
 * - market-tv.routes.ts            -> /tv/config, /tv/symbols, /tv/history
 * - market-kline-history.routes.ts -> /kline-history (auth + verified creds)
 *
 * Shared boilerplate lives in market-helpers.ts and market-cache.ts.
 */

/** @format */

import { Router } from "express";
import { tickerRoutes } from "./market-ticker.routes";
import { klinesRoutes } from "./market-klines.routes";
import { futuresRoutes } from "./market-futures.routes";
import { portfolioRoutes } from "./market-portfolio.routes";
import { wsUrlRoutes } from "./market-ws-url.routes";
import { tvRoutes } from "./market-tv.routes";
import { klineHistoryRoutes } from "./market-kline-history.routes";

const router = Router();

router.use(tickerRoutes);
router.use(klinesRoutes);
router.use(futuresRoutes);
router.use(portfolioRoutes);
router.use(wsUrlRoutes);
router.use(tvRoutes);
router.use(klineHistoryRoutes);

export { router as marketRoutes };
