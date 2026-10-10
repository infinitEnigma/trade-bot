/** @format */

/**
 * WalletProofService (X4) — server-built challenge + single-use proof consume.
 *
 * A proof is a signature by a *linked* EVM wallet over a server-built message
 * (action + UUID nonce + issued/expires + an explicit "no transaction" note).
 * The challenge lives in Redis at `wallet:challenge:{userId}:{nonce}` with a
 * 300 s TTL and is DELETEd on first consume — there is no proof-reuse cache,
 * so one signature authorises exactly one gated action (D4).
 *
 * Fail-closed everywhere: a Redis error while issuing or consuming is an
 * outage of the same control plane the bot routes already depend on, and is
 * surfaced as `REDIS_UNAVAILABLE` (mapped to 503 by the middleware) — never
 * as a silent pass.
 *
 * The flag `WALLET_PROOF_REQUIRED` (default ON; only an explicit `false`
 * disables — D3) is read per call so harnesses/e2e can flip it without a
 * rebuild; `walletProofEnabled()` is the single reader.
 */

import { randomUUID } from "crypto";
import { redisService } from "../../infrastructure/cache/redis.service";
import { signatureVerificationServiceAdapter } from "../../infrastructure/adapters/security/signature-verification.adapter";
import { walletRepositoryAdapter } from "../../infrastructure/adapters/repositories/wallet-repository.adapter";
import { query } from "../../database/pool";
import { contextLogger as logger } from "../logging";

/** Gated actions. `account:bind` is consumed optionally by the connect route. */
export type WalletProofAction =
  "bot:start" | "bot:stop" | "bot:resume" | "runs:attach" | "account:bind";

export const WALLET_PROOF_ACTIONS: readonly WalletProofAction[] = [
  "bot:start",
  "bot:stop",
  "bot:resume",
  "runs:attach",
  "account:bind",
];

/** D4: challenge TTL. Single-use — the record is DELed on first consume. */
export const CHALLENGE_TTL_SECONDS = 300;

const CHALLENGE_KEY_PREFIX = "wallet:challenge";

/** Typed 403 (or 503 for REDIS_UNAVAILABLE) reasons, surfaced to the client. */
export type WalletProofErrorCode =
  | "PROOF_REQUIRED"
  | "CHALLENGE_NOT_FOUND"
  | "ACTION_MISMATCH"
  | "INVALID_SIGNATURE"
  | "WALLET_NOT_LINKED"
  | "WALLET_BINDING_MISSING"
  | "WALLET_BINDING_MISMATCH"
  | "REDIS_UNAVAILABLE";

export class WalletProofError extends Error {
  readonly code: WalletProofErrorCode;
  readonly statusCode: number;

  constructor(message: string, code: WalletProofErrorCode) {
    super(message);
    this.name = "WalletProofError";
    this.code = code;
    // Redis is the challenge store AND the bot control plane: an outage there
    // is "try again later" (503), everything else is a definitive proof deny.
    this.statusCode = code === "REDIS_UNAVAILABLE" ? 503 : 403;
  }
}

export interface WalletProof {
  nonce: string;
  address: string;
  signature: string;
}

export interface WalletProofChallenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface VerifiedWalletProof {
  address: string;
}

/** `meta.walletBinding` as written at connect/verify/backfill (X4). */
export interface AccountWalletBinding {
  address: string;
  verifiedAt: string;
  source: "venue";
}

/**
 * D3: the escape hatch. Default ON — only an explicit `false` (also `0`/`no`)
 * disables the gate, so forgetting the variable can never open the gate.
 */
export function walletProofEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = (env.WALLET_PROOF_REQUIRED ?? "").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

/** Server-built message — the client signs this verbatim, nothing else. */
export function buildChallengeMessage(input: {
  action: WalletProofAction;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    "Trade Bot wallet proof",
    "",
    `Action: ${input.action}`,
    `Nonce: ${input.nonce}`,
    `Issued: ${input.issuedAt.toISOString()}`,
    `Expires: ${input.expiresAt.toISOString()}`,
    "",
    "This signature proves you control the linked wallet.",
    "It is not a transaction and will never submit an order or move funds.",
  ].join("\n");
}

/**
 * Issue a challenge for `action`, stored server-side for 300 s.
 * The stored `message` is what `consumeProof` verifies against — the client
 * can never choose or alter the signed payload.
 */
export async function issueChallenge(
  userId: string,
  action: WalletProofAction
): Promise<WalletProofChallenge> {
  const nonce = randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);
  const message = buildChallengeMessage({ action, nonce, issuedAt, expiresAt });

  const stored = await redisService.setex(
    challengeKey(userId, nonce),
    CHALLENGE_TTL_SECONDS,
    JSON.stringify({ action, message, issuedAt: issuedAt.toISOString() })
  );
  if (!stored.success) {
    logger.error("Wallet challenge store failed", new Error(stored.error), {
      userId,
      action,
    });
    throw new WalletProofError(
      "Wallet proof is temporarily unavailable. Please try again.",
      "REDIS_UNAVAILABLE"
    );
  }

  logger.info("Wallet proof challenge issued", { userId, action, nonce });
  return { nonce, message, expiresAt: expiresAt.toISOString() };
}

