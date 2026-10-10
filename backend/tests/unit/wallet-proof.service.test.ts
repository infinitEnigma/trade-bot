/** @format */

/**
 * WalletProofService (X4) — challenge issue + single-use consume.
 *
 * Signatures are REAL (ethers.Wallet.signMessage → the real
 * SignatureVerificationServiceAdapter). Only the two external stores are
 * mocked: Redis (an in-memory Map honouring TTL/DEL) and the wallet
 * repository.
 */

import { ethers } from "ethers";

/** Both ethers.Wallet and its HDNodeWallet subclass can sign. */
type Signer = ethers.Wallet | ethers.HDNodeWallet;
import {
  WalletProofError,
  buildChallengeMessage,
  checkWalletBindingAgainstMeta,
  consumeProof,
  issueChallenge,
  walletProofEnabled,
  CHALLENGE_TTL_SECONDS,
} from "../../src/core/wallet/wallet-proof.service";
import { redisService } from "../../src/infrastructure/cache/redis.service";
import { walletRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/wallet-repository.adapter";

jest.mock("../../src/infrastructure/cache/redis.service", () => ({
  redisService: {
    get: jest.fn(),
    getDel: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock("../../src/infrastructure/adapters/repositories/wallet-repository.adapter", () => ({
  walletRepositoryAdapter: { listWallets: jest.fn() },
}));

const USER_ID = "user-123";
const wallet = ethers.Wallet.createRandom();

/** Simple in-memory Redis honouring get/setex/del/getDel. */
function makeRedis(): Map<string, string> {
  const store = new Map<string, string>();
  (redisService.setex as jest.Mock).mockImplementation(
    async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return { success: true };
    }
  );
  (redisService.get as jest.Mock).mockImplementation(async (key: string) => {
    return { success: true, data: store.get(key) ?? null };
  });
  (redisService.del as jest.Mock).mockImplementation(async (key: string) => {
    return { success: true, data: store.delete(key) ? 1 : 0 };
  });
  // Atomic get-and-delete: read then delete synchronously (no await between)
  // so it faithfully models real Redis GETDEL — a concurrent caller that
  // interleaves here can never observe the value after the first caller.
  (redisService.getDel as jest.Mock).mockImplementation(async (key: string) => {
    const value = store.get(key) ?? null;
    if (value !== null) store.delete(key);
    return { success: true, data: value };
  });
  return store;
}

async function sign(message: string, signer: Signer = wallet): Promise<string> {
  return signer.signMessage(message);
}


describe("WalletProofService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WALLET_PROOF_REQUIRED;
    (walletRepositoryAdapter.listWallets as jest.Mock).mockResolvedValue([
      { id: "w1", userId: USER_ID, chain: "evm", address: wallet.address, isPrimary: true },
    ]);
  });

  describe("walletProofEnabled (D3)", () => {
    it("defaults to ON when the variable is unset", () => {
      expect(walletProofEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    });
    it("treats only an explicit false/0/no as OFF", () => {
      expect(walletProofEnabled({ WALLET_PROOF_REQUIRED: "false" } as NodeJS.ProcessEnv)).toBe(false);
      expect(walletProofEnabled({ WALLET_PROOF_REQUIRED: "0" } as NodeJS.ProcessEnv)).toBe(false);
      expect(walletProofEnabled({ WALLET_PROOF_REQUIRED: "no" } as NodeJS.ProcessEnv)).toBe(false);
      expect(walletProofEnabled({ WALLET_PROOF_REQUIRED: "true" } as NodeJS.ProcessEnv)).toBe(true);
      expect(walletProofEnabled({ WALLET_PROOF_REQUIRED: "  False " } as NodeJS.ProcessEnv)).toBe(false);
    });
  });

  describe("issueChallenge", () => {
    it("stores a server-built message for 300s and returns it", async () => {
      makeRedis();
      const challenge = await issueChallenge(USER_ID, "bot:start");
      expect(challenge.nonce).toMatch(/^[0-9a-f-]{36}$/i);
      expect(challenge.message).toContain("Action: bot:start");
      expect(challenge.message).toContain(`Nonce: ${challenge.nonce}`);
      expect(challenge.message).toContain("not a transaction");
      const setexCall = (redisService.setex as jest.Mock).mock.calls[0];
      expect(setexCall[0]).toBe(`wallet:challenge:${USER_ID}:${challenge.nonce}`);
      expect(setexCall[1]).toBe(CHALLENGE_TTL_SECONDS);
    });

    it("fails closed (503) when Redis is down", async () => {
      (redisService.setex as jest.Mock).mockResolvedValue({
        success: false,
        error: "ECONNREFUSED",
      });
      await expect(issueChallenge(USER_ID, "bot:start")).rejects.toMatchObject({
        code: "REDIS_UNAVAILABLE",
        statusCode: 503,
      });
    });
  });

  describe("consumeProof — happy path", () => {
    it("accepts a real signature by a linked wallet and returns its address", async () => {
      makeRedis();
      const challenge = await issueChallenge(USER_ID, "bot:start");
      const signature = await sign(challenge.message);
      const verified = await consumeProof(USER_ID, "bot:start", {
        nonce: challenge.nonce,
        address: wallet.address,
        signature,
      });
      expect(verified.address).toBe(wallet.address);
    });
  });

  describe("consumeProof — single-use (D4)", () => {
    it("rejects a replay with CHALLENGE_NOT_FOUND (403)", async () => {
      makeRedis();
      const challenge = await issueChallenge(USER_ID, "bot:stop");
      const signature = await sign(challenge.message);
      await consumeProof(USER_ID, "bot:stop", {
        nonce: challenge.nonce,
        address: wallet.address,
        signature,
      });
      await expect(
        consumeProof(USER_ID, "bot:stop", {
          nonce: challenge.nonce,
          address: wallet.address,
          signature,
        })
      ).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND", statusCode: 403 });
    });
  });

  describe("consumeProof — failure modes", () => {
    it("rejects a wrong action with ACTION_MISMATCH", async () => {
      makeRedis();
      const challenge = await issueChallenge(USER_ID, "bot:start");
      const signature = await sign(challenge.message);
      await expect(
        consumeProof(USER_ID, "bot:stop", {
          nonce: challenge.nonce,
          address: wallet.address,
          signature,
        })
      ).rejects.toMatchObject({ code: "ACTION_MISMATCH", statusCode: 403 });
    });

    it("rejects an unknown/expired nonce with CHALLENGE_NOT_FOUND", async () => {
      makeRedis();
      await expect(
        consumeProof(USER_ID, "bot:start", {
          nonce: "does-not-exist",
          address: wallet.address,
          signature: "0xsig",
        })
      ).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND", statusCode: 403 });
    });

    it("rejects a bad signature with INVALID_SIGNATURE", async () => {
      makeRedis();
      const challenge = await issueChallenge(USER_ID, "bot:resume");
      await expect(
        consumeProof(USER_ID, "bot:resume", {
          nonce: challenge.nonce,
          address: wallet.address,
          signature: "0xdeadbeef",
        })
      ).rejects.toMatchObject({ code: "INVALID_SIGNATURE", statusCode: 403 });
    });

    it("rejects a signature from a different (unlinked) wallet with WALLET_NOT_LINKED", async () => {
      makeRedis();
      const other = ethers.Wallet.createRandom();
      const challenge = await issueChallenge(USER_ID, "runs:attach");
      const signature = await sign(challenge.message, other);
      await expect(
        consumeProof(USER_ID, "runs:attach", {
          nonce: challenge.nonce,
          address: other.address,
          signature,
        })
      ).rejects.toMatchObject({ code: "WALLET_NOT_LINKED", statusCode: 403 });
    });

    it("fails closed (503) when Redis GETDEL is down", async () => {
      (redisService.getDel as jest.Mock).mockResolvedValue({ success: false });
      await expect(
        consumeProof(USER_ID, "bot:start", {
          nonce: "x",
          address: wallet.address,
          signature: "0x",
        })
      ).rejects.toMatchObject({ code: "REDIS_UNAVAILABLE", statusCode: 503 });
    });

    it("rejects concurrent double-consume: exactly one succeeds (atomic GETDEL)", async () => {
      makeRedis();
      const challenge = await issueChallenge(USER_ID, "runs:attach");
      const signature = await sign(challenge.message);

      // Fire two consumes for the SAME nonce concurrently. Atomic consumption
      // means only the first can observe the stored value; the loser must be
      // rejected with CHALLENGE_NOT_FOUND (403).
      const results = await Promise.allSettled([
        consumeProof(USER_ID, "runs:attach", {
          nonce: challenge.nonce,
          address: wallet.address,
          signature,
        }),
        consumeProof(USER_ID, "runs:attach", {
          nonce: challenge.nonce,
          address: wallet.address,
          signature,
        }),
      ]);

      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason
      ).toMatchObject({ code: "CHALLENGE_NOT_FOUND", statusCode: 403 });
      // The single winner returned the verified linked address.
      expect((fulfilled[0] as PromiseFulfilledResult<{ address: string }>).value
        .address).toBe(wallet.address);
    });
  });

  describe("buildChallengeMessage", () => {
    it("embeds action, nonce and ISO timestamps", () => {
      const msg = buildChallengeMessage({
        action: "bot:start",
        nonce: "abc",
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-01T00:05:00.000Z"),
      });
      expect(msg).toContain("Action: bot:start");
      expect(msg).toContain("Nonce: abc");
      expect(msg).toContain("Issued: 2026-01-01T00:00:00.000Z");
      expect(msg).toContain("Expires: 2026-01-01T00:05:00.000Z");
    });
  });

  describe("checkWalletBindingAgainstMeta (D2, phase 3)", () => {
    it("passes on a case-insensitive match", () => {
      const result = checkWalletBindingAgainstMeta(
        { walletBinding: { address: wallet.address.toLowerCase() } },
        wallet.address.toUpperCase()
      );
      expect(result.ok).toBe(true);
    });
    it("fails closed when the binding is absent", () => {
      expect(checkWalletBindingAgainstMeta({}, wallet.address).ok).toBe(false);
      expect(checkWalletBindingAgainstMeta(null, wallet.address).ok).toBe(false);
    });
    it("fails on a mismatch", () => {
      const other = ethers.Wallet.createRandom();
      const result = checkWalletBindingAgainstMeta(
        { walletBinding: { address: other.address } },
        wallet.address
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("WalletProofError", () => {
    it("maps REDIS_UNAVAILABLE to 503, everything else to 403", () => {
      expect(new WalletProofError("x", "REDIS_UNAVAILABLE").statusCode).toBe(503);
      expect(new WalletProofError("x", "INVALID_SIGNATURE").statusCode).toBe(403);
      expect(new WalletProofError("x", "PROOF_REQUIRED").statusCode).toBe(403);
    });
  });
});

