/**
 * Bot Command Dispatcher - Backend → Engine command sending
 *
 * Wraps the EngineProtocolService with lifecycle-specific payloads and
 * records each delivered command as PENDING for timeout supervision.
 *
 * @format
 */

import { EngineProtocolService, SendCommandResult } from "../engine-protocol.service";
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
     */
    async sendStartCommand(botId: string, userId: string, strategyId: string): Promise<SendCommandResult> {
        const config = await this.repository.findStrategyConfig(strategyId);
        return this.engineProtocol.sendCommand("BOT_START", {
            botId,
            userId,
            strategyId,
            configVersion: 1,
            config,
        });
    }

    /** Send BOT_STOP for a bot instance. */
    sendStopCommand(botId: string): Promise<SendCommandResult> {
        return this.engineProtocol.sendCommand("BOT_STOP", { botId });
    }

    /**
     * Track a delivered command as PENDING so the timeout sweeper can detect
     * an engine that never processes it. Tracking failures are logged only.
     */
    async trackPending(botId: string, result: SendCommandResult, commandType: "BOT_START" | "BOT_STOP"): Promise<void> {
        if (!result.correlationId) {
            return;
        }
        await this.repository.recordPendingCommand(botId, result.correlationId, commandType);
        logger.debug("Command tracked for timeout supervision", {
            botId,
            correlationId: result.correlationId,
            commandType,
        });
    }
}