/**
 * Consume a proof: load the stored challenge (single-use — DELed before the
 * signature check so a burn cannot be retried), verify the signature over the
 * *stored* message, and require the signing address to be one of the user's
 * linked EVM wallets. Every failure is a typed 403 (or 503 on Redis outage).
 */
export async function consumeProof(
  userId: string,
  action: WalletProofAction,
  proof: WalletProof
): Promise<VerifiedWalletProof> {
  const key = challengeKey(userId, proof.nonce);

  const record = await redisService.get(key);
  if (!record.success) {
    throw new WalletProofError(
      "Wallet proof is temporarily unavailable. Please try again.",
      "REDIS_UNAVAILABLE"
    );
  }
  if (!record.data) {
    throw new WalletProofError(
      "This wallet challenge has expired or was already used. Request a new signature.",
      "CHALLENGE_NOT_FOUND"
    );
  }

  let stored: { action?: string; message?: string };
  try {
    stored = JSON.parse(record.data) as { action?: string; message?: string };
  } catch {
    throw new WalletProofError(
      "This wallet challenge is invalid. Request a new signature.",
      "CHALLENGE_NOT_FOUND"
    );
  }

  if (stored.action !== action || typeof stored.message !== "string") {
    throw new WalletProofError(
      "This signature was issued for a different action. Request a new signature.",
      "ACTION_MISMATCH"
    );
  }

  // Single-use (D4): burn the challenge before the expensive checks so the
  // same nonce can never be replayed, even against a slow verify.
  const deleted = await redisService.del(key);
  if (!deleted.success) {
    throw new WalletProofError(
      "Wallet proof is temporarily unavailable. Please try again.",
      "REDIS_UNAVAILABLE"
    );
  }

  const signatureValid =
    await signatureVerificationServiceAdapter.verifySignature(
      proof.address,
      proof.signature,
      stored.message
    );
  if (!signatureValid) {
    throw new WalletProofError(
      "The wallet signature is invalid. Sign the challenge message exactly as issued.",
      "INVALID_SIGNATURE"
    );
  }

  const wallets = await walletRepositoryAdapter.listWallets(userId);
  const linked = wallets.find(
    wallet =>
      wallet.chain === "evm" &&
      wallet.address.toLowerCase() === proof.address.toLowerCase()
  );
  if (!linked) {
    throw new WalletProofError(
      "The signing wallet is not linked to your account. Link it in Settings first.",
      "WALLET_NOT_LINKED"
    );
  }

  logger.info("Wallet proof verified", {
    userId,
    action,
    nonce: proof.nonce,
    address: linked.address,
  });
  return { address: linked.address };
}

/**
 * Binding check against a preloaded `meta` (the /start route already loads
 * the account row). Absent binding is fail-closed (D2): re-verify in Settings.
 */
export function checkWalletBindingAgainstMeta(
  meta: Record<string, unknown> | null | undefined,
  proofAddress: string
): { ok: true } | { ok: false; error: string } {
  const binding = (meta?.walletBinding ??
    null) as Partial<AccountWalletBinding> | null;
  if (!binding?.address) {
    return {
      ok: false,
      error:
        "This account is not bound to a wallet yet. Re-verify the account in Settings to bind your wallet.",
    };
  }
  if (binding.address.toLowerCase() !== proofAddress.toLowerCase()) {
    return {
      ok: false,
      error: `Your signature wallet ${shortAddress(proofAddress)} does not match the wallet bound to this account (${shortAddress(binding.address)}).`,
    };
  }
  return { ok: true };
}

/**
 * Binding check for the bot-keyed routes (stop/resume/runs): one scoped read
 * of the account's `meta`. Missing bot/account rows are left to the route's
 * own 404 path — this only answers "does the binding match the proof?".
 */
export async function checkAccountWalletBinding(
  userId: string,
  proofAddress: string,
  exchangeAccountId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await query<{ meta: Record<string, unknown> | string | null }>(
    `SELECT meta FROM exchange_accounts WHERE id = $1 AND user_id = $2`,
    [exchangeAccountId, userId]
  );
  const raw = result.rows[0]?.meta ?? null;
  let meta: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try {
      meta = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  } else {
    meta = raw;
  }
  return checkWalletBindingAgainstMeta(meta, proofAddress);
}

export const walletProofService = {
  issueChallenge,
  consumeProof,
  checkAccountWalletBinding,
  checkWalletBindingAgainstMeta,
  walletProofEnabled,
};

function challengeKey(userId: string, nonce: string): string {
  return `${CHALLENGE_KEY_PREFIX}:${userId}:${nonce}`;
}

/** Short display form used in user-facing owner-mismatch messages. */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
}
