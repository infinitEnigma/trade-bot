/** @format */

import { Router, Response } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
} from "../../middleware/auth.middleware";
import {
  createBlockchainService,
  BlockchainBalance,
} from "../../../infrastructure/external/blockchain.service";

// Create blockchain service instance on demand
const getBlockchainService = () => createBlockchainService();
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";
import { RateLimiters } from "../../../infrastructure/security/rate-limiter.service";
import {
  UserLevel,
  Wallet,
  ValidationError,
  NotFoundError,
  ServiceUnavailableError,
} from "@trade-bot/shared";

const router = Router();

/**
 * Persistence port (review P3): routes must not import repository adapters.
 * Both lookups are wired in `server/route-config.ts`; tests inject a double
 * the same way. Fail-fast: an unwired lookup must never fabricate a wallet.
 */
export interface BalanceWalletLookup {
  getOwnedWallet(userId: string, walletId: string): Promise<Wallet | null>;
  listWallets(userId: string): Promise<Wallet[]>;
}

let lookupImpl: BalanceWalletLookup | undefined;

/** Route wiring (server/route-config.ts). Tests inject a double the same way. */
export function setBalanceWalletLookup(lookup: BalanceWalletLookup): void {
  lookupImpl = lookup;
}

/** Fail-fast accessor — an unwired lookup must never fabricate a wallet. */
function lookup(): BalanceWalletLookup {
  if (!lookupImpl) {
    throw new Error(
      "Balance wallet lookup not wired — call setBalanceWalletLookup() in route-config"
    );
  }
  return lookupImpl;
}

/**
 * Resolve the EVM wallet whose on-chain balance a user may read.
 *
 * Ownership policy (C2 multi-wallet):
 * - `walletId` given → that exact wallet, but only if the user owns it.
 *   A missing or foreign wallet maps to 404 — never leak existence of
 *   another user's wallet.
 * - `walletId` omitted → the user's primary EVM wallet, falling back to
 *   their first EVM wallet. A non-EVM primary (solana/bitcoin) must not
 *   silently look like "no wallet" the way the old address-format check
 *   did.
 * - A resolved non-EVM wallet is an explicit 400: EVM-only reader.
 */
async function resolveEvmWallet(
  userId: string,
  walletId?: string
): Promise<Wallet> {
  if (walletId) {
    const wallet = await lookup().getOwnedWallet(userId, walletId);
    if (!wallet) {
      throw new NotFoundError("Wallet", {
        userId,
        walletId,
        operation: "wallet_balance_fetch",
      });
    }
    if (wallet.chain !== "evm") {
      throw new ValidationError(
        `Chain '${wallet.chain}' is not supported for on-chain balance yet. Only EVM wallets are.`,
        { userId, walletId, operation: "wallet_balance_fetch" }
      );
    }
    return wallet;
  }

  const wallets = await lookup().listWallets(userId);
  const evmWallets = wallets.filter(wallet => wallet.chain === "evm");
  const wallet =
    evmWallets.find(candidate => candidate.isPrimary) ?? evmWallets[0];
  if (!wallet) {
    throw new ValidationError(
      "No connected wallet found. Please connect your wallet in Settings.",
      { userId, operation: "wallet_balance_fetch" }
    );
  }
  return wallet;
}

/**
 * Shape the wire response for an on-chain native balance read.
 * `source` separates this from venue balances; `observedAt` is the
 * freshness tag (research-balance Q5); `timestamp` is kept as a
 * back-compat alias; `cache` makes Redis hits visible to the client.
 */
function toBalanceResponse(wallet: Wallet, balance: BlockchainBalance) {
  return {
    source: "onchain",
    walletId: wallet.id,
    address: balance.address,
    chainId: balance.chainId,
    chainName: balance.chainName,
    symbol: balance.symbol,
    nativeBalance: balance.nativeBalance,
    nativeBalanceFormatted: balance.nativeBalanceFormatted,
    timestamp: balance.timestamp,
    observedAt: balance.timestamp,
    cache: balance.cacheHit ? "hit" : "miss",
  };
}

/**
 * Fail-closed error mapping: wallet-resolution errors are already
 * structured (400/404) and pass through; anything else is a provider
 * failure and becomes 503 — never a fabricated balance, never a 500 with
 * `success: true`.
 */
function mapBalanceError(
  error: unknown,
  userId: string,
  operation: string
): Error {
  if (error instanceof ValidationError || error instanceof NotFoundError) {
    return error;
  }
  logger.error("Wallet balance provider failure", error as Error, {
    userId,
    operation,
  });
  return new ServiceUnavailableError("Blockchain", {
    userId,
    operation,
    service: "blockchain_rpc",
  });
}

function requireUser(
  req: AuthenticatedRequest,
  operation: string
): { userId: string; userLevel: UserLevel } {
  if (!req.user) {
    throw new ValidationError("User not authenticated", { operation });
  }
  // The auth middleware carries userLevel as a plain string; narrow to the
  // enum for downstream comparisons.
  return {
    userId: req.user.userId,
    userLevel: req.user.userLevel as UserLevel,
  };
}

/**
 * GET /api/balance/current
 * Get user's current wallet balance from connected blockchain wallet.
 * Optional `?walletId=` scopes the read to one owned wallet (404 for
 * foreign/missing ids); omitted → primary EVM wallet.
 */
router.get(
  "/current",
  RateLimiters.balance,
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId, userLevel } = requireUser(req, "wallet_balance_fetch");

    // BASIC users have no linked wallets by definition (unlink downgrades
    // the level) — skip provider work and answer honestly.
    if (userLevel === UserLevel.BASIC) {
      logger.debug(
        "Wallet balance request from BASIC user, skipping rpc call",
        {
          userId,
          userLevel,
        }
      );
      return res.json({
        success: true,
        data: null,
        message: "Wallet balance data available after wallet connection",
      });
    }

    const walletId =
      typeof req.query.walletId === "string" ? req.query.walletId : undefined;

    try {
      const wallet = await resolveEvmWallet(userId, walletId);
      const balance = await getBlockchainService().getNativeBalance(
        wallet.address
      );

      return res.json({
        success: true,
        data: toBalanceResponse(wallet, balance),
      });
    } catch (error) {
      throw mapBalanceError(error, userId, "wallet_balance_fetch");
    }
  }
);

/**
 * POST /api/balance/refresh
 * Invalidate the cached balance for an owned wallet and re-read it.
 * Optional body `{ walletId }`; same response shape and error contract
 * as GET /current.
 */
router.post(
  "/refresh",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = requireUser(req, "wallet_balance_refresh");

    const walletId =
      typeof req.body?.walletId === "string" ? req.body.walletId : undefined;

    try {
      const wallet = await resolveEvmWallet(userId, walletId);

      // ✅ Invalidate cache to force fresh fetch
      await getBlockchainService().invalidateUserCache(userId, wallet.address);

      const balance = await getBlockchainService().getNativeBalance(
        wallet.address
      );

      logger.info("Wallet balance manually refreshed", {
        userId,
        walletId: wallet.id,
      });

      return res.json({
        success: true,
        data: toBalanceResponse(wallet, balance),
      });
    } catch (error) {
      throw mapBalanceError(error, userId, "wallet_balance_refresh");
    }
  }
);

export const walletBalanceRoutes = router;
