/**
 * Bot Command Dispatcher - Backend → Engine command sending
 *
 * Wraps the EngineProtocolService with lifecycle-specific payloads and
 * records each delivered command as PENDING for timeout supervision.
 *
 * @format
 */

import {
  EngineProtocolService,
  SendCommandResult,
} from "../engine-protocol.service";
import { contextLogger as logger } from "../../logging";
import { BotLifecycleRepository } from "./bot-lifecycle.repository";

export class BotCommandDispatcher {
  constructor(
    private engineProtocol: EngineProtocolService,
    private repository: BotLifecycleRepository
  ) {}

  /**
   * Send BOT_START. Non-secret strategy configuration travels with the
   * command; the engine fetches credentials out-of-band after COMMAND_ACCEPTED.
   *
   * The command is tracked as PENDING *before* it is published so a fast
   * engine that completes the whole lifecycle before `sendCommand` returns
   * cannot leave an orphaned PENDING row: the engine's events resolve the
   * already-existing row, and the timeout sweeper can never later burn a
   * resolved bot to ERROR.
   */
  async sendStartCommand(
    botId: string,
    userId: string,
    strategyId: string
  ): Promise<SendCommandResult> {
    const config = await this.repository.findStrategyConfig(strategyId);
    return this.publishTrackedCommand("BOT_START", {
      botId,
      userId,
      strategyId,
      configVersion: 1,
      config,
    });
  }

  /** Send BOT_STOP for a bot instance. */
  sendStopCommand(botId: string): Promise<SendCommandResult> {
    return this.publishTrackedCommand("BOT_STOP", { botId });
  }

  /**
   * Record the command as PENDING, then publish it. Order matters:
   * 1. Generate correlationId
   * 2. INSERT bot_commands(PENDING)
   * 3. XADD command
   * 4. if XADD fails → mark the pending command FAILED
   */
  private async publishTrackedCommand(
    type: "BOT_START" | "BOT_STOP",
    payload: unknown
  ): Promise<SendCommandResult> {
    const correlationId = crypto.randomUUID();
    const commandType = type;

    // Track BEFORE publishing so the engine's (possibly already-processed)
    // events resolve an existing row instead of racing an insert.
    await this.repository.recordPendingCommand(
      botIdOf(payload),
      correlationId,
      commandType
    );

    const result = await this.engineProtocol.sendCommand(
      type,
      payload as never,
      correlationId
    );

    if (!result.success) {
      // Redis rejected the command - mark the tracked row FAILED so it
      // is not left PENDING to be burned by the timeout sweeper later.
      await this.repository.resolveCommand(
        correlationId,
        "FAILED",
        "DISPATCH_FAILED",
        result.error
      );
    }

    return result;
  }

  /**
   * Track a delivered command as PENDING so the timeout sweeper can detect
   * an engine that never processes it. Tracking failures are logged only.
   * @deprecated Prefer {@link BotCommandDispatcher} constructing commands
   * internally (record-before-publish). Kept for callers that pre-build the
   * correlationId externally.
   */
  async trackPending(
    botId: string,
    result: SendCommandResult,
    commandType: "BOT_START" | "BOT_STOP"
  ): Promise<void> {
    if (!result.correlationId) {
      return;
    }
    await this.repository.recordPendingCommand(
      botId,
      result.correlationId,
      commandType
    );
    logger.debug("Command tracked for timeout supervision", {
      botId,
      correlationId: result.correlationId,
      commandType,
    });
  }
}

/** Extract botId from a command payload (safe for typed payloads). */
function botIdOf(payload: unknown): string {
  const maybe = payload as { botId?: string };
  return maybe.botId ?? "unknown";
}
