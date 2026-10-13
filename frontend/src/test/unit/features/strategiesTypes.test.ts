/** @format */

import { describe, it, expect } from "vitest";
import {
  getExchangeAccountForStrategy,
  StrategyRun,
} from "../../../features/strategies/types/strategies.types";

/** One attached run, as the sessions list query returns it (D4). */
const run = (strategyId: string): StrategyRun => ({
  id: "run-1",
  strategy_id: strategyId,
  config_version: 1,
  config: {},
  notional_amount: "100",
  state: "RUNNING",
  last_error_code: null,
});

/**
 * Phase 3 plumbing: strategy → hosting session → bound venue account.
 * The account never lives on the strategy row, so the workspace derives it
 * through the session (`bot_instances.exchange_account_id`, C3a).
 */
describe("getExchangeAccountForStrategy", () => {
  it("resolves the hosting session's bound account", () => {
    const bots = [{ runs: [run("strat-1")], exchange_account_id: "acct-7" }];
    expect(getExchangeAccountForStrategy(bots, "strat-1")).toBe("acct-7");
  });

  it("returns null when the strategy has no hosting session", () => {
    expect(getExchangeAccountForStrategy([], "strat-1")).toBeNull();
  });

  it("returns null when the session predates the account binding", () => {
    const bots = [{ runs: [run("strat-1")] }];
    expect(getExchangeAccountForStrategy(bots, "strat-1")).toBeNull();
  });

  it("does not resolve another strategy's session account", () => {
    const bots = [{ runs: [run("strat-1")], exchange_account_id: "acct-7" }];
    expect(getExchangeAccountForStrategy(bots, "strat-2")).toBeNull();
  });
});
