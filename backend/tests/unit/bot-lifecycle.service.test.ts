/**
 * Unit tests for the bot lifecycle protocol:
 * - shared state machine (transitions, guards, envelope)
 * - BotLifecycleService start/stop/event handling with mocked persistence
 *
 * @format
 */

import {
  assertTransition,
  canTransition,
  InvalidStateTransitionError,
  isBotActualState,
  isBotDesiredState,
  isBotEvent,
  isProtocolMessage,
  createBotCommand,
  createBotEvent,
} from "@trade-bot/shared";
import { BotLifecycleService } from "../../src/core/bots/bot-lifecycle.service";
import { EngineProtocolService } from "../../src/core/bots/engine-protocol.service";
import { strategyRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/strategy-repository.adapter";

jest.mock("../../src/database/pool", () => ({
  query: jest.fn(),
}));
jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// C3a: `createAndStart` validates the bound ACTIVE account through the adapter
// before it inserts the bot instance.
jest.mock(
  "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter",
  () => ({
    exchangeAccountRepositoryAdapter: {
      getAccountWithSecret: jest.fn(),
    },
    getBotBoundAccountSecrets: jest.fn(),
  })
);

import { query } from "../../src/database/pool";
import { BotLifecycleRepository } from "../../src/core/bots/lifecycle/bot-lifecycle.repository";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";
import {
  getTimeoutReason,
  TimeoutReason,
} from "../../src/core/bots/lifecycle/types";

const mockQuery = query as jest.Mock;

const mockAccountAdapter = exchangeAccountRepositoryAdapter as unknown as {
  getAccountWithSecret: jest.Mock;
};

/** Successful non-SELECT result (UPDATE/INSERT/DELETE) for the query mock. */
const okResult = () => Promise.resolve({ rows: [], rowCount: 1 });

// ===========================================
// SHARED STATE MACHINE
// ===========================================

describe("bot lifecycle state machine (shared)", () => {
  it("allows the happy-path lifecycle", () => {
    expect(canTransition("STOPPED", "STARTING")).toBe(true);
    expect(canTransition("STARTING", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "STOPPING")).toBe(true);
    expect(canTransition("STOPPING", "STOPPED")).toBe(true);
  });

  it("allows failure transitions to ERROR", () => {
    expect(canTransition("STARTING", "ERROR")).toBe(true);
    expect(canTransition("RUNNING", "ERROR")).toBe(true);
    expect(canTransition("STOPPING", "ERROR")).toBe(true);
  });

  it("rejects impossible transitions", () => {
    expect(canTransition("STOPPED", "RUNNING")).toBe(false);
    expect(canTransition("RUNNING", "STARTING")).toBe(false);
    expect(canTransition("STOPPING", "RUNNING")).toBe(false);
    expect(canTransition("ERROR", "RUNNING")).toBe(false);
  });

  it("treats self-transitions as no-ops", () => {
    expect(canTransition("RUNNING", "RUNNING")).toBe(true);
    expect(canTransition("STOPPED", "STOPPED")).toBe(true);
  });

  it("throws InvalidStateTransitionError for illegal transitions", () => {
    expect(() => assertTransition("STOPPED", "RUNNING")).toThrow(
      InvalidStateTransitionError
    );
    expect(() => assertTransition("STOPPING", "RUNNING")).toThrow(
      InvalidStateTransitionError
    );
  });

  it("returns the target state for legal transitions", () => {
    expect(assertTransition("STOPPED", "STARTING")).toBe("STARTING");
  });

  // P0 (2026-10-05): the resume path. A crashed engine parks a bot in UNKNOWN;
  // without this edge BotLifecycleService.start() threw and a crashed bot could
  // only be recovered by the Gate-1 test harness.
  it("allows UNKNOWN -> STARTING so a crashed bot can be resumed", () => {
    expect(canTransition("UNKNOWN", "STARTING")).toBe(true);
    expect(assertTransition("UNKNOWN", "STARTING")).toBe("STARTING");
  });

  it("still refuses UNKNOWN -> RUNNING-as-a-declared-state only via confirm", () => {
    // UNKNOWN -> RUNNING stays legal for the engine-confirmed path; the resume
    // path deliberately goes through STARTING so we never declare RUNNING
    // before the engine confirms it.
    expect(canTransition("UNKNOWN", "RUNNING")).toBe(true);
    expect(canTransition("UNKNOWN", "STOPPED")).toBe(true);
    expect(canTransition("UNKNOWN", "ERROR")).toBe(true);
  });

  it("validates state type guards", () => {
    expect(isBotActualState("RUNNING")).toBe(true);
    expect(isBotActualState("running")).toBe(false);
    expect(isBotDesiredState("STOPPED")).toBe(true);
    expect(isBotDesiredState("STARTING")).toBe(false);
  });

  it("creates protocol envelopes with unique ids", () => {
    const a = createBotCommand("BOT_START", {
      botId: "b1",
      userId: "u1",
      strategyId: "s1",
      configVersion: 1,
      config: {},
    });
    const b = createBotCommand("BOT_START", {
      botId: "b1",
      userId: "u1",
      strategyId: "s1",
      configVersion: 1,
      config: {},
    });
    expect(isProtocolMessage(a)).toBe(true);
    expect(a.messageId).not.toBe(b.messageId);
    expect(a.correlationId).toBeTruthy();
    expect(a.version).toBe(1);
  });

  it("creates events that reference the originating correlation", () => {
    const event = createBotEvent(
      "STATE_CHANGED",
      {
        botId: "b1",
        engineId: "e1",
        engineEpoch: 1,
        from: "STARTING",
        to: "RUNNING",
      },
      "corr-1"
    );
    expect(isBotEvent(event)).toBe(true);
    expect(event.correlationId).toBe("corr-1");
    expect(event.type).toBe("STATE_CHANGED");
  });
});

// ===========================================
// BOT LIFECYCLE SERVICE
// ===========================================

describe("BotLifecycleService", () => {
  let service: BotLifecycleService;
  let engineProtocol: { sendCommand: jest.Mock };

  const botRow = {
    id: "bot-1",
    user_id: "user-1",
    strategy_id: "strat-1",
    status: "STOPPED",
    desired_state: "STOPPED",
    actual_state: "STOPPED",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    engineProtocol = {
      sendCommand: jest.fn().mockResolvedValue({
        success: true,
        messageId: "m1",
        correlationId: "c1",
      }),
    };
    service = new BotLifecycleService(
      engineProtocol as unknown as EngineProtocolService
    );
    // Permissive authority checker by default; individual tests override it.
    service.setAuthorityChecker(async () => true);
  });

  describe("start", () => {
    it("transitions STOPPED -> STARTING, sets desired RUNNING and sends the command", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        return okResult();
      });

      const result = await service.start("bot-1", "user-1");

      // correlationId is generated by the dispatcher (record-before-publish).
      expect(result).toMatchObject({
        botId: "bot-1",
        desiredState: "RUNNING",
        actualState: "STARTING",
      });
      expect(result.correlationId).toEqual(expect.any(String));
      expect(engineProtocol.sendCommand).toHaveBeenCalledWith(
        "BOT_START",
        expect.objectContaining({
          botId: "bot-1",
          userId: "user-1",
          strategyId: "strat-1",
        }),
        expect.any(String)
      );
    });

    it("flips the strategy badge on when the start command is dispatched (L12)", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        return okResult();
      });
      const toggle = jest
        .spyOn(strategyRepositoryAdapter, "toggleStrategy")
        .mockResolvedValue(undefined);

      await service.start("bot-1", "user-1");

      expect(toggle).toHaveBeenCalledWith("strat-1", true);
      toggle.mockRestore();
    });

    it("is idempotent for an already STARTING/RUNNING bot", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { ...botRow, desired_state: "RUNNING", actual_state: "RUNNING" },
        ],
      });

      const result = await service.start("bot-1", "user-1");

      expect(result.actualState).toBe("RUNNING");
      expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
    });

    it("rejects illegal transitions (e.g. STOPPING -> STARTING)", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { ...botRow, desired_state: "STOPPED", actual_state: "STOPPING" },
        ],
      });

      await expect(service.start("bot-1", "user-1")).rejects.toThrow(
        InvalidStateTransitionError
      );
      expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
    });

    // P0 resume: a bot parked UNKNOWN by a lost engine must re-drive through
    // STARTING for the SAME bot id (never a new instance).
    it("resumes an UNKNOWN bot through STARTING for the same bot id", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              {
                ...botRow,
                desired_state: "RUNNING",
                actual_state: "UNKNOWN",
              },
            ],
          });
        }
        return okResult();
      });

      const result = await service.start("bot-1", "user-1");

      expect(result).toMatchObject({
        botId: "bot-1",
        desiredState: "RUNNING",
        actualState: "STARTING",
      });
      // Same bot id — resume must never mint a second instance.
      expect(engineProtocol.sendCommand).toHaveBeenCalledWith(
        "BOT_START",
        expect.objectContaining({ botId: "bot-1" }),
        expect.any(String)
      );
    });

    it("tags an illegal resume transition with 409 (not 500)", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { ...botRow, desired_state: "STOPPED", actual_state: "STOPPING" },
        ],
      });

      await expect(service.start("bot-1", "user-1")).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it("rolls back to STOPPED when the command cannot be delivered", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        return okResult();
      });
      engineProtocol.sendCommand.mockResolvedValue({
        success: false,
        error: "redis down",
      });

      await expect(service.start("bot-1", "user-1")).rejects.toThrow(
        "Failed to deliver start command"
      );

      const updates = mockQuery.mock.calls.filter(call =>
        String(call[0]).includes("UPDATE bot_instances")
      );
      const lastUpdate = updates[updates.length - 1];
      expect(lastUpdate[1][1]).toBe("STOPPED"); // desired_state
      expect(lastUpdate[1][2]).toBe("STOPPED"); // actual_state
    });

    it("rejects a bot owned by another user", async () => {
      mockQuery.mockResolvedValue({
        rows: [{ ...botRow, user_id: "someone-else" }],
      });

      await expect(service.start("bot-1", "user-1")).rejects.toThrow(
        "Bot not found"
      );
    });
  });

  // P0-3: the needs-action marker must be written ONCE per episode. The
  // reconciler runs every ~60 s; recording unconditionally produced 794
  // identical rows against 24 real STATE_CHANGED events here.
  describe("recordReconcileNeedsUserAction", () => {
    const parked = {
      ...botRow,
      desired_state: "RUNNING",
      actual_state: "UNKNOWN",
    };
    const markerTail = {
      event_type: "RECONCILE_NEEDS_USER_ACTION",
      from_state: "UNKNOWN",
      metadata: { reason: "desired-running-unconfirmed" },
    };

    it("records a marker the first time and reports it", async () => {
      mockQuery.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [parked] });
        }
        if (text.includes("FROM bot_lifecycle_events")) {
          return Promise.resolve({ rows: [] }); // no prior event
        }
        return okResult();
      });

      await expect(
        service.recordReconcileNeedsUserAction(
          "bot-1",
          "desired-running-unconfirmed"
        )
      ).resolves.toBe(true);
    });

    it("skips the duplicate when the identical marker is already the tail", async () => {
      mockQuery.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [parked] });
        }
        if (text.includes("FROM bot_lifecycle_events")) {
          return Promise.resolve({ rows: [markerTail] });
        }
        return okResult();
      });

      await expect(
        service.recordReconcileNeedsUserAction(
          "bot-1",
          "desired-running-unconfirmed"
        )
      ).resolves.toBe(false);

      // The decisive assertion: no second INSERT for the same episode.
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO bot_lifecycle_events"),
        expect.anything()
      );
    });

    it("records again once a real transition has superseded the marker", async () => {
      mockQuery.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [parked] });
        }
        if (text.includes("FROM bot_lifecycle_events")) {
          return Promise.resolve({
            rows: [
              {
                event_type: "STATE_CHANGED",
                from_state: "STARTING",
                metadata: { reason: "normal_start" },
              },
            ],
          });
        }
        return okResult();
      });

      await expect(
        service.recordReconcileNeedsUserAction(
          "bot-1",
          "desired-running-unconfirmed"
        )
      ).resolves.toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO bot_lifecycle_events"),
        expect.anything()
      );
    });
  });

  describe("stop", () => {
    it("transitions RUNNING -> STOPPING and sends BOT_STOP", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "RUNNING" },
            ],
          });
        }
        return okResult();
      });

      const result = await service.stop("bot-1", "user-1");

      expect(result).toMatchObject({
        desiredState: "STOPPED",
        actualState: "STOPPING",
      });
      // Record-before-publish: a correlationId is generated and passed to XADD.
      expect(engineProtocol.sendCommand).toHaveBeenCalledWith(
        "BOT_STOP",
        { botId: "bot-1" },
        expect.any(String)
      );
    });

    it("flips the strategy badge off when the stop command is dispatched (L12)", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "RUNNING" },
            ],
          });
        }
        return okResult();
      });
      const toggle = jest
        .spyOn(strategyRepositoryAdapter, "toggleStrategy")
        .mockResolvedValue(undefined);

      await service.stop("bot-1", "user-1");

      expect(toggle).toHaveBeenCalledWith("strat-1", false);
      toggle.mockRestore();
    });

    it("is idempotent for an already STOPPED bot", async () => {
      mockQuery.mockResolvedValue({ rows: [botRow] });

      const result = await service.stop("bot-1", "user-1");

      expect(result.actualState).toBe("STOPPED");
      expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
    });
  });

  describe("emergencyStop (M1)", () => {
    it("transitions RUNNING -> STOPPING, badges FORCE_STOPPING and sends EMERGENCY_STOP", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "RUNNING" },
            ],
          });
        }
        return okResult();
      });

      const result = await service.emergencyStop(
        "bot-1",
        "user-1",
        "FULL_SHUTDOWN"
      );

      expect(result).toMatchObject({
        desiredState: "STOPPED",
        actualState: "STOPPING",
      });
      // Real, audited command on the live protocol (record-before-publish).
      expect(engineProtocol.sendCommand).toHaveBeenCalledWith(
        "EMERGENCY_STOP",
        { botId: "bot-1", action: "FULL_SHUTDOWN" },
        expect.any(String)
      );
      // The row is badged FORCE_STOPPING after the CAS transition.
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE bot_instances SET status"),
        ["FORCE_STOPPING", "bot-1"]
      );
    });

    it("rejects a non-RUNNING bot with 409 and sends no command", async () => {
      mockQuery.mockResolvedValue({ rows: [botRow] });

      await expect(
        service.emergencyStop("bot-1", "user-1", "CANCEL_ALL_ORDERS")
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
    });

    it("drops the FORCE_STOPPING badge and throws 503 when dispatch fails", async () => {
      engineProtocol.sendCommand.mockResolvedValue({
        success: false,
        error: "redis unavailable",
      });
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "RUNNING" },
            ],
          });
        }
        return okResult();
      });

      await expect(
        service.emergencyStop("bot-1", "user-1", "CLOSE_POSITIONS")
      ).rejects.toMatchObject({ statusCode: 503 });

      const statusWrites = mockQuery.mock.calls.filter(call =>
        String(call[0]).includes("UPDATE bot_instances SET status")
      );
      expect(statusWrites.map(call => call[1])).toEqual([
        ["FORCE_STOPPING", "bot-1"],
        ["STOPPING", "bot-1"],
      ]);
    });
  });

  it("classifies a timed-out EMERGENCY_STOP as an incomplete stop", () => {
    // The emergency command is supervised like BOT_STOP: a STOPPING bot whose
    // emergency stop never completed must be recovered (UNKNOWN + stop repair),
    // not burned as COMMAND_NEVER_DELIVERED / ERROR.
    expect(getTimeoutReason("EMERGENCY_STOP", "STOPPING")).toBe(
      TimeoutReason.STOP_INCOMPLETE
    );
  });

  describe("handleEngineEvent", () => {
    it("processes STATE_CHANGED to RUNNING and persists the transition", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "corr-1"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "STARTING" },
            ],
          });
        }
        return okResult();
      });

      await service.handleEngineEvent(event);

      const updates = mockQuery.mock.calls.filter(call =>
        String(call[0]).includes("UPDATE bot_instances")
      );
      expect(updates).toHaveLength(1);
      expect(updates[0][1][2]).toBe("RUNNING");
    });

    it("keeps an incomplete emergency cleanup visible after the row is STOPPED", async () => {
      // M1: the panic stop reports the same terminal STOPPED whether or not the
      // venue cleanup finished, so the engine marks the reason. Without this
      // write the operator would see a clean row over live venue exposure.
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STOPPING",
          to: "STOPPED",
          reason:
            "emergency_stop:FULL_SHUTDOWN; cleanup_incomplete: position 0.1 ETH not flattened: adapter refused MARKET",
        },
        "corr-1"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              {
                ...botRow,
                desired_state: "STOPPED",
                actual_state: "STOPPING",
              },
            ],
          });
        }
        return okResult();
      });

      await service.handleEngineEvent(event);

      const writes = mockQuery.mock.calls.filter(call =>
        String(call[0]).includes("force_stop_reason")
      );
      expect(writes).toHaveLength(1);
      expect(writes[0][1][1]).toBe("bot-1");
      expect(String(writes[0][1][0])).toContain("cleanup_incomplete");
      expect(String(writes[0][1][0])).toContain("not flattened");
    });

    it("leaves force_stop_reason alone for a clean stop", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STOPPING",
          to: "STOPPED",
          reason: "emergency_stop:FULL_SHUTDOWN",
        },
        "corr-1"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              {
                ...botRow,
                desired_state: "STOPPED",
                actual_state: "STOPPING",
              },
            ],
          });
        }
        return okResult();
      });

      await service.handleEngineEvent(event);

      expect(
        mockQuery.mock.calls.filter(call =>
          String(call[0]).includes("force_stop_reason")
        )
      ).toHaveLength(0);
    });

    it("ignores illegal engine-reported transitions without throwing", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "corr-1"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [{ ...botRow, actual_state: "STOPPED" }],
          });
        }
        return okResult();
      });

      await expect(service.handleEngineEvent(event)).resolves.toBeUndefined();
      expect(
        mockQuery.mock.calls.filter(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toHaveLength(0);
    });

    it("transitions the bot to ERROR on COMMAND_FAILED", async () => {
      const event = createBotEvent(
        "COMMAND_FAILED",
        {
          botId: "bot-1",
          commandType: "BOT_START",
          engineId: "engine-1",
          engineEpoch: 1,
          errorCode: "BOT_START_FAILED",
          message: "boom",
        },
        "corr-1"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "STARTING" },
            ],
          });
        }
        return okResult();
      });

      await service.handleEngineEvent(event);

      const updates = mockQuery.mock.calls.filter(call =>
        String(call[0]).includes("UPDATE bot_instances")
      );
      expect(updates[0][1][2]).toBe("ERROR");
    });

    it("is a no-op for duplicate STATE_CHANGED events", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "corr-1"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "RUNNING" },
            ],
          });
        }
        return okResult();
      });

      await service.handleEngineEvent(event);

      expect(
        mockQuery.mock.calls.filter(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toHaveLength(0);
    });

    it("skips a STATE_CHANGED event that loses the compare-and-set race", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "corr-1"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "STARTING" },
            ],
          });
        }
        // Simulate a concurrent writer: the guarded UPDATE matches 0 rows.
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await service.handleEngineEvent(event);

      expect(
        mockQuery.mock.calls.filter(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toHaveLength(1);
      // No lifecycle event should be recorded for a stale (unapplied) transition.
      expect(
        mockQuery.mock.calls.filter(call =>
          String(call[0]).includes("INSERT INTO bot_lifecycle_events")
        )
      ).toHaveLength(0);
    });

    it("ignores STATE_CHANGED from a non-authoritative engine id", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "rogue-engine",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "corr-9"
      );

      // Fail-closed: the registry says this engine is not authoritative.
      service.setAuthorityChecker(async () => false);

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              {
                ...botRow,
                engine_id: "trusted-engine",
                desired_state: "RUNNING",
                actual_state: "STARTING",
              },
            ],
          });
        }
        return okResult();
      });

      await service.handleEngineEvent(event);

      expect(
        mockQuery.mock.calls.filter(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toHaveLength(0);
    });

    it("rejects runtime events without an engineEpoch (fail closed)", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          from: "STARTING",
          to: "RUNNING",
        } as never,
        "corr-10"
      );
      // Strip engineEpoch to simulate a legacy/stale producer.
      (event.payload as Record<string, unknown>).engineEpoch = undefined;

      await service.handleEngineEvent(event);

      expect(
        mockQuery.mock.calls.some(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toBe(false);
    });

    it("rejects all runtime events when no authority checker is wired", async () => {
      service = new BotLifecycleService(
        engineProtocol as unknown as EngineProtocolService
      );
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "corr-11"
      );

      await service.handleEngineEvent(event);

      expect(
        mockQuery.mock.calls.some(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toBe(false);
    });

    it("ignores events from a stale generation (correlationId maps to a TIMED_OUT command)", async () => {
      const event = createBotEvent(
        "STATE_CHANGED",
        {
          botId: "bot-1",
          engineId: "engine-1",
          engineEpoch: 1,
          from: "STARTING",
          to: "RUNNING",
        },
        "c-timed-out"
      );

      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              {
                ...botRow,
                engine_id: "engine-1",
                desired_state: "RUNNING",
                actual_state: "STARTING",
              },
            ],
          });
        }
        if (String(sql).startsWith("SELECT bot_id, state FROM bot_commands")) {
          return Promise.resolve({
            rows: [{ bot_id: "bot-1", state: "TIMED_OUT" }],
          });
        }
        return okResult();
      });

      await service.handleEngineEvent(event);

      expect(
        mockQuery.mock.calls.filter(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toHaveLength(0);
    });
  });

  describe("concurrency (compare-and-set transitions)", () => {
    it("start rejects with 409 when the guarded UPDATE does not match", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await expect(service.start("bot-1", "user-1")).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
    });

    it("sends the guarded UPDATE with the expected actual_state", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        return okResult();
      });

      await service.start("bot-1", "user-1");

      const update = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("UPDATE bot_instances")
      );
      expect(update).toBeDefined();
      expect(String(update![0])).toContain("AND actual_state = $11");
      expect(update![1][10]).toBe("STOPPED"); // expected actual_state we read
    });
  });

  describe("command tracking & timeout sweep", () => {
    it("records a PENDING command before publishing and reuses the correlationId", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        return okResult();
      });

      await service.start("bot-1", "user-1");

      // The dispatcher generates a correlationId and passes it to XADD.
      const sendCall = engineProtocol.sendCommand.mock.calls[0];
      const correlationId = sendCall?.[2];
      expect(correlationId).toEqual(expect.any(String));

      // That same correlationId was inserted into bot_commands as PENDING
      // (record-before-publish), so the engine's events resolve the row and
      // the timeout sweeper can never burn a resolved bot to ERROR.
      const insert = mockQuery.mock.calls.find(
        call =>
          String(call[0]).includes("INSERT INTO bot_commands") &&
          call[1]?.[0] === correlationId
      );
      expect(insert).toBeDefined();
      expect(insert![1][1]).toBe("bot-1");
      expect(insert![1][2]).toBe("BOT_START");
    });

    it("marks the command ACCEPTED on COMMAND_ACCEPTED", async () => {
      const event = createBotEvent(
        "COMMAND_ACCEPTED",
        {
          botId: "bot-1",
          commandType: "BOT_START",
          engineId: "engine-1",
          engineEpoch: 1,
        },
        "c1"
      );

      mockQuery.mockImplementation(() => okResult());

      await service.handleEngineEvent(event);

      const update = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("UPDATE bot_commands")
      );
      expect(update).toBeDefined();
      expect(update![1][1]).toBe("ACCEPTED");
    });

    it("times out expired PENDING commands and transitions the bot to ERROR", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (
          String(sql).includes("FROM bot_commands") &&
          String(sql).startsWith("SELECT")
        ) {
          return Promise.resolve({
            rows: [
              {
                correlation_id: "c-expired",
                bot_id: "bot-1",
                command_type: "BOT_START",
              },
            ],
          });
        }
        if (String(sql).startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "STARTING" },
            ],
          });
        }
        return okResult();
      });

      const timedOut = await service.sweepTimedOutCommands();

      expect(timedOut).toBe(1);
      const botUpdate = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("UPDATE bot_instances")
      );
      expect(botUpdate).toBeDefined();
      expect(botUpdate![1][2]).toBe("ERROR");
      expect(
        mockQuery.mock.calls.some(call =>
          String(call[0]).includes("INSERT INTO bot_lifecycle_events")
        )
      ).toBe(true);
    });

    it("does not double-process a timed-out command whose claim loses the race", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (
          String(sql).includes("FROM bot_commands") &&
          String(sql).startsWith("SELECT")
        ) {
          return Promise.resolve({
            rows: [
              {
                correlation_id: "c-expired",
                bot_id: "bot-1",
                command_type: "BOT_START",
              },
            ],
          });
        }
        // The claim UPDATE loses the race against a concurrent sweep.
        if (String(sql).includes("state = 'TIMED_OUT'")) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return okResult();
      });

      const timedOut = await service.sweepTimedOutCommands();

      expect(timedOut).toBe(0);
      expect(
        mockQuery.mock.calls.some(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toBe(false);
    });
  });

  describe("heartbeat inventory reconciliation", () => {
    it("marks a RUNNING bot UNKNOWN when the healthy engine does not list it", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (
          String(sql).startsWith("SELECT id, user_id") &&
          String(sql).includes("actual_state = 'RUNNING'")
        ) {
          return Promise.resolve({
            rows: [
              {
                ...botRow,
                engine_id: "engine-1",
                desired_state: "RUNNING",
                actual_state: "RUNNING",
              },
            ],
          });
        }
        if (
          String(sql).startsWith("SELECT id, user_id") &&
          String(sql).includes("IN ($")
        ) {
          return Promise.resolve({ rows: [] });
        }
        return okResult();
      });

      const result = await service.reconcileHeartbeatInventory("engine-1", []);

      expect(result.unlisted).toBe(1);
      const update = mockQuery.mock.calls.find(call =>
        String(call[0]).includes("UPDATE bot_instances")
      );
      expect(update![1][2]).toBe("UNKNOWN");
      expect(
        mockQuery.mock.calls.some(call =>
          String(call[0]).includes("INSERT INTO bot_lifecycle_events")
        )
      ).toBe(true);
    });

    it("reports drift for engine-listed bots the backend does not track as running", async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (
          String(sql).startsWith("SELECT id, user_id") &&
          String(sql).includes("actual_state = 'RUNNING'")
        ) {
          return Promise.resolve({ rows: [] });
        }
        if (
          String(sql).startsWith("SELECT id, user_id") &&
          String(sql).includes("IN ($")
        ) {
          return Promise.resolve({
            rows: [{ ...botRow, id: "bot-2", actual_state: "STOPPED" }],
          });
        }
        return okResult();
      });

      const result = await service.reconcileHeartbeatInventory("engine-1", [
        "bot-2",
      ]);

      expect(result.drift).toBe(1);
      expect(
        mockQuery.mock.calls.some(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toBe(false);
    });
  });
});

