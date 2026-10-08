/**
 * `syncStrategyActive` — the `strategies.active` badge sync (Phase 2).
 *
 * Contract pinned here:
 * - absent/empty strategy id → no-op (never touches the repository);
 * - otherwise the flag is flipped to the requested value;
 * - a repository failure is logged as a warning and NEVER propagates —
 *   the badge is presentation, the bot lifecycle is the source of truth.
 *
 * @format
 */

jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock(
  "../../src/infrastructure/adapters/repositories/strategy-repository.adapter",
  () => ({
    strategyRepositoryAdapter: {
      toggleStrategy: jest.fn(),
    },
  })
);

import {
  syncStrategyActive,
  syncSessionStrategiesActive,
} from "../../src/core/bots/lifecycle/strategy-active-sync";
import { strategyRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/strategy-repository.adapter";
import { contextLogger } from "../../src/core/logging";

const toggleStrategy = strategyRepositoryAdapter.toggleStrategy as jest.Mock;
const warn = contextLogger.warn as jest.Mock;

const STRATEGY_ID = "3f1c9a2e-6b7d-4c8f-9a1b-2d3e4f5a6b7c";

describe("syncStrategyActive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    toggleStrategy.mockResolvedValue(undefined);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("is a no-op for a %s strategy id", async (_label, id) => {
    await expect(syncStrategyActive(id, true)).resolves.toBeUndefined();
    expect(toggleStrategy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("flips the badge on for a running strategy", async () => {
    await syncStrategyActive(STRATEGY_ID, true);
    expect(toggleStrategy).toHaveBeenCalledTimes(1);
    expect(toggleStrategy).toHaveBeenCalledWith(STRATEGY_ID, true);
  });

  it("flips the badge off when the run ends", async () => {
    await syncStrategyActive(STRATEGY_ID, false);
    expect(toggleStrategy).toHaveBeenCalledWith(STRATEGY_ID, false);
  });

  it("swallows a repository failure and warns (never fails the lifecycle op)", async () => {
    toggleStrategy.mockRejectedValue(new Error("db down"));

    await expect(
      syncStrategyActive(STRATEGY_ID, true)
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Failed to sync strategy active flag",
      expect.objectContaining({
        strategyId: STRATEGY_ID,
        active: true,
        error: "db down",
      })
    );
  });

  it("stringifies a non-Error rejection for the warning context", async () => {
    toggleStrategy.mockRejectedValue("boom");

    await expect(
      syncStrategyActive(STRATEGY_ID, false)
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "Failed to sync strategy active flag",
      expect.objectContaining({
        strategyId: STRATEGY_ID,
        active: false,
        error: "boom",
      })
    );
  });
});

describe("syncSessionStrategiesActive (022 shim-drop)", () => {
  const runs = [
    { strategy_id: "strat-1" },
    { strategy_id: "strat-2" },
    { strategy_id: "strat-1" },
  ];
  const repository = {
    getRunsForBot: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    toggleStrategy.mockResolvedValue(undefined);
    repository.getRunsForBot.mockResolvedValue(runs);
  });

  it("fans the badge to every distinct run strategy", async () => {
    await syncSessionStrategiesActive(repository, "bot-1", true);

    expect(repository.getRunsForBot).toHaveBeenCalledWith("bot-1");
    expect(toggleStrategy).toHaveBeenCalledTimes(2);
    expect(toggleStrategy).toHaveBeenCalledWith("strat-1", true);
    expect(toggleStrategy).toHaveBeenCalledWith("strat-2", true);
  });

  it("warns and skips the badge when the runs lookup fails (never throws)", async () => {
    repository.getRunsForBot.mockRejectedValue(new Error("db down"));

    await expect(
      syncSessionStrategiesActive(repository, "bot-1", false)
    ).resolves.toBeUndefined();

    expect(toggleStrategy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Failed to load session runs for badge sync",
      expect.objectContaining({ botId: "bot-1", active: false })
    );
  });
});
