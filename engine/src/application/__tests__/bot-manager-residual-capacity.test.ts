/** @format */

/**
 * Residual-capacity backstop on the session start path (defense in depth).
 *
 * One fail-closed Model A gate before any strategy init:
 * `Σ|qty×mark| + Σ run.notionalAmount ≤ total_value × SESSION_CAP_LEVERAGE`,
 * read live through the session's own exchange client. These tests script the
 * shared FakeExchange (no live keys) and assert both the happy path and every
 * refuse-to-start failure mode — including that NO runner/strategy is armed on
 * refusal.
 */

import { EngineIdentity } from "../../domain/bot-runtime";
import { BotManager } from "../bot-manager";
import { FakeExchange } from "./helpers/fake-exchange";

jest.mock("../../protocol/credential-fetcher", () => ({
  fetchCredentials: jest.fn(),
}));

jest.mock("../../exchanges/factory", () => ({
  createExchangeClient: jest.fn(),
}));

jest.mock("../../strategies/grid", () => ({
  GridTradingStrategy: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue([]),
    tick: jest.fn().mockResolvedValue(undefined),
    // Report-only exposure estimate (the estimator the engine publishes).
    estimatedRestingNotional: 0,
    isLedgerHalted: jest.fn().mockReturnValue(false),
    ledgerHaltReasonText: jest.fn().mockReturnValue(""),
  })),
}));

import { fetchCredentials } from "../../protocol/credential-fetcher";
import { createExchangeClient } from "../../exchanges/factory";
import { GridTradingStrategy } from "../../strategies/grid";
import { CommandError } from "../command-error";
import type { EngineCredentials } from "@trade-bot/shared";

const fetchCredentialsMock = fetchCredentials as jest.Mock;
const createExchangeClientMock = createExchangeClient as jest.Mock;
const gridConstructMock = GridTradingStrategy as unknown as jest.Mock;

/** Every manager built via makeManager(), torn down in afterEach. */
const managers: BotManager[] = [];

const KODIAK: EngineCredentials = {
  exchange: "kodiak",
  environment: "testnet",
  accountRef: "0xabc",
  credentials: {
    accountId: "0xabc",
    accessKey: "key",
    secretKey: "secret",
  },
};

const RUN_CONFIG = {
  symbol: "ETH",
  gridSize: 3,
  gridRange: 5,
  orderQuantity: 1,
};

function makeStreamOps(): {
  published: Array<{ type: string; payload: Record<string, unknown> }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ops: any;
} {
  const published: Array<{ type: string; payload: Record<string, unknown> }> =
    [];
  const ops = {
    publish: jest.fn(
      async (_stream: string, message: Record<string, unknown>) => {
        published.push({
          type: String(message.type),
          payload: (message.payload ?? {}) as Record<string, unknown>,
        });
        return { success: true as const };
      }
    ),
  };
  return { published, ops };
}

function makeManager(): BotManager {
  const manager = new BotManager({
    engineId: "engine-1",
    epoch: 1,
  } as EngineIdentity);
  managers.push(manager);
  return manager;
}

/** Scripted venue: healthy account/positions defaults a test can retune. */
function makeFake(totalValue: number): FakeExchange {
  const fake = new FakeExchange();
  fake.accountInfo = { total_value: totalValue, max_leverage: 50 };
  fake.positions = [];
  return fake;
}

function runsOf(...notionals: number[]): Array<{
  runId: string;
  strategyId: string;
  configVersion: number;
  config: Record<string, unknown>;
  notionalAmount: number;
}> {
  return notionals.map((notionalAmount, i) => ({
    runId: `run-${i}`,
    strategyId: `strat-${i}`,
    configVersion: 1,
    config: RUN_CONFIG,
    notionalAmount,
  }));
}