// ===========================================
// BOT → ACCOUNT BINDING (C3a, migration 013)
// ===========================================

describe("bot → account binding", () => {
  let service: BotLifecycleService;

  /** C3a: the row shape `getAccountWithSecret` returns for a healthy account. */
  const activeAccount = {
    id: "acc-1",
    userId: "user-1",
    exchange: "kodiak",
    environment: "testnet",
    accountRef: "kodiak-account-id",
    status: "ACTIVE",
    verifiedAt: null,
    lastVerifiedAt: null,
    meta: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    credentialsEncrypted: "sealed",
    encryptionVersion: 3,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BotLifecycleService({
      sendCommand: jest.fn().mockResolvedValue({
        success: true,
        messageId: "m1",
        correlationId: "c1",
      }),
    } as unknown as EngineProtocolService);
    service.setAuthorityChecker(async () => true);
  });

  const mockStrategyExists = () =>
    mockQuery.mockImplementation((sql: string) =>
      String(sql).startsWith("SELECT id FROM strategies")
        ? Promise.resolve({ rows: [{ id: "strat-1" }] })
        : okResult()
    );

  it("404s before the account lookup when the strategy is not the caller's", async () => {
    mockQuery.mockImplementation((sql: string) =>
      String(sql).startsWith("SELECT id FROM strategies")
        ? Promise.resolve({ rows: [] })
        : okResult()
    );

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toThrow("Strategy not found");
    expect(mockAccountAdapter.getAccountWithSecret).not.toHaveBeenCalled();
  });

  it("404s when the bound account is missing or not owned", async () => {
    mockStrategyExists();
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue(null);

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toThrow("Exchange account not found");
    // Ownership is enforced by the scoped lookup (userId + accountId).
    expect(mockAccountAdapter.getAccountWithSecret).toHaveBeenCalledWith(
      "user-1",
      "acc-1"
    );
  });

  it("400s when the bound account is not ACTIVE", async () => {
    mockStrategyExists();
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue({
      ...activeAccount,
      status: "PENDING",
    });

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("409s when the strategy already has an active bot (current one-bot-per-strategy axis)", async () => {
    // Current axis (migration 013 era): a bot IS a running strategy, so a
    // strategy cannot be traded on two accounts concurrently — the caller must
    // stop the first bot before starting the second. Superseded by the
    // account-session model (plan §D), where the session is the unit and the
    // invariant becomes one active session per exchange account.
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.includes("FROM bot_instances")) {
        return Promise.resolve({ rows: [{ id: "bot-existing" }] });
      }
      return okResult();
    });
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue(activeAccount);

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-2")
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });

  // P0 (2026-10-05): the crash case that slipped through the old predicate.
  // A bot parked UNKNOWN/ERROR with desired_state=RUNNING still wants to run and
  // may still hold venue orders, so it must block a duplicate. Reproduced live in
  // Gate-4 run 3, where POST /start created a SECOND bot on the same account.
  it("409s when the existing bot is PARKED (desired RUNNING), not merely running", async () => {
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.includes("FROM bot_instances")) {
        // The widened predicate must select UNKNOWN/ERROR-desired-RUNNING too.
        expect(text).toContain("desired_state = 'RUNNING'");
        return Promise.resolve({ rows: [{ id: "bot-parked" }] });
      }
      return okResult();
    });
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue(activeAccount);

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-2")
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });

  it("writes the binding to bot_instances.exchange_account_id", async () => {
    const repository = new BotLifecycleRepository();
    mockQuery.mockResolvedValue({ rows: [{ id: "bot-1" }] });

    const botId = await repository.insertBotInstance(
      "strat-1",
      "user-1",
      "acc-1"
    );

    expect(botId).toBe("bot-1");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("exchange_account_id"),
      ["strat-1", "user-1", "acc-1"]
    );
  });
});

