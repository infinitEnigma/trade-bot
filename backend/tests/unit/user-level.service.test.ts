/** @format */

/**
 * UserLevelService (C2) — the single owner of BASIC → REGISTERED → VERIFIED.
 *
 * The pure matrix (`computeUserLevel`) is asserted directly; `recompute`
 * adds the persistence + audit contract on top.
 */

import { UserLevel } from "@trade-bot/shared";
import {
  UserLevelService,
  computeUserLevel,
  UserLevelServiceDeps,
} from "../../src/core/auth/user-level.service";

describe("computeUserLevel", () => {
  it("should return BASIC with no wallet and no account", () => {
    expect(
      computeUserLevel({ verifiedWallets: 0, activeAccounts: 0 })
    ).toBe(UserLevel.BASIC);
  });

  it("should return REGISTERED with a verified wallet only", () => {
    expect(
      computeUserLevel({ verifiedWallets: 1, activeAccounts: 0 })
    ).toBe(UserLevel.REGISTERED);
  });

  it("should return VERIFIED with any ACTIVE exchange account", () => {
    expect(
      computeUserLevel({ verifiedWallets: 0, activeAccounts: 1 })
    ).toBe(UserLevel.VERIFIED);
  });

  it("should stay VERIFIED when both wallets and accounts exist", () => {
    expect(
      computeUserLevel({ verifiedWallets: 3, activeAccounts: 2 })
    ).toBe(UserLevel.VERIFIED);
  });

  it("should treat a single verified wallet among many as REGISTERED", () => {
    expect(
      computeUserLevel({ verifiedWallets: 5, activeAccounts: 0 })
    ).toBe(UserLevel.REGISTERED);
  });
});

function createDeps(
  overrides: Partial<UserLevelServiceDeps> = {}
): UserLevelServiceDeps {
  return {
    walletRepository: { countVerified: jest.fn().mockResolvedValue(0) },
    exchangeAccountRepository: { countActive: jest.fn().mockResolvedValue(0) },
    userRepository: {
      findById: jest.fn().mockResolvedValue({ userLevel: UserLevel.BASIC }),
      updateUserLevel: jest.fn().mockResolvedValue(true),
    },
    auditLogRepository: { logEvent: jest.fn().mockResolvedValue(undefined) },
    logger: { info: jest.fn(), warn: jest.fn() },
    ...overrides,
  };
}

describe("UserLevelService.recompute", () => {
  it("should not write when the level is unchanged", async () => {
    const deps = createDeps({
      walletRepository: { countVerified: jest.fn().mockResolvedValue(1) },
      userRepository: {
        findById: jest.fn().mockResolvedValue({ userLevel: UserLevel.REGISTERED }),
        updateUserLevel: jest.fn().mockResolvedValue(true),
      },
    });
    const service = new UserLevelService(deps);

    const level = await service.recompute("test-user-id");

    expect(level).toBe(UserLevel.REGISTERED);
    expect(deps.userRepository.updateUserLevel).not.toHaveBeenCalled();
    expect(deps.auditLogRepository?.logEvent).not.toHaveBeenCalled();
  });

  it("should persist and audit a promotion", async () => {
    const deps = createDeps({
      exchangeAccountRepository: {
        countActive: jest.fn().mockResolvedValue(1),
      },
      userRepository: {
        findById: jest.fn().mockResolvedValue({ userLevel: UserLevel.REGISTERED }),
        updateUserLevel: jest.fn().mockResolvedValue(true),
      },
    });
    const service = new UserLevelService(deps);

    const level = await service.recompute("test-user-id");

    expect(level).toBe(UserLevel.VERIFIED);
    expect(deps.userRepository.updateUserLevel).toHaveBeenCalledWith(
      "test-user-id",
      UserLevel.VERIFIED
    );
    expect(deps.auditLogRepository?.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_LEVEL_RECOMPUTED" })
    );
  });

  it("should persist a downgrade to BASIC after the last wallet is unlinked", async () => {
    const deps = createDeps({
      userRepository: {
        findById: jest.fn().mockResolvedValue({ userLevel: UserLevel.VERIFIED }),
        updateUserLevel: jest.fn().mockResolvedValue(true),
      },
    });
    const service = new UserLevelService(deps);

    const level = await service.recompute("test-user-id");

    expect(level).toBe(UserLevel.BASIC);
    expect(deps.userRepository.updateUserLevel).toHaveBeenCalledWith(
      "test-user-id",
      UserLevel.BASIC
    );
  });

  it("should skip persistence when the user no longer exists", async () => {
    const deps = createDeps({
      userRepository: {
        findById: jest.fn().mockResolvedValue(null),
        updateUserLevel: jest.fn().mockResolvedValue(true),
      },
    });
    const service = new UserLevelService(deps);

    const level = await service.recompute("test-user-id");

    expect(level).toBe(UserLevel.BASIC);
    expect(deps.userRepository.updateUserLevel).not.toHaveBeenCalled();
  });

  it("should not fail the transition when auditing fails", async () => {
    const deps = createDeps({
      walletRepository: { countVerified: jest.fn().mockResolvedValue(1) },
      auditLogRepository: {
        logEvent: jest.fn().mockRejectedValue(new Error("audit down")),
      },
    });
    const service = new UserLevelService(deps);

    const level = await service.recompute("test-user-id");

    expect(level).toBe(UserLevel.REGISTERED);
    expect(deps.logger?.warn).toHaveBeenCalled();
  });
});
