/**
 * C2 exchange-accounts routes — generic venue/environment accounts.
 *
 * Replaces /api/user/kodiak/* (deleted with the legacy credentials table, Q2):
 * - GET    /api/accounts           list (metadata only, never secrets)
 * - POST   /api/accounts/connect   connect + live-verify one account
 * - POST   /api/accounts/:id/verify re-verify (graduates legacy envelopes)
 * - DELETE /api/accounts/:id       revoke (audited, level recompute)
 */

import { Router, Response } from "express";
import Joi from "joi";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import { serviceProvider } from "../../../core/service-provider";
import { createErrorResponse } from "@trade-bot/shared";
import { getCorrelationId } from "../../../shared/utils/context";
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";
import {
  WalletProofError,
  consumeProof,
  walletProofEnabled,
} from "../../../core/wallet/wallet-proof.service";
import { commonSchemas } from "../../middleware/validation.middleware";

const router = Router();

const connectSchema = Joi.object({
  exchange: Joi.string().valid("kodiak", "lighter").required(),
  environment: Joi.string().valid("testnet", "mainnet").required(),
  accountId: Joi.string().when("exchange", {
    is: "kodiak",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  apiKey: Joi.string().when("exchange", {
    is: "kodiak",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  secretKey: Joi.string().when("exchange", {
    is: "kodiak",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  accountIndex: Joi.number().integer().min(0).when("exchange", {
    is: "lighter",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  apiKeyIndex: Joi.number().integer().min(0).when("exchange", {
    is: "lighter",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  privateKey: Joi.string().when("exchange", {
    is: "lighter",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  // X4: optional bind proof (action `account:bind`). The authoritative gate
  // is the service's venue-owner ∈ linked-wallets check; this signature is an
  // extra signal the frontend sends when a wallet is connected, and is
  // verified only when present.
  walletProof: commonSchemas.walletProof,
});

// GET /api/accounts
router.get(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const userId = req.user.userId as string;
      const accounts = await serviceProvider
        .getExchangeAccountService()
        .listAccounts(userId);
      res.json({ success: true, data: { accounts } });
    } catch (error) {
      logger.error("List accounts error", error as Error, {
        ...createErrorResponse(
          error instanceof Error ? error : new Error(String(error)),
          getCorrelationId()
        ),
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to list accounts" });
    }
  }
);

// POST /api/accounts/connect
router.post(
  "/connect",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const { error, value } = connectSchema.validate(req.body);
      if (error) {
        return res
          .status(400)
          .json({ success: false, error: error.details[0].message });
      }
      const userId = req.user.userId as string;

      // X4: verify the optional bind proof (action `account:bind`) when the
      // client sent one. Absent proof is allowed here — the service's
      // venue-owner ∈ linked-wallets check is the authoritative gate.
      if (walletProofEnabled() && value.walletProof) {
        try {
          await consumeProof(userId, "account:bind", value.walletProof);
        } catch (err) {
          if (err instanceof WalletProofError) {
            return res.status(err.statusCode).json({
              success: false,
              code: err.code,
              error: err.message,
            });
          }
          throw err;
        }
      }

      const result = await serviceProvider
        .getExchangeAccountService()
        .connectAccount(userId, value);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }
      res.json({
        success: true,
        message: result.message,
        data: result.account,
      });
    } catch (error) {
      logger.error("Account connect error", error as Error, {
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to connect account" });
    }
  }
);

// POST /api/accounts/:id/verify
router.post(
  "/:id/verify",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const userId = req.user.userId as string;
      const accountId = req.params.id as string;
      const result = await serviceProvider
        .getExchangeAccountService()
        .verifyAccount(userId, accountId);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }
      res.json({
        success: true,
        message: result.message,
        data: result.account,
      });
    } catch (error) {
      logger.error("Account verify error", error as Error, {
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to verify account" });
    }
  }
);

// DELETE /api/accounts/:id
router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const userId = req.user.userId as string;
      const accountId = req.params.id as string;
      const result = await serviceProvider
        .getExchangeAccountService()
        .revokeAccount(userId, accountId);
      if (!result.success) {
        // C3a: 409 when bots bind to the account (FK RESTRICT) so the
        // frontend can tell "stop the bots first" apart from "not found".
        const status =
          typeof result.boundBots === "number" && result.boundBots > 0
            ? 409
            : 404;
        return res.status(status).json({
          success: false,
          error: result.message,
          ...(typeof result.boundBots === "number"
            ? { boundBots: result.boundBots }
            : {}),
        });
      }
      res.json({ success: true, message: result.message });
    } catch (error) {
      logger.error("Account revoke error", error as Error, {
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to revoke account" });
    }
  }
);

export { router as exchangeAccountRoutes };
