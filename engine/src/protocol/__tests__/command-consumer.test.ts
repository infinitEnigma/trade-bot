/** @format */

import { createBotCommand, ProtocolMessage } from "@trade-bot/shared";
import { processMessage } from "../command-consumer";
import { BotManager } from "../../application/bot-manager";
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
  function makeStreamOps(): {
    acks: string[];
    ops: RedisStreamOperations;
  } {
    const acks: string[] = [];
    const ops = {
      ack: jest.fn(
        async (_stream: string, _group: string, streamId: string) => {
          acks.push(streamId);
          return { success: true as const };
        }
      ),
    };
    return { acks, ops: ops as unknown as RedisStreamOperations };
  }

  function makeManager(): {
    manager: BotManager;
    publishAccepted: jest.Mock;
    handleStart: jest.Mock;
    handleStop: jest.Mock;
  } {
    const publishAccepted = jest.fn().mockResolvedValue(undefined);
    const handleStart = jest.fn().mockResolvedValue(undefined);
    const handleStop = jest.fn().mockResolvedValue(undefined);
    const manager = { publishAccepted, handleStart, handleStop };
    return {
      manager: manager as unknown as BotManager,
      publishAccepted,
      handleStart,
      handleStop,
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

  it("dispatches a protocol BOT_STOP envelope to handleStop and ACKs", async () => {
    const { acks, ops } = makeStreamOps();
    const { manager, publishAccepted, handleStart, handleStop } = makeManager();
    const command = createBotCommand("BOT_STOP", { botId: "bot-1" }, "corr-2");

    await processMessage(ops, manager, msg("1-1", command), new Set());

    expect(handleStop).toHaveBeenCalledTimes(1);
    expect(handleStop).toHaveBeenCalledWith(ops, "bot-1", "corr-2");
    expect(publishAccepted).not.toHaveBeenCalled();
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
});
