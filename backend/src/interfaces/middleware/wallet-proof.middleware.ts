/** @format */

/**
 * requireWalletProof(action) (X4) — the wallet-owner proof gate.
 *
 * Runs after Joi validation, before the route handler, on the four gated bot
 * routes (start/stop/resume/runs). Skips entirely when WALLET_PROOF_REQUIRED
 * is `false` (harness/e2e escape hatch, D3). On success attaches
 * `req.verifiedWalletProof.address` — the *linked-wallet canonical* address
 * the signature was proven for.
 *
 * Optionally takes an account resolver so the same middleware also enforces
 * the venue-verified binding (D2): the proof address must equal the account's
 * `meta.walletBinding.address`. A missing binding is fail-closed 403.
 * `undefined` from the resolver means "row not found" — the route's own 404
 * path owns that answer, so the binding check is skipped.
 */

import { Request, Response, NextFunction } from "express";
import {
  WalletProofAction,
  WalletProofError,
  VerifiedWalletProof,
  consumeProof,
  walletProofEnabled,
  checkAccountWalletBinding,
} from "../../core/wallet/wallet-proof.service";
import { query } from "../../database/pool";
import { httpLogger as logger } from "../../core/logging/context-aware-logger.service";

export interface WalletProofRequest extends Request {
  user?: {
    userId: string;
    email: string;
    userLevel: string;
    roles: string[];
  };
  verifiedWalletProof?: VerifiedWalletProof;
}

/** Bot-keyed routes: resolve the bot's bound account (scoped by user). */
export async function botBoundAccountId(
  userId: string,
  botId: string
): Promise<string | null | undefined> {
  const result = await query<{ exchange_account_id: string | null }>(
    `SELECT exchange_account_id FROM bot_instances WHERE id = $1 AND user_id = $2`,
    [botId, userId]
  );
  if (result.rows.length === 0) return undefined; // route 404s
  return result.rows[0].exchange_account_id; // null = unbound → fail-closed
}

/**
 * @param action  the challenge action this route consumes
 * @param opts.resolveAccountId  optional binding scope:
 *   - string → check binding of that account id (e.g. /start body)
 *   - (userId, req) → async resolver (bot-keyed routes)
 *   - absent → proof-only gate
 */
export function requireWalletProof(
  action: WalletProofAction,
  opts: {
    resolveAccountId?:
      | string
      | ((
          userId: string,
          req: Request
        ) => Promise<string | null | undefined> | string | null | undefined);
  } = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!walletProofEnabled()) return next();

    const walletReq = req as WalletProofRequest;
    const userId = walletReq.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    const proof = (req.body as { walletProof?: Record<string, unknown> })
      ?.walletProof;
    if (!proof?.nonce || !proof?.address || !proof?.signature) {
      return res.status(403).json({
        success: false,
        code: "PROOF_REQUIRED",
        error:
          "This action requires a wallet signature. Request a challenge from POST /api/wallets/challenge, sign it, and send it as walletProof.",
        timestamp: Date.now(),
      });
    }

    let verified: VerifiedWalletProof;
    try {
      verified = await consumeProof(userId, action, {
        nonce: String(proof.nonce),
        address: String(proof.address),
        signature: String(proof.signature),
      });
    } catch (err) {
      if (err instanceof WalletProofError) {
        logger.warn("Wallet proof rejected", {
          userId,
          action,
          code: err.code,
        });
        return res.status(err.statusCode).json({
          success: false,
          code: err.code,
          error: err.message,
          timestamp: Date.now(),
        });
      }
      logger.error("Wallet proof verification failed", err as Error, {
        userId,
        action,
      });
      return res.status(500).json({
        success: false,
        error: "Wallet proof verification failed",
        timestamp: Date.now(),
      });
    }

    // Venue-verified binding (D2, phase 3): proof address must equal the
    // account's cached venue owner. Fail-closed when the binding is absent.
    try {
      let accountId: string | null | undefined;
      const resolver = opts.resolveAccountId;
      if (typeof resolver === "string") {
        accountId = resolver;
      } else if (typeof resolver === "function") {
        accountId = await resolver(userId, req);
      }
      // undefined = row not found → the route's own 404 owns the answer.
      if (accountId !== undefined) {
        if (accountId === null) {
          return res.status(403).json({
            success: false,
            code: "WALLET_BINDING_MISSING",
            error:
              "This bot is not bound to an exchange account. Re-verify the account in Settings to bind your wallet.",
            timestamp: Date.now(),
          });
        }
        const binding = await checkAccountWalletBinding(
          userId,
          verified.address,
          accountId
        );
        if (!binding.ok) {
          logger.warn("Wallet binding mismatch", {
            userId,
            action,
            exchangeAccountId: accountId,
            proofAddress: verified.address,
          });
          return res.status(403).json({
            success: false,
            code: "WALLET_BINDING_MISMATCH",
            error: binding.error,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      logger.error("Wallet binding check failed", err as Error, {
        userId,
        action,
      });
      return res.status(500).json({
        success: false,
        error: "Wallet binding check failed",
        timestamp: Date.now(),
      });
    }

    walletReq.verifiedWalletProof = verified;
    next();
  };
}