describe("BotManager residual-capacity backstop (engine Model A gate)", () => {
  const originalLeverage = process.env.SESSION_CAP_LEVERAGE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SESSION_CAP_LEVERAGE;
    fetchCredentialsMock.mockResolvedValue(KODIAK);
  });

  afterEach(() => {
    // See bot-manager-credentials.test.ts: a successful start arms
    // self-rescheduling tick runners; stop them all or Jest never exits.
    for (const manager of managers) {
      for (const runtime of manager.getBotRuntimes().values()) {
        runtime.stopTick();
        if (runtime.runs) {
          for (const [, run] of runtime.runs) {
            if (run.stopTick !== runtime.stopTick) run.stopTick();
          }
        }
      }
      manager.getBotRuntimes().clear();
    }
    managers.length = 0;
    if (originalLeverage === undefined) delete process.env.SESSION_CAP_LEVERAGE;
    else process.env.SESSION_CAP_LEVERAGE = originalLeverage;
  });

  it("starts when exposure + session notionals fit the cap (boundary == cap)", async () => {
    // cap = 100 × 10 = 1000; exposure = 0.2 × 2000 + 2 × 100 = 600;
    // requested = 200 + 200 = 400 → 1000 == cap admits.
    const fake = makeFake(100);
    fake.positions = [
      { symbol: "ETH", position_qty: 0.2, mark_price: 2000 },
      { symbol: "ALT", position_qty: -2, mark_price: 100 },
    ];
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await manager.handleStart(
      ops,
      "bot-1",
      "user-1",
      "strat-1",
      RUN_CONFIG,
      "corr-1",
      runsOf(200, 200)
    );

    // Pre-admission safety: the backstop admits the PREPARATION, but no run
    // is registered and no tick runner is armed until BOT_AUTHORIZE.
    expect(manager.hasBot("bot-1")).toBe(false);
    expect(
      published.filter(
        e => e.type === "STATE_CHANGED" && e.payload.to === "PREPARED"
      )
    ).toHaveLength(1);
    // The backstop ran exactly one account + one positions read.
    expect(fake.count("getAccountInfo")).toBe(1);
    expect(fake.count("getPositions")).toBe(1);
    expect(gridConstructMock).toHaveBeenCalledTimes(2);

    // The matching authorization starts execution.
    await manager.authorizeStart(
      ops,
      "bot-1",
      "user-1",
      "strat-1",
      "run-0",
      1,
      "corr-auth"
    );
    expect(manager.hasBot("bot-1")).toBe(true);
    expect(
      published.filter(
        e => e.type === "STATE_CHANGED" && e.payload.to === "RUNNING"
      )
    ).toHaveLength(1);
  });

  it("refuses to start when venue exposure has already eaten the headroom", async () => {
    // cap = 1000; exposure = 600; requested = 500 → 1100 > 1000 refuses.
    const fake = makeFake(100);
    fake.positions = [
      { symbol: "ETH", position_qty: 0.2, mark_price: 2000 },
      { symbol: "ALT", position_qty: -2, mark_price: 100 },
    ];
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        ops,
        "bot-1",
        "user-1",
        "strat-1",
        RUN_CONFIG,
        "corr-1",
        runsOf(500)
      )
    ).rejects.toMatchObject({ name: "CommandError", retryable: false });

    // Control-plane path: COMMAND_FAILED + STARTING→ERROR, ops-readable msg.
    const failed = published.filter(e => e.type === "COMMAND_FAILED");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].payload.message)).toMatch(
      /Engine residual capacity exceeded/
    );
    expect(
      published.filter(
        e => e.type === "STATE_CHANGED" && e.payload.to === "ERROR"
      )
    ).toHaveLength(1);
    // No partial start: no bot registered, no strategy constructed, no orders.
    expect(manager.hasBot("bot-1")).toBe(false);
    expect(gridConstructMock).not.toHaveBeenCalled();
    expect(fake.created).toHaveLength(0);
  });

  it("refuses (fail-closed) when the positions read fails", async () => {
    const fake = makeFake(100000);
    fake.fail("getPositions", new Error("venue down"));
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        ops,
        "bot-1",
        "user-1",
        "strat-1",
        RUN_CONFIG,
        "corr-1",
        runsOf(400)
      )
    ).rejects.toBeInstanceOf(CommandError);

    expect(published.filter(e => e.type === "COMMAND_FAILED")).toHaveLength(1);
    expect(manager.hasBot("bot-1")).toBe(false);
    expect(gridConstructMock).not.toHaveBeenCalled();
  });

  it("refuses (fail-closed) when the account-info read fails", async () => {
    const fake = makeFake(100000);
    fake.fail("getAccountInfo", new Error("venue down"));
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        ops,
        "bot-1",
        "user-1",
        "strat-1",
        RUN_CONFIG,
        "corr-1",
        runsOf(400)
      )
    ).rejects.toMatchObject({ name: "CommandError", retryable: false });

    expect(published.filter(e => e.type === "COMMAND_FAILED")).toHaveLength(1);
    expect(manager.hasBot("bot-1")).toBe(false);
  });

  it("allows an empty book: exposure 0, requested alone ≤ cap", async () => {
    // cap = 100000 × 10; no positions; requested 900 fits.
    const fake = makeFake(100000);
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { ops } = makeStreamOps();
    await manager.handleStart(
      ops,
      "bot-1",
      "user-1",
      "strat-1",
      RUN_CONFIG,
      "corr-1",
      runsOf(900)
    );
    // Preparation only — execution waits for BOT_AUTHORIZE.
    expect(manager.hasBot("bot-1")).toBe(false);
    await manager.authorizeStart(
      ops,
      "bot-1",
      "user-1",
      "strat-1",
      "run-0",
      1,
      "corr-auth"
    );
    expect(manager.hasBot("bot-1")).toBe(true);
  });

  it("refuses when an open position carries an invalid mark price", async () => {
    const fake = makeFake(100000);
    fake.positions = [{ symbol: "ETH", position_qty: 1, mark_price: 0 }];
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        ops,
        "bot-1",
        "user-1",
        "strat-1",
        RUN_CONFIG,
        "corr-1",
        runsOf(400)
      )
    ).rejects.toMatchObject({ name: "CommandError", retryable: false });

    const failed = published.filter(e => e.type === "COMMAND_FAILED");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].payload.message)).toMatch(/invalid mark price/);
    expect(manager.hasBot("bot-1")).toBe(false);
  });

  it("refuses when SESSION_CAP_LEVERAGE env is invalid (fail-closed at start)", async () => {
    process.env.SESSION_CAP_LEVERAGE = "abc";
    const fake = makeFake(100000);
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        ops,
        "bot-1",
        "user-1",
        "strat-1",
        RUN_CONFIG,
        "corr-1",
        runsOf(400)
      )
    ).rejects.toMatchObject({ name: "CommandError", retryable: false });

    const failed = published.filter(e => e.type === "COMMAND_FAILED");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].payload.message)).toMatch(/SESSION_CAP_LEVERAGE/);
    // Pure inputs resolve BEFORE the venue reads — no round-trip happened.
    expect(fake.count("getAccountInfo")).toBe(0);
    expect(fake.count("getPositions")).toBe(0);
  });

  it("refuses when runs are present without a positive notional (fail-closed)", async () => {
    const fake = makeFake(100000);
    createExchangeClientMock.mockReturnValue(fake);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        ops,
        "bot-1",
        "user-1",
        "strat-1",
        RUN_CONFIG,
        "corr-1",
        runsOf(0)
      )
    ).rejects.toMatchObject({ name: "CommandError", retryable: false });

    const failed = published.filter(e => e.type === "COMMAND_FAILED");
    expect(failed).toHaveLength(1);
    expect(String(failed[0].payload.message)).toMatch(
      /missing or non-positive notional/
    );
    expect(manager.hasBot("bot-1")).toBe(false);
  });

  it("gates a legacy payload (no runs[]) on live exposure only", async () => {
    // Legacy start declares no notional → requested 0. Over-cap exposure
    // still refuses; a healthy book still starts.
    const overCap = makeFake(100); // cap 1000
    overCap.positions = [
      { symbol: "ETH", position_qty: 1, mark_price: 1000 },
      { symbol: "ALT", position_qty: 1, mark_price: 1 }, // exposure 1001 > 1000
    ];
    createExchangeClientMock.mockReturnValue(overCap);

    const manager = makeManager();
    const { published, ops } = makeStreamOps();
    await expect(
      manager.handleStart(
        ops,
        "bot-1",
        "user-1",
        "strat-1",
        RUN_CONFIG,
        "corr-1"
      )
    ).rejects.toMatchObject({ name: "CommandError", retryable: false });
    expect(published.filter(e => e.type === "COMMAND_FAILED")).toHaveLength(1);
    expect(manager.hasBot("bot-1")).toBe(false);

    const healthy = makeFake(100000);
    createExchangeClientMock.mockReturnValue(healthy);
    await manager.handleStart(
      ops,
      "bot-2",
      "user-1",
      "strat-1",
      RUN_CONFIG,
      "corr-2"
    );
    // Preparation only — execution waits for BOT_AUTHORIZE. A legacy
    // payload (no runs[]) keys the prepared run by the strategy id.
    expect(manager.hasBot("bot-2")).toBe(false);
    await manager.authorizeStart(
      ops,
      "bot-2",
      "user-1",
      "strat-1",
      "strat-1",
      1,
      "corr-2-auth"
    );
    expect(manager.hasBot("bot-2")).toBe(true);
  });
});
