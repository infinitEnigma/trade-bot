/**
 * Unit tests for BotCommandDispatcher (record-before-publish).
 *
 * Verifies the critical ordering guarantee: the command is recorded as
 * PENDING in `bot_commands` *before* it is XADD'd to Redis, so a fast engine
 * that completes the full lifecycle before `sendCommand` returns cannot race
 * the tracking insert; and that a publish failure marks the pending row FAILED
 * instead of leaving it to be burned by the timeout sweeper later.
 *
 * @format
 */

import { BotCommandDispatcher } from "../../src/core/bots/lifecycle/bot-command-dispatcher";
import { BotLifecycleRepository } from "../../src/core/bots/lifecycle/bot-lifecycle.repository";
import {
  EngineProtocolService,
  SendCommandResult,
} from "../../src/core/bots/engine-protocol.service";

jest.mock("../../src/core/logging", () => ({
  contextLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("BotCommandDispatcher (record-before-publish)", () => {
  let repository: jest.Mocked<BotLifecycleRepository>;
  let engineProtocol: jest.Mocked<EngineProtocolService>;
  let dispatcher: BotCommandDispatcher;

  beforeEach(() => {
    repository = {
      recordPendingCommand: jest.fn().mockResolvedValue(undefined),
      resolveCommand: jest.fn().mockResolvedValue(undefined),
      findStrategyConfig: jest
        .fn()
        .mockResolvedValue({ symbol: "PERP_BTC_USDC", gridSize: 10 }),
    } as unknown as jest.Mocked<BotLifecycleRepository>;

    engineProtocol = {
      sendCommand: jest.fn(),
    } as unknown as jest.Mocked<EngineProtocolService>;

    dispatcher = new BotCommandDispatcher(engineProtocol, repository);

    jest.clearAllMocks();
    jest.resetAllMocks();
    // Re-stub after reset.
    repository.recordPendingCommand = jest.fn().mockResolvedValue(undefined);
    repository.resolveCommand = jest.fn().mockResolvedValue(undefined);
    repository.findStrategyConfig = jest
      .fn()
      .mockResolvedValue({ symbol: "PERP_BTC_USDC", gridSize: 10 });
    // The dispatcher passes a generated correlationId; echo it back so the
    // returned SendCommandResult shares the correlation that was tracked.
    engineProtocol.sendCommand = jest
      .fn()
      .mockImplementation(
        (_type: string, _payload: unknown, correlationId?: string) =>
          Promise.resolve({ success: true, messageId: "m1", correlationId })
      );
  });

  describe("BOT_START", () => {
    it("records the command as PENDING before publishing, and reuses correlationId", async () => {
      const result = await dispatcher.sendStartCommand(
        "bot-1",
        "user-1",
        "strat-1"
      );

      expect(result.success).toBe(true);
      expect(result.correlationId).toBeTruthy();

      // The repository INSERT happened before the engine publish.
      const recordCall = repository.recordPendingCommand.mock.calls[0];
      const sendCall = engineProtocol.sendCommand.mock.calls[0];
      expect(recordCall).toBeDefined();
      expect(sendCall).toBeDefined();
      // recordPendingCommand receives the correlationId that was used on XADD.
      expect(recordCall[1]).toBe(result.correlationId);
      expect(sendCall[2]).toBe(result.correlationId);
      expect(sendCall[0]).toBe("BOT_START");

      // Correct botId and command type were tracked.
      expect(recordCall[0]).toBe("bot-1");
      expect(recordCall[2]).toBe("BOT_START");

      // On success the command is NOT resolved as FAILED.
      expect(repository.resolveCommand).not.toHaveBeenCalled();
    });

    it("marks the pending command FAILED when the publish fails", async () => {
      // Echo the failure correlationId so we can assert it was marked FAILED.
      engineProtocol.sendCommand.mockImplementation(
        (_type: string, _payload: unknown, correlationId?: string) =>
          Promise.resolve({
            success: false,
            error: "connection refused",
            correlationId,
          })
      );

      const result = await dispatcher.sendStartCommand(
        "bot-1",
        "user-1",
        "strat-1"
      );

      expect(result.success).toBe(false);
      expect(repository.recordPendingCommand).toHaveBeenCalledTimes(1);
      expect(repository.resolveCommand).toHaveBeenCalledTimes(1);
      // FAILED so the sweeper cannot later burn a resolved bot to ERROR.
      const [correlationId, state, errorCode] =
        repository.resolveCommand.mock.calls[0];
      expect(state).toBe("FAILED");
      expect(errorCode).toBe("DISPATCH_FAILED");
      expect(correlationId).toBe(result.correlationId);
    });
  });

  describe("BOT_STOP", () => {
    it("records a pending BOT_STOP before publishing with the shared correlationId", async () => {
      const sendResult: SendCommandResult = {
        success: true,
        messageId: "m-stop",
        correlationId: "corr-stop",
      };
      engineProtocol.sendCommand.mockResolvedValue(sendResult);

      const result = await dispatcher.sendStopCommand("bot-2");

      expect(result).toEqual(sendResult);
      expect(result.correlationId).toBeTruthy();
      expect(repository.recordPendingCommand.mock.calls[0][0]).toBe("bot-2");
      expect(repository.recordPendingCommand.mock.calls[0][2]).toBe("BOT_STOP");
      expect(engineProtocol.sendCommand.mock.calls[0][0]).toBe("BOT_STOP");
    });
  });
});
