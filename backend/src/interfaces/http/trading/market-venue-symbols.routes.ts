/**
 * GET /api/market/venue-symbols — the symbols a venue lists (X2, live-test
 * follow-up).
 *
 * Thin, authenticated wrapper over `listVenueSymbols` so the frontend can make
 * the strategy symbol picker venue-aware: when a user picks an account at
 * start, the UI asks "what does this venue list?" and warns when the strategy's
 * symbol isn't among them — turning the start-time `VenueSymbolError` (L20)
 * reject into proactive guidance.
 *
 * This is a UX guide, NOT a gate. It shares `listVenueSymbols` with the
 * authoritative start check (`assertSymbolSupported` in
 * `bot-lifecycle.service.ts`) so there is one catalog source. Fail-open by
 * design: when the catalog can't be fetched `listVenueSymbols` returns `null`,
 * and we answer `available: false` with an empty list — the UI then shows no
 * warning and the engine's own market resolution stays authoritative.
 *
 * Only ACTIVE-account metadata reaches here (exchange + environment strings);
 * no secrets, no per-user data — any authenticated user may query a venue's
 * public catalog.
 */
import { Router, Response } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import { errMessage, marketLogger, ok } from "./market-helpers";
import { listVenueSymbols } from "../../../infrastructure/external/venue-symbols";

export const venueSymbolsRoutes = Router();

/** The venue vocabulary the catalog fetcher understands (ExchangeKind). */
const KNOWN_EXCHANGES = new Set(["kodiak", "lighter"]);
const KNOWN_ENVIRONMENTS = new Set(["testnet", "mainnet"]);

venueSymbolsRoutes.get(
  "/venue-symbols",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const exchange = String(req.query.exchange ?? "");
    const environment = String(req.query.environment ?? "");

    if (
      !KNOWN_EXCHANGES.has(exchange) ||
      !KNOWN_ENVIRONMENTS.has(environment)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "exchange (kodiak|lighter) and environment (testnet|mainnet) are required",
      });
    }

    try {
      const symbols = await listVenueSymbols(exchange, environment);
      // `null` = catalog unavailable (fail-open) — report it so the UI can
      // stay silent rather than assert an empty (wrong) catalog.
      ok(res, {
        exchange,
        environment,
        available: symbols !== null,
        symbols: symbols ?? [],
      });
    } catch (err: unknown) {
      marketLogger.warn("Venue symbol catalog request failed", {
        exchange,
        environment,
        error: errMessage(err),
      });
      // Never 500 the picker: an unreachable catalog is "unknown", not an error.
      ok(res, { exchange, environment, available: false, symbols: [] });
    }
  }
);