// ===========================================
// VENUE SYMBOL GATE (L20)
// ===========================================

describe("createAndStart venue symbol gate (L20)", () => {
  let service: BotLifecycleService;
  const originalFetch = global.fetch;

  const botRow = {
    id: "bot-1",
    user_id: "user-1",
    strategy_id: "strat-1",
    status: "STOPPED",
    desired_state: "STOPPED",
    actual_state: "STOPPED",
  };

  const lighterAccount = {
    id: "acc-1",
    userId: "user-1",
    exchange: "lighter",
    environment: "testnet",
    accountRef: "404",
    status: "ACTIVE",
    verifiedAt: null,
    lastVerifiedAt: null,
    meta: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    credentialsEncrypted: "sealed",
    encryptionVersion: 3,
  };

  /** Route each query by prefix: strategy/insert lookups + the start() flow. */
  const mockFlow = (symbol: string | null) =>
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.startsWith("SELECT config FROM strategies")) {
        return Promise.resolve({
          rows: [{ config: symbol ? { symbol } : {} }],
        });
      }
      if (text.includes("FROM bot_instances WHERE strategy_id")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.startsWith("INSERT INTO bot_instances")) {
        return Promise.resolve({ rows: [{ id: "bot-1" }], rowCount: 1 });
      }
      if (text.startsWith("INSERT INTO strategy_runs")) {
        return Promise.resolve({ rows: [{ id: "run-1" }], rowCount: 1 });
      }
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [botRow] });
      }
      return okResult();
    });

  const lighterCatalog = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          order_books: [{ symbol: "BTC" }, { symbol: "SOL" }],
        }),
    } as Response);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BotLifecycleService({
      sendCommand: jest.fn().mockResolvedValue({
        success: true,
        messageId: "m1",
        correlationId: "c1",
      }),
    } as unknown as EngineProtocolService);
    service.setAuthorityChecker(async () => true);
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue(lighterAccount);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects with 400 before creating a bot when the symbol is not listed on the venue", async () => {
    mockFlow("PERP_BTC_USDC");
    global.fetch = jest.fn(() => lighterCatalog()) as unknown as typeof fetch;

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("not listed on lighter (testnet)"),
    });

    // Rejected before any state change or BOT_START dispatch.
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });

  it("creates and starts when the symbol is listed on the venue", async () => {
    mockFlow("BTC");
    global.fetch = jest.fn(() => lighterCatalog()) as unknown as typeof fetch;

    const result = await service.createAndStart(
      "user-1",
      "strat-1",
      1000,
      "acc-1"
    );

    expect(result).toMatchObject({
      botId: "bot-1",
      desiredState: "RUNNING",
      actualState: "STARTING",
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });

  it("fails open (creates the bot) when the venue catalog cannot be fetched", async () => {
    mockFlow("PERP_BTC_USDC");
    global.fetch = jest.fn(() =>
      Promise.reject(new Error("venue down"))
    ) as unknown as typeof fetch;

    const result = await service.createAndStart(
      "user-1",
      "strat-1",
      1000,
      "acc-1"
    );

    expect(result.botId).toBe("bot-1");
  });

  // D2 sessions: the initial run is attached inside createAndStart.
  it("attaches the initial run and fans it into the BOT_START command", async () => {
    mockFlow("BTC");
    global.fetch = jest.fn(() => lighterCatalog()) as unknown as typeof fetch;

    await service.createAndStart("user-1", "strat-1", 1000, "acc-1");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO strategy_runs"),
      expect.arrayContaining(["bot-1", "strat-1"])
    );
  });

  it("409s when the strategy is already live as a run in another session", async () => {
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.includes("FROM bot_instances WHERE strategy_id")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({
          rows: [{ id: "run-other", bot_id: "bot-other" }],
        });
      }
      return okResult();
    });

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });

  it("409s when the account already hosts a live session (attach instead)", async () => {
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.includes("FROM bot_instances WHERE strategy_id")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("exchange_account_id = $1")) {
        return Promise.resolve({ rows: [{ id: "bot-existing" }] });
      }
      return okResult();
    });

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });
});
