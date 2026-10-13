/** GET /api/market/orders — authenticated open orders (Phase 3 slice 1: the strategy workspace's venue-direct open-orders read; scope contract shared with market-portfolio.routes). */
import { Router, Response } from "express";
import { kodiakIntegrationService } from "../../../infrastructure/external/kodiak-integration.service";
import { getLighterOrders } from "../../../infrastructure/external/lighter/portfolio";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import { resolveAccountScope } from "./market-portfolio.routes";
import { errMessage, fail, ok } from "./market-helpers";

export const ordersRoutes = Router();

ordersRoutes.get(
  "/orders",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }
      // Same 400/404/409 scope table as /positions|/balance|/trades — the
      // venue dispatch is the scoped account's exchange, so two accounts of
      // one user never bleed into each other's order book.
      const scope = await resolveAccountScope(
        userId,
        req.query.exchangeAccountId
      );
      if (!scope.ok) {
        return res
          .status(scope.status)
          .json({ success: false, error: scope.error });
      }
      // Optional `?symbol=` narrows the listing (server-side on Kodiak/
      // Orderly, client-side on Lighter whose verified params are only
      // `account_index`); blank/array values read as "whole book".
      const rawSymbol = req.query.symbol;
      const symbol =
        typeof rawSymbol === "string" && rawSymbol.trim() !== ""
          ? rawSymbol.trim()
          : undefined;
      const ordersResponse =
        scope.exchange === "lighter"
          ? await getLighterOrders(
              userId,
              scope.exchangeAccountId as string,
              symbol
            )
          : await kodiakIntegrationService.getOrders(
              userId,
              scope.exchangeAccountId,
              symbol
            );
      if (!ordersResponse.success) {
        return res.status(400).json({
          success: false,
          error: ordersResponse.error || "Failed to fetch open orders",
        });
      }
      ok(res, ordersResponse.data);
    } catch (err: unknown) {
      fail(res, "orders_endpoint", "Failed to fetch open orders", {
        userId: req.user?.userId,
        exchangeAccountId: req.query.exchangeAccountId,
        symbol: req.query.symbol,
        error: errMessage(err),
      });
    }
  }
);
