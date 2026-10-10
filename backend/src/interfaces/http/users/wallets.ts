/**
 * C2 wallets routes — chain-aware multi-wallet linking.
 *
 * Replaces POST /api/user/verify-wallet + POST /api/user/unlink-wallet
 * (deleted with the legacy wallet table, Q2 clean cut):
 * - GET    /api/wallets            list (primary first)
 * - POST   /api/wallets/verify     link/verify (chain + signature)
 * - POST   /api/wallets/:id/unlink unlink one wallet (audited, recompute)
 * - PATCH  /api/wallets/:id/primary make primary
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
import { RateLimiters } from "../../../infrastructure/security/rate-limiter.service";
import {
  WALLET_PROOF_ACTIONS,
  WalletProofAction,
  WalletProofError,
  issueChallenge,
  walletProofEnabled,
} from "../../../core/wallet/wallet-proof.service";

const router = Router();

const walletVerifySchema = Joi.object({
  chain: Joi.string().valid("evm", "solana", "bitcoin").default("evm"),
  address: Joi.string().required(),
  walletAddress: Joi.string().optional(),
  label: Joi.string().max(64).optional(),
  signature: Joi.string().required(),
  message: Joi.string().required(),
});

// X4: which action the caller is requesting a proof challenge for.
const walletChallengeSchema = Joi.object({
  action: Joi.string()
    .valid(...WALLET_PROOF_ACTIONS)
    .required()
    .messages({
      "any.only": `Action must be one of: ${WALLET_PROOF_ACTIONS.join(", ")}`,
      "any.required": "Action is required",
    }),
});

// GET /api/wallets
router.get(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const userId = req.user.userId as string;
      const authService = serviceProvider.getAuthService();
      const wallets = authService.getWallets
        ? await authService.getWallets(userId)
        : [];
      // X4: additive flag so the frontend can skip the signing flow entirely
      // when WALLET_PROOF_REQUIRED is off.
      res.json({
        success: true,
        data: { wallets, proofRequired: walletProofEnabled() },
      });
    } catch (error) {
      logger.error("List wallets error", error as Error, {
        ...createErrorResponse(
          error instanceof Error ? error : new Error(String(error)),
          getCorrelationId()
        ),
        userId: req.user?.userId,
      });
      res.status(500).json({ success: false, error: "Failed to list wallets" });
    }
  }
);

// POST /api/wallets/challenge — issue a single-use proof challenge (X4).
// The returned message is built server-side; the client signs it verbatim.
router.post(
  "/challenge",
  authMiddleware,
  RateLimiters.auth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const { error, value } = walletChallengeSchema.validate(req.body);
      if (error) {
        return res
          .status(400)
          .json({ success: false, error: error.details[0].message });
      }
      const userId = req.user.userId as string;
      const challenge = await issueChallenge(
        userId,
        value.action as WalletProofAction
      );
      res.json({ success: true, data: challenge });
    } catch (error) {
      // Preserve the proof-service error contract: a challenge-store outage
      // (REDIS_UNAVAILABLE) is 503, not a generic 500 — clients/monitoring can
      // tell "try again later" from an unexpected server error.
      if (error instanceof WalletProofError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          error: error.message,
          timestamp: Date.now(),
        });
      }
      logger.error("Wallet challenge error", error as Error, {
        ...createErrorResponse(
          error instanceof Error ? error : new Error(String(error)),
          getCorrelationId()
        ),
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to issue wallet challenge" });
    }
  }
);

// POST /api/wallets/verify
router.post(
  "/verify",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const { error, value } = walletVerifySchema.validate(req.body);
      if (error) {
        return res
          .status(400)
          .json({ success: false, error: error.details[0].message });
      }
      const userId = req.user.userId as string;
      const address = (value.address ?? value.walletAddress) as string;
      const userProfileService = serviceProvider.getUserProfileService();
      const result = await userProfileService.verifyWalletOwnership(
        userId,
        address,
        value.signature as string,
        value.message as string,
        (value.chain ?? "evm") as "evm" | "solana" | "bitcoin"
      );
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.message });
      }
      res.json({ success: true, message: result.message });
    } catch (error) {
      logger.error("Wallet verification error", error as Error, {
        ...createErrorResponse(
          error instanceof Error ? error : new Error(String(error)),
          getCorrelationId()
        ),
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to verify wallet" });
    }
  }
);

// POST /api/wallets/:id/unlink — explicit, audited downgrade of one wallet.
router.post(
  "/:id/unlink",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const userId = req.user.userId as string;
      const authService = serviceProvider.getAuthService();
      const walletId = req.params.id as string;
      const result = await authService.unlinkWallet(userId, walletId);
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.message });
      }
      await serviceProvider
        .getUserProfileService()
        .invalidateUserProfileCache(userId);
      res.json({ success: true, message: result.message });
    } catch (error) {
      logger.error("Wallet unlink error", error as Error, {
        ...createErrorResponse(
          error instanceof Error ? error : new Error(String(error)),
          getCorrelationId()
        ),
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to unlink wallet" });
    }
  }
);

// PATCH /api/wallets/:id/primary
router.patch(
  "/:id/primary",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) throw new Error("User not authenticated");
      const userId = req.user.userId as string;
      const authService = serviceProvider.getAuthService();
      const walletId = req.params.id as string;
      const ok = authService.setPrimaryWallet
        ? await authService.setPrimaryWallet(userId, walletId)
        : false;
      if (!ok) {
        return res
          .status(404)
          .json({ success: false, error: "Wallet not found" });
      }
      await serviceProvider
        .getUserProfileService()
        .invalidateUserProfileCache(userId);
      res.json({ success: true, message: "Primary wallet updated" });
    } catch (error) {
      logger.error("Set primary wallet error", error as Error, {
        userId: req.user?.userId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to set primary wallet" });
    }
  }
);

export { router as walletsRoutes };
