/**
 * L21 + L24 regression suite: command-resolution authority and terminal-state
 * stop repair.
 *
 * L21 - a command the engine answered must never be timed out:
 * the engine-authority check compared `engine_registry.epoch` (BIGINT, returned
 * by node-postgres as the string "19") with the engine's `engineEpoch` (JSON
 * number 19) using `!==`. That rejected EVERY runtime event, so accepts and
 * failures were dropped, the tracked command stayed PENDING, and the sweep
 * "timed out" a command the engine had answered - reporting a healthy engine
 * as ENGINE_NO_RESPONSE. BOT_STOP made it worse: the engine published no accept
 * for stops at all, so even a *successful* stop was burned as
 * COMMAND_NEVER_DELIVERED.
 *
 * L24 - a timeout is backend bookkeeping only:
 * the engine kept placing and filling orders for a bot the backend had marked
 * ERROR, and exposure ended only on a manual stop. A bot the authority declares
 * terminal must now be stopped on the engine side too.
 *
 * The suite drives the real service/repository/dispatcher against a small
 * in-memory fake of the two tables involved (`bot_commands`, `bot_instances`)
 * so the "answered command is never timed out" and "a timed-out start leaves no
 * live engine runner" invariants are exercised end to end.
 *
 * @format
 */

import { createBotEvent } from "@trade-bot/shared";
import { BotLifecycleService } from "../../src/core/bots/bot-lifecycle.service";
import { EngineProtocolService } from "../../src/core/bots/engine-protocol.service";
import {
  BOT_COMMAND_TIMEOUT_MS,
  MAX_STOP_REISSUES_PER_HOUR,
} from "../../src/core/bots/lifecycle/types";
import { strategyRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/strategy-repository.adapter";

jest.mock("../../src/database/pool", () => {
  const actual = { query: jest.fn() };
  return {
    ...actual,
    transaction: jest.fn(async (cb: (client: { query: unknown }) => unknown) => {
      const client = {
        query: (text: string, params?: unknown[]) => actual.query(text, params),
      };
      return cb(client);
    }),
    getClient: jest.fn(),
  };
});
jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { query } from "../../src/database/pool";

const mockQuery = query as jest.Mock;

/** A row of the fake `bot_commands` table. */
interface FakeCommand {
  correlation_id: string;
  bot_id: string;
  command_type: string;
  state: string;
  expires_at: number;
}

/** A row of the fake `bot_instances` table (single bot per test, 022: no strategy_id). */
interface FakeBot {
  id: string;
  user_id: string;
  status: string;
  desired_state: string;
  actual_state: string;
  engine_id: string | null;
  exchange_account_id: string | null;
}

const BOT_ID = "bot-1";
const ENGINE_ID = "engine-1";
const ENGINE_EPOCH = 19;

describe("lifecycle command authority (L21) & terminal stop repair (L24)", () => {
  let service: BotLifecycleService;
  let engineProtocol: { sendCommand: jest.Mock };
  let bot: FakeBot;
  let commands: Map<string, FakeCommand>;
  let lifecycleEvents: {
    event_type: string;
    metadata: Record<string, unknown>;
  }[];
  let now: number;

  beforeEach(() => {
    jest.clearAllMocks();
    now = 1_700_000_000_000;
    commands = new Map();
    lifecycleEvents = [];
    bot = {
      id: BOT_ID,
      user_id: "user-1",
      status: "STOPPED",
      desired_state: "STOPPED",
      actual_state: "STOPPED",
      engine_id: ENGINE_ID,
      exchange_account_id: "acc-1",
    };

    engineProtocol = {
      sendCommand: jest
        .fn()
        .mockImplementation(
          (_type: string, _payload: unknown, correlationId: string) =>
            Promise.resolve({
              success: true,
              messageId: `msg-${correlationId}`,
              correlationId,
            })
        ),
    };
    jest
      .spyOn(strategyRepositoryAdapter, "toggleStrategy")
      .mockResolvedValue(undefined);

    installFakeDb();
    service = new BotLifecycleService(
      engineProtocol as unknown as EngineProtocolService
    );
    // Permissive authority checker: authority itself is covered by the
    // engine-registry suite (including the BIGINT string epoch regression).
    service.setAuthorityChecker(async () => true);
    // F1: permissive cap so the L21/L24 command flow is unaffected.
    service.setSessionCapProvider({
      getSessionCap: async () => Number.MAX_SAFE_INTEGER,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Ids of the commands of a given type that were published to the engine. */
  function dispatched(type: string): string[] {
    return engineProtocol.sendCommand.mock.calls
      .filter(call => call[0] === type)
      .map(call => call[2] as string);
  }

  /** Engine event for this bot, carrying the engine identity + epoch. */
  function engineEvent(
    type: "COMMAND_ACCEPTED" | "COMMAND_FAILED" | "STATE_CHANGED",
    payload: Record<string, unknown>,
    correlationId: string
  ) {
    return createBotEvent(
      type,
      {
        botId: BOT_ID,
        engineId: ENGINE_ID,
        engineEpoch: ENGINE_EPOCH,
        ...payload,
      } as never,
      correlationId
    );
  }

  /**
   * In-memory fake of the lifecycle persistence this flow touches: command
   * tracking (INSERT / PENDING-guarded UPDATE / CAS claim), the
   * `bot_instances` compare-and-set transition, and the session runs
   * lookup (022: badge + dispatch read the runs).
   */
  function installFakeDb(): void {
    mockQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql);

      if (text.includes("INSERT INTO bot_commands")) {
        const [correlationId, botId, commandType, timeoutSeconds] = params as [
          string,
          string,
          string,
          number,
        ];
        if (!commands.has(correlationId)) {
          commands.set(correlationId, {
            correlation_id: correlationId,
            bot_id: botId,
            command_type: commandType,
            state: "PENDING",
            expires_at: now + Number(timeoutSeconds) * 1000,
          });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (text.includes("SELECT bot_id, state FROM bot_commands")) {
        const row = commands.get(params[0] as string);
        return Promise.resolve({
          rows: row ? [{ bot_id: row.bot_id, state: row.state }] : [],
        });
      }

      if (
        text.includes("UPDATE bot_commands") &&
        text.includes("state = 'TIMED_OUT'")
      ) {
        const row = commands.get(params[0] as string);
        if (!row || row.state !== "PENDING") {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        row.state = "TIMED_OUT";
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (text.includes("UPDATE bot_commands") && text.includes("state = $2")) {
        const [correlationId, state] = params as [string, string];
        const row = commands.get(correlationId);
        if (!row || row.state !== "PENDING") {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        row.state = state;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (text.startsWith("SELECT") && text.includes("FROM bot_commands")) {
        const expired = [...commands.values()]
          .filter(row => row.state === "PENDING" && row.expires_at <= now)
          .map(row => ({
            correlation_id: row.correlation_id,
            bot_id: row.bot_id,
            command_type: row.command_type,
          }));
        return Promise.resolve({ rows: expired });
      }

      if (text.includes("COUNT(*)") && text.includes("bot_lifecycle_events")) {
        const count = lifecycleEvents.filter(
          event => event.event_type === "RECONCILE_STOP_REISSUED"
        ).length;
        return Promise.resolve({ rows: [{ count: String(count) }] });
      }

      if (text.includes("INSERT INTO bot_lifecycle_events")) {
        lifecycleEvents.push({
          event_type: params[1] as string,
          metadata: JSON.parse(params[6] as string) as Record<string, unknown>,
        });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (text.includes("UPDATE bot_instances")) {
        // Compare-and-set: only the writer that read the current state wins.
        const expected = text.includes("AND actual_state = $11")
          ? (params[10] as string)
          : undefined;
        if (expected !== undefined && expected !== bot.actual_state) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        bot.desired_state = params[1] as string;
        bot.actual_state = params[2] as string;
        bot.status = params[3] as string;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (text.startsWith("SELECT id, user_id")) {
        if (text.includes("actual_state = 'RUNNING'")) {
          return Promise.resolve({
            rows: bot.actual_state === "RUNNING" ? [{ ...bot }] : [],
          });
        }
        return Promise.resolve({ rows: [{ ...bot }] });
      }

      // F1 sum grain — match before the generic strategy_runs read.
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total: "0" }] });
      }

      // 022 shim-drop: session runs (start dispatch + badge sync).
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({
          rows: [
            {
              id: "run-1",
              bot_id: BOT_ID,
              strategy_id: "strat-1",
              config_version: 1,
              config: {},
              notional_amount: "1000",
              state: bot.actual_state,
              last_error_code: null,
              created_at: "",
              updated_at: "",
            },
          ],
        });
      }

      return Promise.resolve({ rows: [], rowCount: 1 });
    });
  }

  // ===========================================
  // L21: an answered command is never timed out
  // ===========================================

  it("keeps the tracked command PENDING until the engine answers", async () => {
    await service.start(BOT_ID, "user-1");

    const correlationId = dispatched("BOT_START")[0];
    const row = commands.get(correlationId);
    expect(row).toMatchObject({
      bot_id: BOT_ID,
      command_type: "BOT_START",
      state: "PENDING",
    });
    // Tracked BEFORE publishing, so a fast engine cannot race the insert.
    expect(row!.expires_at).toBe(now + BOT_COMMAND_TIMEOUT_MS);
    expect(engineProtocol.sendCommand).toHaveBeenCalledTimes(1);
  });

  it("resolves the command on COMMAND_ACCEPTED so the sweep never times it out", async () => {
    await service.start(BOT_ID, "user-1");
    const correlationId = dispatched("BOT_START")[0];

    await service.handleEngineEvent(
      engineEvent(
        "COMMAND_ACCEPTED",
        { commandType: "BOT_START" },
        correlationId
      )
    );
    expect(commands.get(correlationId)?.state).toBe("ACCEPTED");

    // The engine then confirms the transition and the bot reaches RUNNING.
    await service.handleEngineEvent(
      engineEvent(
        "STATE_CHANGED",
        { from: "STARTING", to: "RUNNING" },
        correlationId
      )
    );
    expect(bot.actual_state).toBe("RUNNING");

    // Long past the command expiry: nothing to time out, nothing to stop.
    now += 10 * 60_000;
    expect(await service.sweepTimedOutCommands()).toBe(0);
    expect(bot.actual_state).toBe("RUNNING");
    expect(dispatched("BOT_STOP")).toHaveLength(0);
  });

  it("resolves the command on COMMAND_FAILED so the sweep never times it out", async () => {
    await service.start(BOT_ID, "user-1");
    const correlationId = dispatched("BOT_START")[0];

    await service.handleEngineEvent(
      engineEvent(
        "COMMAND_FAILED",
        {
          commandType: "BOT_START",
          errorCode: "INIT_FAILED",
          message: "boom",
        },
        correlationId
      )
    );

    expect(commands.get(correlationId)?.state).toBe("FAILED");
    expect(bot.actual_state).toBe("ERROR");

    now += 10 * 60_000;
    expect(await service.sweepTimedOutCommands()).toBe(0);
    // A failed start never ran a runner, so no stop repair is dispatched.
    expect(dispatched("BOT_STOP")).toHaveLength(0);
  });

  it("resolves a BOT_STOP row on the engine's accept (stops are ACKed too)", async () => {
    bot.desired_state = "RUNNING";
    bot.actual_state = "RUNNING";

    await service.stop(BOT_ID, "user-1");
    const stopId = dispatched("BOT_STOP")[0];
    expect(commands.get(stopId)?.state).toBe("PENDING");

    await service.handleEngineEvent(
      engineEvent("COMMAND_ACCEPTED", { commandType: "BOT_STOP" }, stopId)
    );
    expect(commands.get(stopId)?.state).toBe("ACCEPTED");

    now += 10 * 60_000;
    expect(await service.sweepTimedOutCommands()).toBe(0);
    expect(dispatched("BOT_STOP")).toHaveLength(1);
  });

  // ===========================================
  // L25: a failure report for a terminal bot is bookkeeping, not a transition
  // ===========================================

  it("applies COMMAND_FAILED for an already-STOPPED bot without an illegal transition (L25)", async () => {
    // Live shape (2026-09-28 20:29): desired RUNNING / actual STOPPED after a
    // heartbeat drift, then a stop. The engine has no runner left and answers
    // BOT_NOT_FOUND; the backend must not apply the illegal STOPPED -> ERROR,
    // which used to throw, leave the event unacked and redeliver it forever.
    bot.desired_state = "RUNNING";
    bot.actual_state = "STOPPED";

    await service.stop(BOT_ID, "user-1");
    const stopId = dispatched("BOT_STOP")[0];
    expect(bot.actual_state).toBe("STOPPED");

    // If the failure report were still applied as a transition this would
    // reject with InvalidStateTransitionError (the L25 redelivery loop).
    await service.handleEngineEvent(
      engineEvent(
        "COMMAND_FAILED",
        {
          commandType: "BOT_STOP",
          errorCode: "BOT_NOT_FOUND",
          message: "Bot not found",
        },
        stopId
      )
    );

    // Bookkeeping: the tracked command resolves, the bot keeps its terminal
    // state (no ERROR rewrite, no state-changed notification), and the audit
    // trail still records the engine's answer.
    expect(commands.get(stopId)?.state).toBe("FAILED");
    expect(bot.actual_state).toBe("STOPPED");
    expect(bot.desired_state).toBe("STOPPED");
    expect(
      lifecycleEvents.filter(event => event.event_type === "COMMAND_FAILED")
    ).toHaveLength(1);
  });

  // ===========================================
  // L24: a timeout must not leave a live runner
  // ===========================================

  it("stops the engine-side runner when a start times out (no orphaned exposure)", async () => {
    await service.start(BOT_ID, "user-1");
    const startId = dispatched("BOT_START")[0];

    // The engine never answered and the command expires.
    now += BOT_COMMAND_TIMEOUT_MS + 1_000;
    expect(await service.sweepTimedOutCommands()).toBe(1);

    // Backend bookkeeping: command TIMED_OUT, bot terminal, desired STOPPED.
    expect(commands.get(startId)?.state).toBe("TIMED_OUT");
    expect(bot.actual_state).toBe("ERROR");
    expect(bot.desired_state).toBe("STOPPED");

    // Exposure side: the engine is told to tear the runner down, through the
    // supervised command path so the repair cannot silently disappear.
    const stopIds = dispatched("BOT_STOP");
    expect(stopIds).toHaveLength(1);
    expect(commands.get(stopIds[0])).toMatchObject({
      bot_id: BOT_ID,
      command_type: "BOT_STOP",
      state: "PENDING",
    });
    expect(
      lifecycleEvents.find(
        event => event.event_type === "RECONCILE_STOP_REISSUED"
      )?.metadata
    ).toMatchObject({
      reason: "command-timeout:BOT_START",
      source: "terminal-state-drift",
    });
  });

  it("stops the engine runner when a healthy engine reports a terminal bot as active", async () => {
    bot.desired_state = "STOPPED";
    bot.actual_state = "ERROR";

    const result = await service.reconcileHeartbeatInventory(ENGINE_ID, [
      BOT_ID,
    ]);

    expect(result).toMatchObject({ drift: 1, stopReissued: 1 });
    expect(dispatched("BOT_STOP")).toHaveLength(1);
    expect(
      lifecycleEvents.find(
        event => event.event_type === "RECONCILE_STOP_REISSUED"
      )?.metadata
    ).toMatchObject({ reason: "heartbeat-inventory-drift" });
  });

  it("bounds the drift repair by the hourly stop-reissue budget", async () => {
    bot.desired_state = "STOPPED";
    bot.actual_state = "ERROR";
    for (let i = 0; i < MAX_STOP_REISSUES_PER_HOUR; i++) {
      lifecycleEvents.push({
        event_type: "RECONCILE_STOP_REISSUED",
        metadata: {},
      });
    }

    const result = await service.reconcileHeartbeatInventory(ENGINE_ID, [
      BOT_ID,
    ]);

    expect(result).toMatchObject({ drift: 1, stopReissued: 0 });
    expect(dispatched("BOT_STOP")).toHaveLength(0);
  });

  it("never second-guesses a mid-lifecycle bot (engine inventory ahead of the backend)", async () => {
    // A normal start in flight: the engine already runs the bot while the
    // backend is still STARTING. That is a race, not drift - repairing it would
    // abort every healthy start.
    bot.desired_state = "RUNNING";
    bot.actual_state = "STARTING";

    const result = await service.reconcileHeartbeatInventory(ENGINE_ID, [
      BOT_ID,
    ]);

    expect(result).toMatchObject({ drift: 0, stopReissued: 0 });
    expect(dispatched("BOT_STOP")).toHaveLength(0);
  });
});
