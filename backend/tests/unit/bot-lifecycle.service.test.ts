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

jest.mock("../../src/database/pool", () => {
  const actual = { query: jest.fn() };
  return {
    ...actual,
    // F1: attachRun runs its INSERT inside a transaction that first locks the
    // session row. Route the transaction client's queries through the same
    // mock so the existing per-SQL implementations cover both paths.
    transaction: jest.fn(
      async (cb: (client: { query: unknown }) => unknown) => {
        const client = {
          query: (text: string, params?: unknown[]) =>
            actual.query(text, params),
        };
        return cb(client);
      }
    ),
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

import { query, transaction } from "../../src/database/pool";
import { BotLifecycleRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/bot-lifecycle-repository.adapter";
import { exchangeAccountRepositoryAdapter } from "../../src/infrastructure/adapters/repositories/exchange-account-repository.adapter";
import { venueSymbolCatalog } from "../../src/infrastructure/external/venue-symbols";
import { setStrategyBadgeWriter } from "../../src/core/bots/lifecycle/strategy-active-sync";
import {
  getTimeoutReason,
  TimeoutReason,
} from "../../src/core/bots/lifecycle/types";

const mockQuery = query as jest.Mock;
const mockTransaction = transaction as jest.Mock;

const mockAccountAdapter = exchangeAccountRepositoryAdapter as unknown as {
  getAccountWithSecret: jest.Mock;
};

/**
 * Construct + wire a service against the mocked pool/adapters (review P1:
 * the ports are setter-injected, exactly like the production composition
 * root in index.ts does).
 */
function createWiredService(
  engineProtocol: EngineProtocolService
): BotLifecycleService {
  const service = new BotLifecycleService(engineProtocol);
  service.setLifecycleRepository(new BotLifecycleRepositoryAdapter());
  service.setExchangeAccountLookup(mockAccountAdapter);
  service.setVenueSymbolCatalog(venueSymbolCatalog);
  return service;
}

// Badge writer (strategy-active-sync port): tests assert on the real
// adapter's toggleStrategy, same object the sync module is wired to in prod.
setStrategyBadgeWriter(strategyRepositoryAdapter);

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
    status: "STOPPED",
    desired_state: "STOPPED",
    actual_state: "STOPPED",
    exchange_account_id: "acc-1",
  };

  /** 022 shim-drop: the session's attached runs (badge + dispatch read these). */
  const bootRuns = [
    {
      id: "run-1",
      bot_id: "bot-1",
      strategy_id: "strat-1",
      config_version: 1,
      config: {},
      notional_amount: "1000",
      state: "STOPPED",
      last_error_code: null,
      created_at: "",
      updated_at: "",
    },
  ];

  /** Route the start() reads: session row + its runs, everything else ok. */
  const mockStartFlow = (row: typeof botRow = botRow) =>
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [row] });
      }
      // F1 sum grain (SUM over non-detached states) — distinguish from the
      // getRunsForBot row read.
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total: "0" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: bootRuns });
      }
      return okResult();
    });

  beforeEach(() => {
    jest.clearAllMocks();
    engineProtocol = {
      sendCommand: jest.fn().mockResolvedValue({
        success: true,
        messageId: "m1",
        correlationId: "c1",
      }),
    };
    service = createWiredService(
      engineProtocol as unknown as EngineProtocolService
    );
    // Permissive authority checker by default; individual tests override it.
    service.setAuthorityChecker(async () => true);
    // F1: permissive cap by default so existing start/attach/create tests are
    // unaffected; the F1 admission suite overrides it with a tight cap.
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({
        cap: Number.MAX_SAFE_INTEGER,
        existingExposure: 0,
      }),
    });
  });

  describe("start", () => {
    it("transitions STOPPED -> STARTING, sets desired RUNNING and sends the command", async () => {
      mockStartFlow();

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

    it("flips the session's run badges on when the start command is dispatched (L12, 022)", async () => {
      mockStartFlow();
      const toggle = jest
        .spyOn(strategyRepositoryAdapter, "toggleStrategy")
        .mockResolvedValue(undefined);

      await service.start("bot-1", "user-1");

      expect(toggle).toHaveBeenCalledWith("strat-1", true);
      toggle.mockRestore();
    });

    it("blocks start/resume when the account has unresolved venue exposure", async () => {
      mockQuery.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        if (text.includes("SUM(notional_amount)")) {
          return Promise.resolve({ rows: [{ total: "0" }] });
        }
        if (text.includes("residual_abandoned_at IS NULL")) {
          return Promise.resolve({ rows: [{ id: "residual-session" }] });
        }
        return okResult();
      });

      await expect(service.start("bot-1", "user-1")).rejects.toMatchObject({
        statusCode: 409,
        message:
          "Account has unresolved venue exposure from session residual-session. Close it or abandon the residual before starting.",
      });

      expect(
        mockQuery.mock.calls.some(call =>
          String(call[0]).includes("UPDATE bot_instances")
        )
      ).toBe(false);
      expect(engineProtocol.sendCommand).not.toHaveBeenCalled();

      const calls = mockQuery.mock.calls.map(call => String(call[0]));
      const lockIndex = calls.findIndex(
        sql =>
          sql.includes("FROM exchange_accounts") && sql.includes("FOR UPDATE")
      );
      const unresolvedIndex = calls.findIndex(sql =>
        sql.includes("residual_abandoned_at IS NULL")
      );
      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(unresolvedIndex).toBeGreaterThan(lockIndex);
    });

    it("allows start/resume after the residual has been abandoned", async () => {
      mockStartFlow({
        ...botRow,
        force_stop_reason: "cleanup_incomplete: position 0.1 ETH not flattened",
        residual_abandoned_at: "2026-10-20T12:00:00.000Z",
      } as typeof botRow);

      const result = await service.start("bot-1", "user-1");

      expect(result).toMatchObject({
        botId: "bot-1",
        desiredState: "RUNNING",
        actualState: "STARTING",
      });
      expect(engineProtocol.sendCommand).toHaveBeenCalledWith(
        "BOT_START",
        expect.objectContaining({ botId: "bot-1" }),
        expect.any(String)
      );
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
      mockStartFlow({
        ...botRow,
        desired_state: "RUNNING",
        actual_state: "UNKNOWN",
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
      mockStartFlow();
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

    it("flips the session's run badges off when the stop command is dispatched (L12, 022)", async () => {
      mockQuery.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.startsWith("SELECT id, user_id")) {
          return Promise.resolve({
            rows: [
              { ...botRow, desired_state: "RUNNING", actual_state: "RUNNING" },
            ],
          });
        }
        if (text.includes("FROM strategy_runs")) {
          return Promise.resolve({
            rows: [
              {
                id: "run-1",
                bot_id: "bot-1",
                strategy_id: "strat-1",
                config_version: 1,
                config: {},
                notional_amount: "1000",
                state: "RUNNING",
                last_error_code: null,
                created_at: "",
                updated_at: "",
              },
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
      // persistStopTx now writes the marker inside the same UPDATE as the
      // stop transition; botId is the first param ($1) and the cleanup reason
      // is the marker param ($11) of that UPDATE.
      expect(writes[0][1][0]).toBe("bot-1");
      expect(String(writes[0][1][10])).toContain("cleanup_incomplete");
      expect(String(writes[0][1][10])).toContain("not flattened");
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
      service = createWiredService(
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
        const text = String(sql);
        if (text.startsWith("SELECT id, user_id")) {
          return Promise.resolve({ rows: [botRow] });
        }
        if (text.includes("FROM strategy_runs")) {
          return Promise.resolve({ rows: bootRuns });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await expect(service.start("bot-1", "user-1")).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
    });

    it("sends the guarded UPDATE with the expected actual_state", async () => {
      mockStartFlow();

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
      mockStartFlow();

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
    service = createWiredService({
      sendCommand: jest.fn().mockResolvedValue({
        success: true,
        messageId: "m1",
        correlationId: "c1",
      }),
    } as unknown as EngineProtocolService);
    service.setAuthorityChecker(async () => true);
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({
        cap: Number.MAX_SAFE_INTEGER,
        existingExposure: 0,
      }),
    });
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

  it("409s when the strategy is already live as a run in another session (022 runs-only axis)", async () => {
    // Retired one-bot-per-strategy axis: a strategy lives in exactly one
    // session's runs — the runs guard is the authority, not bot history.
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [{ id: "run-other" }] });
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

  // P0 history (2026-10-05): the retired bot-level predicate once missed a
  // bot parked UNKNOWN/ERROR with desired_state=RUNNING — Gate-4 run 3
  // created a SECOND bot on the same account. The 022 runs guard covers
  // parked runs the same way: any live run blocks a duplicate.
  it("409s when the strategy is PARKED as a live run elsewhere, not merely running", async () => {
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [{ id: "run-parked" }] });
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
    const repository = new BotLifecycleRepositoryAdapter();
    mockQuery.mockResolvedValue({ rows: [{ id: "bot-1" }] });

    const botId = await repository.insertBotInstance(
      "strat-1",
      "user-1",
      "acc-1"
    );

    expect(botId).toBe("bot-1");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("exchange_account_id"),
      ["user-1", "acc-1"]
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
    status: "STOPPED",
    desired_state: "STOPPED",
    actual_state: "STOPPED",
    exchange_account_id: "acc-1",
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
  const mockFlow = (
    symbol: string | null,
    venue?: { exchange: string | null; environment: string | null }
  ) =>
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [
            {
              exchange: venue?.exchange ?? null,
              environment: venue?.environment ?? null,
              config: symbol ? { symbol } : {},
            },
          ],
        });
      }
      if (text.startsWith("SELECT config FROM strategies")) {
        return Promise.resolve({
          rows: [{ config: symbol ? { symbol } : {} }],
        });
      }
      if (text.includes("FROM strategy_runs")) {
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
    service = createWiredService({
      sendCommand: jest.fn().mockResolvedValue({
        success: true,
        messageId: "m1",
        correlationId: "c1",
      }),
    } as unknown as EngineProtocolService);
    service.setAuthorityChecker(async () => true);
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({
        cap: Number.MAX_SAFE_INTEGER,
        existingExposure: 0,
      }),
    });
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
    // Legacy null-venue row: fail-open preserved.
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

  it("503s a venue-bound row when the catalog is unavailable (fail-closed)", async () => {
    mockFlow("BTC", { exchange: "lighter", environment: "testnet" });
    global.fetch = jest.fn(() =>
      Promise.reject(new Error("venue down"))
    ) as unknown as typeof fetch;

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toMatchObject({ statusCode: 503 });

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });

  it("400s a venue-bound strategy on a foreign-venue account with no session row", async () => {
    mockFlow("BTC", { exchange: "kodiak", environment: "testnet" });
    global.fetch = jest.fn(() => lighterCatalog()) as unknown as typeof fetch;

    await expect(
      service.createAndStart("user-1", "strat-1", 1000, "acc-1")
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("does not match account"),
    });

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
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

// ===========================================
// F1 NOTIONAL ADMISSION (session cap)
// ===========================================

describe("BotLifecycleService F1 notional admission", () => {
  let service: BotLifecycleService;

  const kodiakAccount = {
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

  const runningBotRow = {
    id: "bot-1",
    user_id: "user-1",
    status: "RUNNING",
    desired_state: "RUNNING",
    // UNKNOWN (parked) so start() runs the admission gate + transition rather
    // than the idempotent already-RUNNING short-circuit — the resume path.
    actual_state: "UNKNOWN",
    exchange_account_id: "acc-1",
  };

  // attachStrategyRun() requires a live session (RUNNING/STARTING).
  const attachBotRow = {
    id: "bot-1",
    user_id: "user-1",
    status: "RUNNING",
    desired_state: "RUNNING",
    actual_state: "RUNNING",
    exchange_account_id: "acc-1",
  };

  const routeStart = (total: string, row = runningBotRow) =>
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [row] });
      }
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      return okResult();
    });

  beforeEach(() => {
    jest.clearAllMocks();
    service = createWiredService({
      sendCommand: jest.fn().mockResolvedValue({
        success: true,
        messageId: "m1",
        correlationId: "c1",
      }),
    } as unknown as EngineProtocolService);
    service.setAuthorityChecker(async () => true);
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue(kodiakAccount);
  });

  it("start() 409s before any state change when residual capacity is exceeded", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 500, existingExposure: 0 }),
    });
    routeStart("1000");

    await expect(service.start("bot-1", "user-1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE bot_instances"),
      expect.anything()
    );
  });

  it("start() dispatches when the pending notional fits the residual cap", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 5000, existingExposure: 0 }),
    });
    const toggle = jest
      .spyOn(strategyRepositoryAdapter, "toggleStrategy")
      .mockResolvedValue(undefined);
    routeStart("1000");

    const result = await service.start("bot-1", "user-1");
    expect(result.botId).toBe("bot-1");
    toggle.mockRestore();
  });

  it("cancels the estimate waiter when BOT_START dispatch throws", async () => {
    const waitForEstimate = jest.fn(() => new Promise(() => undefined));
    const cancelEstimateWait = jest.fn();
    const sendCommand = jest
      .fn()
      .mockRejectedValue(new Error("redis publish threw"));
    service = createWiredService({
      sendCommand,
      waitForEstimate,
      cancelEstimateWait,
    } as unknown as EngineProtocolService);
    service.setAuthorityChecker(async () => true);
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 5000, existingExposure: 0 }),
    });
    service.setGridAdmissionService({
      admit: jest.fn(),
    } as unknown as import("../../src/core/strategies/admission/grid-admission.service").GridAdmissionService);
    const run = {
      id: "run-1",
      bot_id: "bot-1",
      strategy_id: "strategy-1",
      config_version: 1,
      config: { symbol: "ETH", gridSize: 3, gridRange: 5, orderQuantity: 1 },
      notional_amount: 100,
      state: "PREPARING",
      last_error_code: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [runningBotRow] });
      }
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total: "0" }] });
      }
      if (
        text.includes("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [
            { exchange: "lighter", environment: "testnet", config: run.config },
          ],
        });
      }
      if (text.includes("SELECT config FROM strategies")) {
        return Promise.resolve({ rows: [{ config: run.config }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [run] });
      }
      return okResult();
    });

    await expect(service.start("bot-1", "user-1")).rejects.toThrow(
      "redis publish threw"
    );
    expect(waitForEstimate).toHaveBeenCalledTimes(1);
    expect(cancelEstimateWait).toHaveBeenCalledWith(
      expect.objectContaining({ botId: "bot-1", runId: "run-1" }),
      "BOT_START dispatch threw before preparation was confirmed"
    );
  });

  it("start() 503s (fail-closed) when the snapshot is unavailable (balance/positions down)", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => {
        throw new Error("venue down");
      },
    });
    routeStart("0");

    await expect(service.start("bot-1", "user-1")).rejects.toMatchObject({
      statusCode: 503,
      code: "SESSION_CAP_UNAVAILABLE",
    });
  });

  it("createAndStart() 409s before inserting the session when the incoming notional exceeds the cap", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 500, existingExposure: 0 }),
    });
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.startsWith("SELECT config FROM strategies")) {
        return Promise.resolve({ rows: [{ config: {} }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
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

  it("attachStrategyRun() 409s when attached runs + new exceed the cap (bound-account scoped)", async () => {
    const snapshot = jest.fn().mockResolvedValue({
      cap: 500,
      existingExposure: 0,
    });
    service.setSessionCapProvider({ getAdmissionSnapshot: snapshot });
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [attachBotRow] });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [{ exchange: null, environment: null, config: {} }],
        });
      }
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total: "400" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      return okResult();
    });

    await expect(
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 200)
    ).rejects.toMatchObject({ statusCode: 409 });

    // Cap is scoped to the bot's bound account, never user-only.
    expect(snapshot).toHaveBeenCalledWith("user-1", "acc-1");
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO strategy_runs"),
      expect.anything()
    );
  });

  it("attachStrategyRun() succeeds and inserts when the pending aggregate fits the cap", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 5000, existingExposure: 0 }),
    });
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [attachBotRow] });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (text.startsWith("SELECT config FROM strategies")) {
        return Promise.resolve({ rows: [{ config: {} }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [{ exchange: null, environment: null, config: {} }],
        });
      }
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total: "400" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.startsWith("INSERT INTO strategy_runs")) {
        return Promise.resolve({ rows: [{ id: "run-2" }], rowCount: 1 });
      }
      return okResult();
    });

    const runId = await service.attachStrategyRun(
      "bot-1",
      "user-1",
      "strat-2",
      200
    );
    expect(runId).toBe("run-2");
  });

  it("start() 409s when an open venue position has already eaten the headroom", async () => {
    // cap 1,000; live venue exposure 600; pending 500 → 1,100 > 1,000.
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 600 }),
    });
    routeStart("500");

    await expect(service.start("bot-1", "user-1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE bot_instances"),
      expect.anything()
    );
  });

  it("start() dispatches when exposure + pending exactly equals the cap", async () => {
    // Boundary: `>` rejects, `==` admits (cap 1,000; exposure 400; pending 600).
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 400 }),
    });
    const toggle = jest
      .spyOn(strategyRepositoryAdapter, "toggleStrategy")
      .mockResolvedValue(undefined);
    routeStart("600");

    const result = await service.start("bot-1", "user-1");
    expect(result.botId).toBe("bot-1");
    toggle.mockRestore();
  });

  it("createAndStart() 409s when existing exposure leaves less headroom than the incoming run", async () => {
    // cap 1,000; venue exposure 700; incoming 400 → 1,100 > 1,000.
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 700 }),
    });
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-1" }] });
      }
      if (text.startsWith("SELECT config FROM strategies")) {
        return Promise.resolve({ rows: [{ config: {} }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      return okResult();
    });

    await expect(
      service.createAndStart("user-1", "strat-1", 400, "acc-1")
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO bot_instances"),
      expect.anything()
    );
  });

  it("attachStrategyRun() 400s a Kodiak strategy onto a live Lighter session with no run", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 5000, existingExposure: 0 }),
    });
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue({
      ...kodiakAccount,
      exchange: "lighter",
      environment: "testnet",
    });
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [attachBotRow] });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [
            {
              exchange: "kodiak",
              environment: "testnet",
              config: { symbol: "PERP_BTC_USDC" },
            },
          ],
        });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      return okResult();
    });

    await expect(
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 200)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("does not match account"),
    });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO strategy_runs"),
      expect.anything()
    );
  });

  it("attachStrategyRun() 400s when the session has no verifiable bound account", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 5000, existingExposure: 0 }),
    });
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue(null);
    const unboundBot = { ...attachBotRow, exchange_account_id: null };
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [unboundBot] });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      return okResult();
    });

    await expect(
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 200)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO strategy_runs"),
      expect.anything()
    );
  });

  it("attachStrategyRun() 409s when exposure + pending + incoming exceeds the cap (guard re-check)", async () => {
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 500 }),
    });
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [attachBotRow] });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [{ exchange: null, environment: null, config: {} }],
        });
      }
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total: "400" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      return okResult();
    });

    // 500 exposure + 400 pending + 200 incoming = 1,100 > 1,000.
    await expect(
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 200)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO strategy_runs"),
      expect.anything()
    );
  });

  it("attachStrategyRun() admits when exposure + pending + incoming exactly fits the cap", async () => {
    // Boundary: 400 exposure + 400 pending + 200 incoming = 1,000 ≤ 1,000.
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 400 }),
    });
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [attachBotRow] });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (text.startsWith("SELECT config FROM strategies")) {
        return Promise.resolve({ rows: [{ config: {} }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [{ exchange: null, environment: null, config: {} }],
        });
      }
      if (text.includes("SUM(notional_amount)")) {
        return Promise.resolve({ rows: [{ total: "400" }] });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.startsWith("INSERT INTO strategy_runs")) {
        return Promise.resolve({ rows: [{ id: "run-2" }], rowCount: 1 });
      }
      return okResult();
    });

    const runId = await service.attachStrategyRun(
      "bot-1",
      "user-1",
      "strat-2",
      200
    );
    expect(runId).toBe("run-2");
  });

  it("closes the concurrent-attach race: only one of two simultaneous attaches succeeds", async () => {
    // Simulate two POST /runs firing together against a $1,000 cap with $600
    // already attached. Each incoming run is $250, so both together ($1,100)
    // exceed the cap — exactly one must be admitted. The `transaction` mock
    // serializes on a lock chain (mimicking FOR UPDATE) and keeps shared
    // `attachedTotal` state, so the second attach recalculates the sum AFTER
    // the first has inserted and is rejected. Against the old pre-lock sum
    // read, both would pass on the stale $600 and over-fill the session.
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 0 }),
    });
    let attachedTotal = 600;
    let lockChain: Promise<unknown> = Promise.resolve();
    mockTransaction.mockImplementation(
      (
        cb: (client: {
          query: (t: string, p?: unknown[]) => unknown;
        }) => unknown
      ) => {
        const run = lockChain.then(async () => {
          const client = {
            query: (text: string, params: unknown[] = []) => {
              const t = String(text);
              // findUnresolvedExposureTx reports no unresolved exposure in
              // this test scenario (clean account).
              if (t.includes("residual_abandoned_at")) {
                return Promise.resolve({ rows: [], rowCount: 1 });
              }
              if (t.includes("SELECT id FROM bot_instances")) {
                return Promise.resolve({ rows: [{ id: "bot-1" }] });
              }
              if (t.includes("FROM strategies WHERE id")) {
                return Promise.resolve({
                  rows: [{ exchange: null, environment: null, config: {} }],
                });
              }
              if (t.includes("SUM(notional_amount)")) {
                return Promise.resolve({
                  rows: [{ total: String(attachedTotal) }],
                });
              }
              if (t.startsWith("INSERT INTO strategy_runs")) {
                attachedTotal += Number(params[3]);
                return Promise.resolve({
                  rows: [{ id: "run-x" }],
                  rowCount: 1,
                });
              }
              return Promise.resolve({ rows: [], rowCount: 1 });
            },
          };
          return cb(client);
        });
        lockChain = run.catch(() => undefined);
        return run;
      }
    );

    // Pre-transaction reads (bot row + strategy guards) go through mockQuery.
    mockQuery.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return Promise.resolve({ rows: [attachBotRow] });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [{ exchange: null, environment: null, config: {} }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const results = await Promise.allSettled([
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 250),
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 250),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
    });
    // Only one $250 run landed on top of the $600 base.
    expect(attachedTotal).toBe(850);

    // Restore the default routing transaction mock for any later test.
    mockTransaction.mockImplementation(
      async (cb: (client: { query: unknown }) => unknown) =>
        cb({
          query: (text: string, params?: unknown[]) => mockQuery(text, params),
        })
    );
  });
  it("closes the concurrent-attach race across sessions on the same account (account-level cap)", async () => {
    // Two different sessions (bot-1, bot-2) bound to the same account acc-1
    // fire attaches together against a $1,000 cap. Each run is $600, so both
    // together ($1,200) exceed the cap — exactly one must be admitted.
    // The account-level exchange_accounts FOR UPDATE lock serializes them and
    // the account-scoped pending sum makes the second see the first's run.
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 0 }),
    });
    let attachedTotal = 0;
    let lockChain: Promise<unknown> = Promise.resolve();
    mockTransaction.mockImplementation(
      (
        cb: (client: {
          query: (t: string, p?: unknown[]) => unknown;
        }) => unknown
      ) => {
        const run = lockChain.then(async () => {
          const client = {
            query: (text: string, params: unknown[] = []) => {
              const t = String(text);
              if (t.includes("SELECT id FROM exchange_accounts")) {
                return Promise.resolve({ rows: [{ id: "acc-1" }] });
              }
              if (t.includes("SELECT id FROM bot_instances WHERE id")) {
                return Promise.resolve({ rows: [{ id: "bot-x" }] });
              }
              if (t.includes("FROM strategies WHERE id")) {
                return Promise.resolve({
                  rows: [{ exchange: null, environment: null, config: {} }],
                });
              }
              if (t.includes("SUM(notional_amount)")) {
                return Promise.resolve({
                  rows: [{ total: String(attachedTotal) }],
                });
              }
              if (t.includes("FROM strategy_runs")) {
                return Promise.resolve({ rows: [] });
              }
              if (t.startsWith("INSERT INTO strategy_runs")) {
                attachedTotal += Number(params[3]);
                return Promise.resolve({
                  rows: [{ id: "run-x" }],
                  rowCount: 1,
                });
              }
              return Promise.resolve({ rows: [], rowCount: 1 });
            },
          };
          return cb(client);
        });
        lockChain = run.catch(() => undefined);
        return run;
      }
    );

    mockAccountAdapter.getAccountWithSecret.mockResolvedValue({
      id: "acc-1",
      exchange: "kodiak",
      environment: "mainnet",
      status: "ACTIVE",
    } as never);

    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        const botId = params?.[0];
        return Promise.resolve({
          rows: [
            {
              id: botId,
              user_id: "user-1",
              status: "RUNNING",
              desired_state: "RUNNING",
              actual_state: "RUNNING",
              engine_id: `engine-${botId}`,
              exchange_account_id: "acc-1",
            },
          ],
        });
      }
      if (text.startsWith("SELECT id FROM strategies")) {
        return Promise.resolve({ rows: [{ id: "strat-2" }] });
      }
      if (
        text.startsWith("SELECT exchange, environment, config FROM strategies")
      ) {
        return Promise.resolve({
          rows: [{ exchange: null, environment: null, config: {} }],
        });
      }
      if (text.includes("FROM strategy_runs")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const results = await Promise.allSettled([
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 600),
      service.attachStrategyRun("bot-2", "user-1", "strat-2", 600),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
    });
    // Only one $600 run landed against the $1,000 cap.
    expect(attachedTotal).toBe(600);

    // Restore the default routing transaction mock for any later test.
    mockTransaction.mockImplementation(
      async (cb: (client: { query: unknown }) => unknown) =>
        cb({
          query: (text: string, params?: unknown[]) => mockQuery(text, params),
        })
    );
  });

  // ===========================================
  // ACCOUNT-CAP CONCURRENCY AUDIT (Arch-3, review 2026-10-17)
  // ===========================================

  describe("account-cap concurrency audit (Arch-3)", () => {
    let service: BotLifecycleService;

    const kodiakAccount = {
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

    /** Restore the module-level routing transaction mock (see jest.mock above). */
    const restoreDefaultTransaction = () =>
      mockTransaction.mockImplementation(
        async (cb: (client: { query: unknown }) => unknown) =>
          cb({
            query: (text: string, params?: unknown[]) =>
              mockQuery(text, params),
          })
      );

    beforeEach(() => {
      jest.clearAllMocks();
      service = createWiredService({
        sendCommand: jest.fn().mockResolvedValue({
          success: true,
          messageId: "m1",
          correlationId: "c1",
        }),
      } as unknown as EngineProtocolService);
      service.setAuthorityChecker(async () => true);
      mockAccountAdapter.getAccountWithSecret.mockResolvedValue(kodiakAccount);
    });

    afterEach(() => {
      restoreDefaultTransaction();
      jest.restoreAllMocks();
    });

    it("closes the concurrent createAndStart race: only one of two simultaneous session creates is admitted", async () => {
      // Two POST /start calls fire together on the SAME account with DIFFERENT
      // strategies — the one interleaving the one-live-session-per-account
      // guard cannot catch, because neither tx has committed its STOPPED
      // session row when the other reads. Cap $1,000, venue exposure $0, each
      // boot run $600: both admitted = $1,200 of requested notional against a
      // $1,000 cap. The account-level `exchange_accounts FOR UPDATE` lock plus
      // the account-scoped pending re-read under it — the attach-path protocol
      // proven by the two concurrent-attach tests above (40e86fa) — must admit
      // exactly one and roll the loser back whole (no orphan session either).
      //
      // Arch-3 audit finding: before this test, createAndStart pre-checked the
      // cap OUTSIDE the tx and attached via attachRunTx, which locks only the
      // session row it just inserted — a no-op for cross-session concurrency.
      service.setSessionCapProvider({
        getAdmissionSnapshot: async () => ({ cap: 1000, existingExposure: 0 }),
      });

      // Commit-visible state: reads (pool AND in-tx) see only rows merged at
      // COMMIT; an uncommitted concurrent tx is invisible — READ COMMITTED.
      const committed = {
        accountPending: 0, // Σ notional over ALL the account's pending runs
        pendingByBot: new Map<string, number>(), // per-session view (legacy grain)
        createdSessions: 0,
      };
      let botSeq = 0;
      let runSeq = 0;

      interface TxState {
        accountDelta: number;
        botDelta: Map<string, number>;
        sessions: number;
      }

      // route(): one honest visibility model for BOTH channels — pool reads
      // (tx = null) see committed state only; in-tx reads additionally see the
      // tx's own buffered writes.
      const route = (
        text: string,
        params: unknown[],
        tx: TxState | null
      ): { rows: Record<string, unknown>[]; rowCount?: number } => {
        if (text.startsWith("SELECT id FROM strategies")) {
          return { rows: [{ id: params[0] }] };
        }
        if (
          text.startsWith(
            "SELECT exchange, environment, config FROM strategies"
          )
        ) {
          // Unbound legacy row: no venue gate, no symbol catalog fetch.
          return {
            rows: [{ exchange: null, environment: null, config: {} }],
          };
        }
        if (text.startsWith("SELECT config FROM strategies")) {
          return { rows: [{ config: {} }] };
        }
        if (text.startsWith("SELECT id FROM bot_instances WHERE id")) {
          // FOR UPDATE row lock — the row exists (own uncommitted insert).
          return { rows: [{ id: params[0] }], rowCount: 1 };
        }
        if (
          text.startsWith(
            "SELECT id FROM bot_instances WHERE exchange_account_id"
          )
        ) {
          // Live-or-parked session guard (findLiveSessionForAccount[Tx]). A
          // freshly inserted STOPPED session is not live, so an uncommitted
          // peer insert is BOTH invisible and predicate-exempt — this guard
          // alone never closed the create race.
          return { rows: [] };
        }
        if (text.startsWith("INSERT INTO bot_instances")) {
          if (tx) tx.sessions += 1;
          return { rows: [{ id: `bot-${++botSeq}` }], rowCount: 1 };
        }
        if (text.includes("SUM(notional_amount)")) {
          if (text.includes("exchange_account_id")) {
            // Account-grain sum (attach guard / fixed start gate): committed
            // total plus the calling tx's own uncommitted delta.
            return {
              rows: [
                {
                  total: String(
                    committed.accountPending + (tx?.accountDelta ?? 0)
                  ),
                },
              ],
            };
          }
          // Legacy bot-grain sum (params[0] = botId).
          return {
            rows: [
              {
                total: String(
                  committed.pendingByBot.get(String(params[0])) ?? 0
                ),
              },
            ],
          };
        }
        if (text.startsWith("INSERT INTO strategy_runs")) {
          const notional = Number(params[3]);
          if (tx) {
            tx.accountDelta += notional;
            const botId = String(params[0]);
            tx.botDelta.set(botId, (tx.botDelta.get(botId) ?? 0) + notional);
          }
          return { rows: [{ id: `run-${++runSeq}` }], rowCount: 1 };
        }
        if (text.includes("FROM strategy_runs")) {
          // Live-run guard + getRunsForBot fan-out: nothing live yet.
          return { rows: [] };
        }
        if (text.startsWith("SELECT id, user_id")) {
          // getOwnedBot on the delegated start() leg.
          return {
            rows: [
              {
                id: params[0],
                user_id: "user-1",
                status: "STOPPED",
                desired_state: "STOPPED",
                actual_state: "STOPPED",
                exchange_account_id: "acc-1",
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      };

      mockQuery.mockImplementation((sql: string, params: unknown[] = []) =>
        Promise.resolve(route(String(sql), params, null))
      );

      // Account-row lock chain: a tx that issues `exchange_accounts FOR UPDATE`
      // waits for the current holder's tx to end before proceeding. With no
      // such lock (the bug) both txs run fully concurrently — exactly the race.
      let accountLock: Promise<unknown> = Promise.resolve();
      mockTransaction.mockImplementation(
        async (cb: (client: { query: unknown }) => unknown) => {
          const tx: TxState = {
            accountDelta: 0,
            botDelta: new Map(),
            sessions: 0,
          };
          let holdsAccountLock = false;
          let releaseLock: () => void = () => {};
          const client = {
            query: (text: string, params: unknown[] = []) => {
              const t = String(text);
              if (
                t.startsWith("SELECT id FROM exchange_accounts") &&
                t.includes("FOR UPDATE")
              ) {
                // Postgres semantics: re-locking a row your own tx already
                // locks is a no-op — model it, or the guard's second issuance
                // of the lock would self-deadlock.
                if (holdsAccountLock) {
                  return Promise.resolve({
                    rows: [{ id: params[0] }],
                    rowCount: 1,
                  });
                }
                holdsAccountLock = true;
                const myTurn = accountLock;
                accountLock = new Promise<void>(res => {
                  releaseLock = res;
                });
                return myTurn.then(() => ({
                  rows: [{ id: params[0] }],
                  rowCount: 1,
                }));
              }
              return Promise.resolve(route(t, params, tx));
            },
          };
          try {
            const result = await cb(client);
            // COMMIT: merge the tx's buffered writes into visible state.
            committed.accountPending += tx.accountDelta;
            for (const [botId, n] of tx.botDelta) {
              committed.pendingByBot.set(
                botId,
                (committed.pendingByBot.get(botId) ?? 0) + n
              );
            }
            committed.createdSessions += tx.sessions;
            return result;
          } finally {
            releaseLock();
          }
        }
      );

      const results = await Promise.allSettled([
        service.createAndStart("user-1", "strat-1", 600, "acc-1"),
        service.createAndStart("user-1", "strat-2", 600, "acc-1"),
      ]);

      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(
        r => r.status === "rejected"
      ) as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ statusCode: 409 });
      // Only one $600 boot run landed against the $1,000 cap…
      expect(committed.accountPending).toBe(600);
      // …and the loser rolled back whole: no orphan session row either.
      expect(committed.createdSessions).toBe(1);
    });

    it("re-checks the live session inside the tx, not only on the pool (Arch-3)", async () => {
      // The in-tx duplicate-session guard must read on the caller's tx client:
      // a pool read runs on a different connection, cannot see a concurrent
      // tx's uncommitted session row, and holds no lock. Phase A's pre-tx
      // early-out legitimately stays on the pool (it is only an optimization),
      // so the pool sees exactly ONE guard read and the tx exactly ONE — the
      // authoritative one. Red (guard on the pool twice): tx reads 0, pool 2.
      service.setSessionCapProvider({
        getAdmissionSnapshot: async () => ({
          cap: Number.MAX_SAFE_INTEGER,
          existingExposure: 0,
        }),
      });
      jest
        .spyOn(strategyRepositoryAdapter, "toggleStrategy")
        .mockResolvedValue(undefined);

      const isSessionGuard = (t: string) =>
        t.includes("FROM bot_instances") &&
        t.includes("WHERE exchange_account_id") &&
        // findUnresolvedExposureTx also matches the two predicates above but
        // is the residual-admission guard, not the live-session guard.
        !t.includes("residual_abandoned_at");
      // Pool guard reads are counted via mockQuery.mock.calls below; the tx
      // channel is captured here directly by the transaction client mock.
      const txQueries: string[] = [];
      mockQuery.mockImplementation((sql: string, params: unknown[] = []) =>
        Promise.resolve(routeGuardProbe(String(sql), params, () => undefined))
      );
      mockTransaction.mockImplementation(
        async (cb: (client: { query: unknown }) => unknown) => {
          const client = {
            query: (text: string, params: unknown[] = []) => {
              txQueries.push(String(text));
              return Promise.resolve(
                routeGuardProbe(String(text), params, () => undefined)
              );
            },
          };
          return cb(client);
        }
      );

      /** Minimal routing for a single, race-free createAndStart call. */
      function routeGuardProbe(
        text: string,
        params: unknown[],
        record: (sql: string) => void
      ): { rows: Record<string, unknown>[]; rowCount?: number } {
        if (isSessionGuard(text)) record(text);
        if (text.startsWith("SELECT id FROM strategies")) {
          return { rows: [{ id: params[0] }] };
        }
        if (
          text.startsWith(
            "SELECT exchange, environment, config FROM strategies"
          )
        ) {
          return { rows: [{ exchange: null, environment: null, config: {} }] };
        }
        if (text.startsWith("SELECT config FROM strategies")) {
          return { rows: [{ config: {} }] };
        }
        if (text.startsWith("INSERT INTO bot_instances")) {
          return { rows: [{ id: "bot-1" }], rowCount: 1 };
        }
        if (text.startsWith("SELECT id FROM bot_instances WHERE id")) {
          return { rows: [{ id: params[0] }], rowCount: 1 };
        }
        if (text.startsWith("SELECT id, user_id")) {
          return {
            rows: [
              {
                id: params[0],
                user_id: "user-1",
                status: "STOPPED",
                desired_state: "STOPPED",
                actual_state: "STOPPED",
                exchange_account_id: "acc-1",
              },
            ],
          };
        }
        if (isSessionGuard(text)) {
          return { rows: [] };
        }
        if (text.includes("SUM(notional_amount)")) {
          return { rows: [{ total: "0" }] };
        }
        if (text.startsWith("INSERT INTO strategy_runs")) {
          return { rows: [{ id: "run-1" }], rowCount: 1 };
        }
        if (text.includes("FROM strategy_runs")) {
          return { rows: [] };
        }
        if (text.startsWith("SELECT id, user_id")) {
          return {
            rows: [
              {
                id: params[0],
                user_id: "user-1",
                status: "STOPPED",
                desired_state: "STOPPED",
                actual_state: "STOPPED",
                exchange_account_id: "acc-1",
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }

      await service.createAndStart("user-1", "strat-1", 600, "acc-1");

      const poolGuardReads = mockQuery.mock.calls.filter(([sql]) =>
        isSessionGuard(String(sql))
      );
      const txGuardReads = txQueries.filter(sql => isSessionGuard(sql));
      expect(txGuardReads).toHaveLength(1);
      expect(poolGuardReads).toHaveLength(1);
    });

    it("start() re-checks pending run notional at ACCOUNT grain (Arch-3)", async () => {
      // The start/resume gate re-checks `exposure + pending + incoming <= cap`
      // — the invariant is ACCOUNT-scoped, so the pending sum must be too.
      // A bot-grain sum here (the pre-audit shape) silently drops the pending
      // runs of every OTHER session bound to the same account, which is
      // exactly the sum the attach guard enforces.
      service.setSessionCapProvider({
        getAdmissionSnapshot: async () => ({ cap: 5000, existingExposure: 0 }),
      });
      const toggle = jest
        .spyOn(strategyRepositoryAdapter, "toggleStrategy")
        .mockResolvedValue(undefined);
      mockQuery.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.startsWith("SELECT id, user_id")) {
          // UNKNOWN (parked) so start() runs the admission gate rather than
          // the already-RUNNING short-circuit — the resume path.
          return Promise.resolve({
            rows: [
              {
                id: "bot-1",
                user_id: "user-1",
                status: "RUNNING",
                desired_state: "RUNNING",
                actual_state: "UNKNOWN",
                exchange_account_id: "acc-1",
              },
            ],
          });
        }
        if (text.includes("SUM(notional_amount)")) {
          return Promise.resolve({ rows: [{ total: "1000" }] });
        }
        if (text.includes("FROM strategy_runs")) {
          return Promise.resolve({ rows: [] });
        }
        return okResult();
      });

      await service.start("bot-1", "user-1");

      const sums = mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes("SUM(notional_amount)")
      );
      expect(sums).toHaveLength(1);
      const [sumSql, sumParams] = sums[0] as [string, unknown[]];
      // Account grain: join the session rows and filter by the bound account.
      expect(String(sumSql)).toContain("JOIN bot_instances");
      expect(String(sumSql)).toContain("exchange_account_id");
      expect(sumParams).toEqual(["acc-1"]);
      toggle.mockRestore();
    });
  });
});

// ============================================================
// RESIDUAL EXPOSURE ADMISSION (PLATFORM_REVIEW Priority 1)
// ============================================================

describe("residual exposure admission (Priority 1)", () => {
  let service: BotLifecycleService;
  let engineProtocol: { sendCommand: jest.Mock };

  const kodiakAccount = {
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

  const stoppableBotRow = {
    id: "bot-1",
    user_id: "user-1",
    status: "STOPPED",
    desired_state: "STOPPED",
    actual_state: "STOPPED",
    exchange_account_id: "acc-1",
  };

  const runningBotRow = {
    id: "bot-1",
    user_id: "user-1",
    status: "RUNNING",
    desired_state: "RUNNING",
    actual_state: "RUNNING",
    exchange_account_id: "acc-1",
  };

  /** The admission message the API must preserve verbatim (never "conflict"). */
  const admissionMsg = (sessionId: string) =>
    `Account has unresolved venue exposure from session ${sessionId}. Close it or abandon the residual before starting.`;

  const MARKER_REASON =
    "emergency_stop:FULL_SHUTDOWN; cleanup_incomplete: position 2.5 BTC not flattened: lighter create UNRESOLVED for 123";

  /** Restore the module-level routing transaction mock (see jest.mock above). */
  const restoreDefaultTransaction = () =>
    mockTransaction.mockImplementation(
      async (cb: (client: { query: unknown }) => unknown) =>
        cb({
          query: (text: string, params?: unknown[]) => mockQuery(text, params),
        })
    );

  interface RouteOptions {
    /** Row findUnresolvedExposureTx returns; null = clean account. */
    unresolvedId?: string | null;
    /** findBot row (ownership + binding). */
    ownedRow?: Record<string, unknown>;
    /** findResidualAbandonContextTx first-query row; null = not found. */
    context?: Record<string, unknown> | null;
    /** Symbols on the session's runs (abandon's unparsed-evidence gate). */
    runSymbols?: string[];
  }

  /**
   * One traffic router for createAndStart / attachStrategyRun / abandon flows.
   * Order matters: the guard branch must precede the generic bot_instances
   * branch, and SUM before the generic strategy_runs branch.
   */
  const routeAll = ({
    unresolvedId = null,
    ownedRow = stoppableBotRow as Record<string, unknown>,
    context = null,
    runSymbols = [],
  }: RouteOptions = {}) => {
    // The insert returns "bot-new"; later findBot reads must resolve that id
    // so start()'s dispatch payload carries the created session, not the
    // fixture's id.
    let insertedId: string | null = null;
    return mockQuery.mockImplementation(
      (sql: string, params: unknown[] = []) => {
        const text = String(sql);
        if (
          text.startsWith(
            "SELECT exchange, environment, config FROM strategies"
          )
        ) {
          return {
            rows: [{ exchange: null, environment: null, config: {} }],
          };
        }
        if (text.startsWith("SELECT id FROM strategies")) {
          return { rows: [{ id: params[0] }] };
        }
        // persistStopTx's binding read (pool or tx, depending on caller).
        if (text.startsWith("SELECT exchange_account_id FROM bot_instances")) {
          return { rows: [{ exchange_account_id: "acc-1" }] };
        }
        // findBot (getOwnedBot) — note the space after "id,".
        if (text.startsWith("SELECT id, user_id")) {
          return { rows: [{ ...ownedRow, id: insertedId ?? ownedRow.id }] };
        }
        if (text.includes("SUM(notional_amount)")) {
          return { rows: [{ total: "0" }] };
        }
        // Account row lock (FOR UPDATE).
        if (text.startsWith("SELECT id FROM exchange_accounts")) {
          return { rows: [{ id: params[0] }] };
        }
        // Abandon context (tx) — no space after commas, distinct from findBot.
        if (text.startsWith("SELECT id,user_id,exchange_account_id")) {
          return { rows: context ? [context] : [] };
        }
        // Session run symbols (abandon's unparsed-evidence gate).
        if (text.startsWith("SELECT DISTINCT COALESCE(config")) {
          return { rows: runSymbols.map(s => ({ symbol: s })) };
        }
        // Residual admission guard (findUnresolvedExposureTx).
        if (
          text.startsWith("SELECT id FROM bot_instances") &&
          text.includes("residual_abandoned_at")
        ) {
          return { rows: unresolvedId ? [{ id: unresolvedId }] : [] };
        }
        // Live-session guards (no residual predicate).
        if (text.startsWith("SELECT id FROM bot_instances")) {
          return { rows: [] };
        }
        if (text.startsWith("INSERT INTO bot_instances")) {
          insertedId = "bot-new";
          return { rows: [{ id: insertedId }], rowCount: 1 };
        }
        if (text.startsWith("INSERT INTO strategy_runs")) {
          return { rows: [{ id: "run-1" }], rowCount: 1 };
        }
        if (text.startsWith("INSERT INTO bot_lifecycle_events")) {
          return { rows: [], rowCount: 1 };
        }
        // Abandon resolution write.
        if (
          text.startsWith("UPDATE bot_instances") &&
          text.includes("residual_abandoned_at = CURRENT_TIMESTAMP")
        ) {
          return {
            rows: [{ residual_abandoned_at: "2026-01-05T00:00:00.000Z" }],
            rowCount: 1,
          };
        }
        if (text.startsWith("UPDATE bot_instances")) {
          return { rows: [], rowCount: 1 };
        }
        if (text.includes("FROM strategy_runs")) {
          return { rows: [] };
        }
        return okResult();
      }
    );
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
    service = createWiredService(
      engineProtocol as unknown as EngineProtocolService
    );
    service.setAuthorityChecker(async () => true);
    mockAccountAdapter.getAccountWithSecret.mockResolvedValue(kodiakAccount);
    service.setSessionCapProvider({
      getAdmissionSnapshot: async () => ({
        cap: 5000,
        existingExposure: 0,
      }),
    });
    restoreDefaultTransaction();
  });

  afterEach(() => {
    restoreDefaultTransaction();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------
  // The admission guard (createAndStart + attachStrategyRun)
  // ---------------------------------------------------------

  it("createAndStart 409s with the exact admission message and inserts no session when the account is dirty", async () => {
    routeAll({ unresolvedId: "bot-dirty" });

    await expect(
      service.createAndStart("user-1", "strat-1", 250, "acc-1")
    ).rejects.toMatchObject({
      statusCode: 409,
      message: admissionMsg("bot-dirty"),
    });

    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).startsWith("INSERT INTO bot_instances")
    );
    expect(inserts).toHaveLength(0);
    expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
  });

  it("runs the guard inside the tx: account FOR UPDATE first, unresolved select second, no insert after the hit", async () => {
    routeAll({ unresolvedId: "bot-dirty" });
    const txQueries: string[] = [];
    mockTransaction.mockImplementation(
      async (cb: (client: { query: unknown }) => unknown) =>
        cb({
          query: (text: string, params: unknown[] = []) => {
            txQueries.push(String(text));
            return mockQuery(text, params);
          },
        })
    );

    await expect(
      service.createAndStart("user-1", "strat-1", 250, "acc-1")
    ).rejects.toMatchObject({ statusCode: 409 });

    const lockIdx = txQueries.findIndex(q =>
      q.startsWith("SELECT id FROM exchange_accounts")
    );
    const guardIdx = txQueries.findIndex(q =>
      q.includes("residual_abandoned_at")
    );
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeGreaterThan(lockIdx);
    expect(
      txQueries.filter(q => q.startsWith("INSERT INTO bot_instances"))
    ).toHaveLength(0);
  });

  it("createAndStart 409s while a sibling session is still STOPPING (the marker window)", async () => {
    routeAll({ unresolvedId: "bot-stopping" });

    await expect(
      service.createAndStart("user-1", "strat-1", 250, "acc-1")
    ).rejects.toMatchObject({
      statusCode: 409,
      message: admissionMsg("bot-stopping"),
    });
  });

  it("attachStrategyRun 409s with the same message when another session on the account is unresolved", async () => {
    routeAll({
      unresolvedId: "bot-other",
      ownedRow: runningBotRow as Record<string, unknown>,
    });

    await expect(
      service.attachStrategyRun("bot-1", "user-1", "strat-2", 250)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: admissionMsg("bot-other"),
    });

    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).startsWith("INSERT INTO strategy_runs")
    );
    expect(inserts).toHaveLength(0);
  });

  it("after the residual is abandoned the account is clean: createAndStart proceeds and dispatches", async () => {
    routeAll({ unresolvedId: null }); // residual_abandoned_at set → guard misses
    const toggle = jest
      .spyOn(strategyRepositoryAdapter, "toggleStrategy")
      .mockResolvedValue(undefined);

    const result = await service.createAndStart(
      "user-1",
      "strat-1",
      250,
      "acc-1"
    );

    expect(result.actualState).toBe("STARTING");
    expect(
      mockQuery.mock.calls.filter(([sql]) =>
        String(sql).startsWith("INSERT INTO bot_instances")
      )
    ).toHaveLength(1);
    expect(engineProtocol.sendCommand).toHaveBeenCalledWith(
      "BOT_START",
      expect.objectContaining({ botId: "bot-new" }),
      expect.any(String)
    );
    toggle.mockRestore();
  });

  // ---------------------------------------------------------
  // abandonResidual
  // ---------------------------------------------------------

  const dirtyContext = (
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    id: "bot-1",
    user_id: "user-1",
    exchange_account_id: "acc-1",
    actual_state: "STOPPED",
    force_stop_reason: MARKER_REASON,
    residual_abandoned_at: null,
    ...overrides,
  });

  const abandonInput = (overrides: Record<string, unknown> = {}) => ({
    reason: "ops ack",
    acceptedQuantity: "2.5",
    symbol: "BTC",
    ...overrides,
  });

  const abandonUpdates = () =>
    mockQuery.mock.calls.filter(
      ([sql]) =>
        String(sql).startsWith("UPDATE bot_instances") &&
        String(sql).includes("residual_abandoned_at = CURRENT_TIMESTAMP")
    );

  it("abandonResidual 409s when the session is STOPPED without the cleanup_incomplete marker", async () => {
    routeAll({
      context: dirtyContext({
        force_stop_reason: "emergency_stop:FULL_SHUTDOWN",
      }),
    });

    await expect(
      service.abandonResidual("bot-1", "user-1", abandonInput())
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "Residual abandonment requires a STOPPED session with cleanup_incomplete evidence",
    });
    expect(abandonUpdates()).toHaveLength(0);
  });

  it("abandonResidual 409s a second abandon (residual_abandoned_at already set)", async () => {
    routeAll({
      context: dirtyContext({
        residual_abandoned_at: "2026-01-04T00:00:00.000Z",
      }),
    });

    await expect(
      service.abandonResidual("bot-1", "user-1", abandonInput())
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Residual has already been abandoned",
    });
    expect(abandonUpdates()).toHaveLength(0);
  });

  it("abandonResidual 400s a parsed quantity that is not the exact token (2.50 vs 2.5)", async () => {
    routeAll({ context: dirtyContext() });

    await expect(
      service.abandonResidual(
        "bot-1",
        "user-1",
        abandonInput({ acceptedQuantity: "2.50" })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message:
        "Accepted quantity and symbol must exactly match the cleanup evidence",
    });
    expect(abandonUpdates()).toHaveLength(0);
  });

  it("abandonResidual 400s a parsed symbol that does not match the evidence", async () => {
    routeAll({ context: dirtyContext() });

    await expect(
      service.abandonResidual(
        "bot-1",
        "user-1",
        abandonInput({ symbol: "ETH" })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message:
        "Accepted quantity and symbol must exactly match the cleanup evidence",
    });
  });

  it("abandonResidual stores an exact parsed match in one tx: resolution write + RESIDUAL_ABANDONED event, marker untouched", async () => {
    routeAll({ context: dirtyContext() });
    const txQueries: string[] = [];
    mockTransaction.mockImplementation(
      async (cb: (client: { query: unknown }) => unknown) =>
        cb({
          query: (text: string, params: unknown[] = []) => {
            txQueries.push(String(text));
            return mockQuery(text, params);
          },
        })
    );

    await service.abandonResidual(
      "bot-1",
      "user-1",
      abandonInput({ reason: "  ops ack  " })
    );

    // Resolution write: exact params, marker/state untouched by the SET list.
    const updates = abandonUpdates();
    expect(updates).toHaveLength(1);
    const [updateSql, updateParams] = updates[0] as [string, unknown[]];
    expect(updateParams).toEqual([
      "bot-1",
      "user-1",
      "user-1",
      "ops ack", // trimmed
      "2.5",
      "BTC",
    ]);
    expect(String(updateSql)).not.toContain("force_stop_reason =");
    // Only the SET clause may not assign these — the WHERE predicate
    // legitimately reads actual_state = 'STOPPED' and force_stop_reason LIKE.
    const setClause = String(updateSql).slice(
      String(updateSql).indexOf("SET"),
      String(updateSql).indexOf("WHERE")
    );
    expect(setClause).not.toContain("actual_state =");
    expect(setClause).not.toContain("force_stop_reason =");

    // Event: self-contained audit payload, same tx. The adapter inlines the
    // event_type literal in the SQL rather than binding it as a param.
    const events = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("'RESIDUAL_ABANDONED'")
    );
    expect(events).toHaveLength(1);
    const eventJson = String((events[0][1] as unknown[])[1]);
    expect(eventJson).toContain('"resolution":"parsed"');
    expect(eventJson).toContain('"acceptedQuantity":"2.5"');
    expect(eventJson).toContain('"rawParserInput"');
    expect(eventJson).toContain('"residualAbandonedAt"');

    // Tx query order: account lock → context read → symbols → write → event.
    expect(txQueries[0]).toMatch(/^SELECT id FROM exchange_accounts/);
    expect(txQueries[1]).toMatch(/^SELECT id,user_id,exchange_account_id/);
    expect(txQueries[2]).toMatch(/^SELECT DISTINCT COALESCE\(config/);
    expect(txQueries[3]).toMatch(/^UPDATE bot_instances/);
    expect(txQueries[4]).toMatch(/^INSERT INTO bot_lifecycle_events/);
  });

  it("abandonResidual 400s an unparsed-evidence symbol that is not on the session's runs", async () => {
    routeAll({
      context: dirtyContext({
        force_stop_reason: "cleanup_incomplete: exposure unknown",
      }),
      runSymbols: ["BTC"],
    });

    await expect(
      service.abandonResidual(
        "bot-1",
        "user-1",
        abandonInput({ symbol: "ETH" })
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message:
        "For unparsed cleanup evidence, symbol must match a strategy symbol from this session",
    });
    expect(abandonUpdates()).toHaveLength(0);
  });

  it("abandonResidual stores operator-accepted values for unparsed evidence (never a parser-implied zero)", async () => {
    routeAll({
      context: dirtyContext({
        force_stop_reason: "cleanup_incomplete: exposure unknown",
      }),
      runSymbols: ["BTC"],
    });

    await service.abandonResidual(
      "bot-1",
      "user-1",
      abandonInput({ reason: "ops ack", acceptedQuantity: "0" })
    );

    const events = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("'RESIDUAL_ABANDONED'")
    );
    expect(events).toHaveLength(1);
    const eventJson = String((events[0][1] as unknown[])[1]);
    expect(eventJson).toContain('"resolution":"operator"');
    expect(eventJson).toContain('"acceptedQuantity":"0"');
    expect(eventJson).toContain('"operatorFallback"');
    expect(eventJson).toContain('"rawParserInput"');
  });

  it("abandonResidual 409s a legacy bot with no bound exchange account", async () => {
    routeAll({
      ownedRow: {
        ...stoppableBotRow,
        exchange_account_id: null,
      } as Record<string, unknown>,
    });

    await expect(
      service.abandonResidual("bot-1", "user-1", abandonInput())
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Bot is not bound to an exchange account",
    });
  });

  it("abandonResidual 404s a bot the caller does not own", async () => {
    routeAll({
      ownedRow: { ...stoppableBotRow, user_id: "someone-else" } as Record<
        string,
        unknown
      >,
    });

    await expect(
      service.abandonResidual("bot-1", "user-1", abandonInput())
    ).rejects.toMatchObject({ statusCode: 404, message: "Bot not found" });
  });

  // ---------------------------------------------------------
  // Deterministic two-connection concurrency
  // ---------------------------------------------------------

  it("two concurrent createAndStart against one dirty account: neither is admitted, no session row appears", async () => {
    routeAll({ unresolvedId: "bot-dirty" });

    // Lock chain serializes the two txs like FOR UPDATE does (READ COMMITTED:
    // each tx sees the dirty row after the other rolls back — the row never
    // disappears, so the loser is refused too).
    let lockChain: Promise<unknown> = Promise.resolve();
    mockTransaction.mockImplementation(
      (cb: (client: { query: unknown }) => unknown) => {
        const run = lockChain.then(() =>
          cb({
            query: (text: string, params: unknown[] = []) =>
              mockQuery(text, params),
          })
        );
        lockChain = run.catch(() => undefined);
        return run;
      }
    );

    const results = await Promise.allSettled([
      service.createAndStart("user-1", "strat-1", 250, "acc-1"),
      service.createAndStart("user-1", "strat-2", 250, "acc-1"),
    ]);

    expect(results.every(r => r.status === "rejected")).toBe(true);
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        statusCode: 409,
        message: admissionMsg("bot-dirty"),
      });
    }
    expect(
      mockQuery.mock.calls.filter(([sql]) =>
        String(sql).startsWith("INSERT INTO bot_instances")
      )
    ).toHaveLength(0);
  });

  it("abandon vs the STOPPED transition: abandon waits for the committed marker, then resolves without touching it", async () => {
    // Honest state model shared by both connections.
    const state = {
      actual: "STOPPING",
      reason: null as string | null,
      abandonedAt: null as string | null,
    };
    const routeStateful = (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      if (text.startsWith("SELECT id, user_id")) {
        return { rows: [{ ...stoppableBotRow, actual_state: state.actual }] };
      }
      if (text.startsWith("SELECT exchange_account_id FROM bot_instances")) {
        return { rows: [{ exchange_account_id: "acc-1" }] };
      }
      if (text.startsWith("SELECT id FROM exchange_accounts")) {
        return { rows: [{ id: params[0] }] };
      }
      if (text.startsWith("SELECT id,user_id,exchange_account_id")) {
        return {
          rows: [
            {
              id: "bot-1",
              user_id: "user-1",
              exchange_account_id: "acc-1",
              actual_state: state.actual,
              force_stop_reason: state.reason,
              residual_abandoned_at: state.abandonedAt,
            },
          ],
        };
      }
      if (text.startsWith("SELECT DISTINCT COALESCE(config")) {
        return { rows: [{ symbol: "BTC" }] };
      }
      // persistStopTx: CAS on the last param ($12 with the marker present).
      if (
        text.startsWith("UPDATE bot_instances") &&
        text.includes("desired_state = $2")
      ) {
        const expected = params[params.length - 1];
        if (state.actual !== expected) return { rows: [], rowCount: 0 };
        state.actual = String(params[2]);
        if (params.length === 12) state.reason = String(params[10]);
        return { rows: [], rowCount: 1 };
      }
      // Abandon resolution write.
      if (
        text.startsWith("UPDATE bot_instances") &&
        text.includes("residual_abandoned_at = CURRENT_TIMESTAMP")
      ) {
        state.abandonedAt = "2026-01-05T00:00:00.000Z";
        return {
          rows: [{ residual_abandoned_at: state.abandonedAt }],
          rowCount: 1,
        };
      }
      if (text.startsWith("INSERT INTO bot_lifecycle_events")) {
        return { rows: [], rowCount: 1 };
      }
      return okResult();
    };
    mockQuery.mockImplementation(routeStateful);

    // FIFO lock chain; ONLY the first tx (the stop transition) waits on the
    // gate, so the abandon tx queues behind the in-flight stop exactly like a
    // second connection waiting on the account row lock.
    let releaseStop!: () => void;
    const stopGate = new Promise<void>(r => {
      releaseStop = r;
    });
    let lockChain: Promise<unknown> = Promise.resolve();
    let firstTx = true;
    const txQueries: string[] = [];
    mockTransaction.mockImplementation(
      (cb: (client: { query: unknown }) => unknown) => {
        const run = lockChain.then(async () => {
          if (firstTx) {
            firstTx = false;
            await stopGate;
          }
          return cb({
            query: (text: string, params: unknown[] = []) => {
              txQueries.push(String(text));
              return routeStateful(text, params);
            },
          });
        });
        lockChain = run.catch(() => undefined);
        return run;
      }
    );

    const adapter = new BotLifecycleRepositoryAdapter();
    const transitionInput = {
      desiredState: "STOPPED",
      actualState: "STOPPED",
      engineId: "engine-1",
      startedAt: null,
      stoppedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    } as Parameters<typeof adapter.persistStopTx>[1];

    // Connection A: engine writes STOPPED + marker atomically (held mid-tx).
    const stopP = adapter.persistStopTx(
      "bot-1",
      transitionInput,
      "STOPPING" as Parameters<typeof adapter.persistStopTx>[2],
      MARKER_REASON
    );
    // Connection B: operator abandon — queues behind A on the account lock.
    const abandonP = service.abandonResidual("bot-1", "user-1", {
      reason: "ops ack",
      acceptedQuantity: "2.5",
      symbol: "BTC",
    });
    // Let B reach the lock queue, then let A commit.
    await new Promise(r => setTimeout(r, 0));
    releaseStop();

    await expect(stopP).resolves.toBe(true);
    await expect(abandonP).resolves.toBeUndefined();

    // Final state: STOPPED + marker preserved; only the abandon stamp added.
    expect(state.actual).toBe("STOPPED");
    expect(state.reason).toBe(MARKER_REASON);
    expect(state.abandonedAt).not.toBeNull();

    // Interleaving evidence: stop's UPDATE committed before B's tx began, and
    // B's tx order is lock → context → symbols → resolution write → event.
    const stopUpdateIdx = txQueries.findIndex(
      q =>
        q.startsWith("UPDATE bot_instances") && q.includes("desired_state = $2")
    );
    expect(stopUpdateIdx).toBeGreaterThanOrEqual(0);
    const afterStop = txQueries.slice(stopUpdateIdx + 1);
    expect(afterStop[0]).toMatch(/^SELECT id FROM exchange_accounts/);
    expect(afterStop[1]).toMatch(/^SELECT id,user_id,exchange_account_id/);
    expect(afterStop[2]).toMatch(/^SELECT DISTINCT COALESCE\(config/);
    expect(afterStop[3]).toMatch(/^UPDATE bot_instances/);
    expect(afterStop[4]).toMatch(/^INSERT INTO bot_lifecycle_events/);
  });
});
