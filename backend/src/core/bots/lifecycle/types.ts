/**
 * Bot lifecycle shared types - used by the lifecycle components
 * (repository, dispatcher, notifier, event processor, orchestrator).
 *
 * @format
 */

import { BotActualState, BotDesiredState } from "@trade-bot/shared";

export interface BotLifecycleResult {
    botId: string;
    desiredState: BotDesiredState;
    actualState: BotActualState;
    correlationId?: string;
}

export interface BotRow {
    id: string;
    user_id: string;
    strategy_id: string;
    status: string;
    desired_state: BotDesiredState;
    actual_state: BotActualState;
    engine_id: string | null;
}

/** Map actual_state to the legacy single `status` column. */
export const STATUS_BY_ACTUAL: Record<BotActualState, string> = {
    STOPPED: "STOPPED",
    STARTING: "STARTING",
    RUNNING: "RUNNING",
    STOPPING: "STOPPING",
    ERROR: "ERROR",
    UNKNOWN: "ERROR",
};

export interface PersistTransitionInput {
    desiredState: BotDesiredState;
    actualState: BotActualState;
    engineId?: string | null;
    startedAt?: Date | null;
    stoppedAt?: Date | null;
    errorCode?: string | null;
    errorMessage?: string | null;
}

export interface LifecycleEventInput {
    eventType: string;
    fromState: string | null;
    toState: string | null;
    correlationId: string | null;
    messageId: string | null;
    metadata: Record<string, unknown>;
}

/** How long a PENDING command may wait for the engine before it times out. */
export const BOT_COMMAND_TIMEOUT_MS = Number(process.env.BOT_COMMAND_TIMEOUT_MS ?? 30_000);

/** A tracked lifecycle command awaiting engine confirmation. */
export interface TrackedCommandRow {
    correlation_id: string;
    bot_id: string;
    command_type: string;
}
