/** @format */

import { createBotCommand, ProtocolMessage } from "@trade-bot/shared";
import { processMessage } from "../command-consumer";
import { BotManager } from "../../application/bot-manager";
import { CommandError } from "../../application/command-error";
import {
  RedisStreamOperations,
  StreamMessage,
} from "../../infrastructure/redis/streams";

/**
 * Dispatch semantics of the Redis Streams command consumer (regression pin
 * for ledger L18: the legacy flat-shape guards silently ACKed protocol
 * BOT_START/BOT_STOP envelopes without dispatching → ENGINE_NO_RESPONSE).
 */
describe("command-consumer processMessage", () => {
  function makeStreamOps(deliveries = 0): {
    acks: string[];
    ops: RedisStreamOperations;
    getPendingDeliveries: jest.Mock;
  } {
    const acks: string[] = [];
    const getPendingDeliveries = jest.fn(async () => deliveries);
    const ops = {
      ack: jest.fn(
        async (_stream: string, _group: string, streamId: string) => {
          acks.push(streamId);
          return { success: true as const };
        }
      ),
      getPendingDeliveries,
    };
    return {
      acks,
      ops: ops as unknown as RedisStreamOperations,
      getPendingDeliveries,
    };
  }

  function makeManager(): {
    manager: BotManager;
    publishAccepted: jest.Mock;
    handleStart: jest.Mock;
    handleStop: jest.Mock;
    handleEmergencyStop: jest.Mock;
  } {
    const publishAccepted = jest.fn().mockResolvedValue(undefined);
    const handleStart = jest.fn().mockResolvedValue(undefined);
    const handleStop = jest.fn().mockResolvedValue(undefined);
    const handleEmergencyStop = jest.fn().mockResolvedValue(undefined);
    const manager = {
      publishAccepted,
      handleStart,
      handleStop,
      handleEmergencyStop,
    };
    return {
      manager: manager as unknown as BotManager,
      publishAccepted,
      handleStart,
      handleStop,
      handleEmergencyStop,
    };
  }

  function msg(id: string, data: unknown): StreamMessage {
    return { id, data: data as StreamMessage["data"] };
  }

  it("dispatches a protocol BOT_START envelope (publishAccepted + handleStart) and ACKs", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, publishAccepted, handleStart, handleStop } = makeManager();
    const command = createBotCommand(
      "BOT_START",
      {
        botId: "bot-1",
        userId: "user-1",
        strategyId: "strategy-1",
        configVersion: 1,
        config: { symbol: "BTC-USD" },
      },
      "corr-1"
    );

    await processMessage(ops, manager, msg("1-0", command), new Set());

    expect(publishAccepted).toHaveBeenCalledTimes(1);
    expect(publishAccepted).toHaveBeenCalledWith(
      ops,
      "bot-1",
      "BOT_START",
      "corr-1"
    );
    expect(handleStart).toHaveBeenCalledWith(
      ops,
      "bot-1",
      "user-1",
      "strategy-1",
      { symbol: "BTC-USD" },
      "corr-1"
    );
    expect(handleStop).not.toHaveBeenCalled();
    expect(acks).toEqual(["1-0"]);
  });

  it("dispatches a protocol EMERGENCY_STOP envelope (accept + handleEmergencyStop) and ACKs", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, publishAccepted, handleStop, handleEmergencyStop } =
      makeManager();
    const command = createBotCommand(
      "EMERGENCY_STOP",
      { botId: "bot-1", action: "FULL_SHUTDOWN" },
      "corr-3"
    );

    await processMessage(ops, manager, msg("1-2", command), new Set());

    // M1: the panic path must be a real command - ACKed like every other
    // consumed command, with the cleanup action handed to the manager.
    expect(publishAccepted).toHaveBeenCalledTimes(1);
    expect(publishAccepted).toHaveBeenCalledWith(
      ops,
      "bot-1",
      "EMERGENCY_STOP",
      "corr-3"
    );
    expect(handleEmergencyStop).toHaveBeenCalledWith(
      ops,
      "bot-1",
      "FULL_SHUTDOWN",
      "corr-3"
    );
    expect(handleStop).not.toHaveBeenCalled();
    expect(acks).toEqual(["1-2"]);
  });

  it("ACCs a malformed EMERGENCY_STOP payload without dispatching", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, handleEmergencyStop, handleStart, handleStop } =
      makeManager();
    // Unknown action fails the guard (payload never reaches the manager).
    const command = createBotCommand(
      "EMERGENCY_STOP",
      { botId: "bot-1", action: "NOPE" },
      "corr-4"
    );

    await processMessage(ops, manager, msg("1-3", command), new Set());

    expect(handleEmergencyStop).not.toHaveBeenCalled();
    expect(handleStart).not.toHaveBeenCalled();
    expect(handleStop).not.toHaveBeenCalled();
    expect(acks).toEqual(["1-3"]);
  });

  it("dispatches a protocol BOT_STOP envelope (accept + handleStop) and ACKs", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, publishAccepted, handleStart, handleStop } = makeManager();
    const command = createBotCommand("BOT_STOP", { botId: "bot-1" }, "corr-2");

    await processMessage(ops, manager, msg("1-1", command), new Set());

    // L21: a consumed command must be ACKed even when the engine-side work is a
    // stop - otherwise the backend's tracked row stays PENDING and a successful
    // stop is burned as COMMAND_NEVER_DELIVERED by the timeout sweep.
    expect(publishAccepted).toHaveBeenCalledTimes(1);
    expect(publishAccepted).toHaveBeenCalledWith(
      ops,
      "bot-1",
      "BOT_STOP",
      "corr-2"
    );
    expect(handleStop).toHaveBeenCalledTimes(1);
    expect(handleStop).toHaveBeenCalledWith(ops, "bot-1", "corr-2");
    // The accept must be published before the work starts.
    expect(publishAccepted.mock.invocationCallOrder[0]).toBeLessThan(
      handleStop.mock.invocationCallOrder[0]
    );
    expect(handleStart).not.toHaveBeenCalled();
    expect(acks).toEqual(["1-1"]);
  });

  it("dispatches a messageId at most once (duplicate delivery is ACKed, not re-dispatched)", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, handleStop } = makeManager();
    const command = createBotCommand("BOT_STOP", { botId: "bot-1" });
    const seen = new Set<string>();

    await processMessage(ops, manager, msg("1-2", command), seen);
    await processMessage(ops, manager, msg("2-2", command), seen);

    expect(handleStop).toHaveBeenCalledTimes(1);
    expect(acks).toEqual(["1-2", "2-2"]);
  });

  it("ACKs the legacy flat START_BOT shape without dispatching (not a protocol envelope)", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, publishAccepted, handleStart, handleStop } = makeManager();
    const legacy = {
      type: "START_BOT",
      engineId: "engine-1",
      timestamp: Date.now(),
      botId: "bot-1",
      strategyId: "strategy-1",
      config: {},
      credentials: {},
    };

    await processMessage(ops, manager, msg("1-3", legacy), new Set());

    expect(publishAccepted).not.toHaveBeenCalled();
    expect(handleStart).not.toHaveBeenCalled();
    expect(handleStop).not.toHaveBeenCalled();
    expect(acks).toEqual(["1-3"]);
  });

  it("ACKs an unknown command type without dispatching", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, publishAccepted, handleStart, handleStop } = makeManager();
    const command = createBotCommand("BOT_STOP", { botId: "bot-1" });
    (command as ProtocolMessage<unknown>).type = "BOT_PAUSE";

    await processMessage(ops, manager, msg("1-4", command), new Set());

    expect(publishAccepted).not.toHaveBeenCalled();
    expect(handleStart).not.toHaveBeenCalled();
    expect(handleStop).not.toHaveBeenCalled();
    expect(acks).toEqual(["1-4"]);
  });

  it("ACKs a BOT_STATUS_REQUEST without touching start/stop", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, publishAccepted, handleStart, handleStop } = makeManager();
    const command = createBotCommand("BOT_STATUS_REQUEST", {
      botId: "bot-1",
    });

    await processMessage(ops, manager, msg("1-5", command), new Set());

    expect(publishAccepted).not.toHaveBeenCalled();
    expect(handleStart).not.toHaveBeenCalled();
    expect(handleStop).not.toHaveBeenCalled();
    expect(acks).toEqual(["1-5"]);
  });

  // ===========================================
  // L22: business failures ACK, transient failures stop at the poison cap
  // ===========================================

  function startCommand(correlationId: string): ProtocolMessage<unknown> {
    return createBotCommand(
      "BOT_START",
      {
        botId: "bot-1",
        userId: "user-1",
        strategyId: "strategy-1",
        configVersion: 1,
        config: { symbol: "BTC-USD" },
      },
      correlationId
    ) as ProtocolMessage<unknown>;
  }

  it("ACKs a business failure (non-retryable CommandError) instead of redelivering it", async () => {
    const { acks, ops, getPendingDeliveries } = makeStreamOps();
    const { manager, handleStart } = makeManager();
    handleStart.mockRejectedValue(new CommandError(false, "unknown market"));

    await processMessage(
      ops,
      manager,
      msg("1-22", startCommand("corr-a")),
      new Set()
    );

    expect(acks).toEqual(["1-22"]);
    // The non-retryable branch resolves immediately: no PEL round-trip needed.
    expect(getPendingDeliveries).not.toHaveBeenCalled();
  });

  it("leaves a transient failure pending while it is under the poison threshold", async () => {
    const { acks, ops } = makeStreamOps(3);
    const { manager, handleStart } = makeManager();
    handleStart.mockRejectedValue(new Error("redis blip"));

    await processMessage(
      ops,
      manager,
      msg("1-23", startCommand("corr-b")),
      new Set()
    );

    expect(acks).toEqual([]);
  });

  it("ACKs and drops a command that failed past the poison threshold (L22)", async () => {
    // == PENDING_POISON_MAX_DELIVERIES (default 10): the entry has already been
    // redelivered enough times that retrying can only keep the PEL spinning.
    const { acks, ops } = makeStreamOps(10);
    const { manager, handleStart } = makeManager();
    handleStart.mockRejectedValue(new Error("keeps failing"));

    await processMessage(
      ops,
      manager,
      msg("1-24", startCommand("corr-c")),
      new Set()
    );

    expect(acks).toEqual(["1-24"]);
  });
});
