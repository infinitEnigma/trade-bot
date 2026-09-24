/**
 * UserLevelService (C2) — single owner of BASIC → REGISTERED → VERIFIED.
 *
 * Replaces the ad-hoc legacy credentials join in getAuthenticatedUserData:
 * - BASIC: identity only (no verified wallet).
 * - REGISTERED: ≥1 verified wallet.
 * - VERIFIED: ≥1 ACTIVE exchange account (implies a wallet, since accounts
 *   can only be connected by REGISTERED+ users).
 *
 * Level is still stored on users.user_level (JWT + middleware read it), but
 * every transition goes through recompute() so wallet/account changes and
 * the stored level can never drift apart.
 *
 * @format
 */

import { UserLevel } from "@trade-bot/shared";

export interface UserLevelInputs {
  verifiedWallets: number;
  activeAccounts: number;
}

/** Pure decision — unit-tested without a database. */
export function computeUserLevel(inputs: UserLevelInputs): UserLevel {
  if (inputs.activeAccounts > 0) return UserLevel.VERIFIED;
  if (inputs.verifiedWallets > 0) return UserLevel.REGISTERED;
  return UserLevel.BASIC;
}

export interface UserLevelServiceDeps {
  walletRepository: { countVerified(userId: string): Promise<number> };
  exchangeAccountRepository: { countActive(userId: string): Promise<number> };
  userRepository: {
    findById(id: string): Promise<{ userLevel: UserLevel } | null>;
    updateUserLevel(id: string, level: UserLevel): Promise<boolean>;
  };
  auditLogRepository?: {
    logEvent(event: {
      userId: string | null;
      action: string;
      details: Record<string, unknown>;
    }): Promise<void>;
  };
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

export class UserLevelService {
  constructor(private deps: UserLevelServiceDeps) {}

  /**
   * Recompute from wallets/accounts and persist when changed.
   * Returns the (possibly unchanged) level.
   */
  async recompute(userId: string): Promise<UserLevel> {
    const [verifiedWallets, activeAccounts] = await Promise.all([
      this.deps.walletRepository.countVerified(userId),
      this.deps.exchangeAccountRepository.countActive(userId),
    ]);
    const next = computeUserLevel({ verifiedWallets, activeAccounts });
    const current = await this.deps.userRepository.findById(userId);
    if (!current) return next;
    if (current.userLevel === next) return next;
    await this.deps.userRepository.updateUserLevel(userId, next);
    this.deps.logger?.info("User level recomputed", {
      userId,
      previousLevel: current.userLevel,
      newLevel: next,
      verifiedWallets,
      activeAccounts,
    });
    try {
      await this.deps.auditLogRepository?.logEvent({
        userId,
        action: "USER_LEVEL_RECOMPUTED",
        details: {
          previousLevel: current.userLevel,
          newLevel: next,
          verifiedWallets,
          activeAccounts,
        },
      });
    } catch {
      this.deps.logger?.warn("Failed to audit level recompute", { userId });
    }
    return next;
  }
}
