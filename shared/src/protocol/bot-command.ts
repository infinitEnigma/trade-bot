/**
 * Bot Commands - Backend → Engine (via Redis Streams)
 *
 * Every command is wrapped in a ProtocolMessage envelope:
 * - messageId:     unique per message, used for deduplication (at-least-once delivery)
 * - correlationId: ties a command to all its acknowledgements/state events
 *
 * SECURITY: Never include API secrets or credentials in command payloads.
 * The engine retrieves credentials out-of-band via an authenticated
 * backend endpoint after COMMAND_ACCEPTED.
 *
 * @format
 */

import { BotActualState, BotDesiredState } from "./bot-state";

// ===========================================
// ENVELOPE
// ===========================================

export const PROTOCOL_VERSION = 1 as const;

/**
 * Common envelope for every protocol message (commands and events).
 */
export interface ProtocolMessage<T> {
    version: typeof PROTOCOL_VERSION;
    /** Unique id of this message - used by consumers to deduplicate. */
    messageId: string;
    /** Groups a command with its acknowledgements and resulting state events. */
    correlationId: string;
    /** ISO-8601 timestamp of when the message was created. */
    timestamp: string;
    type: string;
    payload: T;
}

// ===========================================
// COMMAND TYPES
// ===========================================

export type BotCommandType = "BOT_START" | "BOT_STOP" | "BOT_STATUS_REQUEST";

/**
 * Start a bot. `config` carries non-secret strategy configuration only.
 * The engine fetches credentials out-of-band after COMMAND_ACCEPTED.
 */
export interface StartBotCommandPayload {
    botId: string;
    userId: string;
    strategyId: string;
    /** Version of the strategy config, for cache invalidation / audit. */
    configVersion: number;
    /** Non-secret strategy configuration (symbol, grid params, ...). */
    config: Record<string, unknown>;
}

export interface StopBotCommandPayload {
    botId: string;
}

export interface StatusRequestCommandPayload {
    botId: string;
}

export type BotCommandPayload =
  StartBotCommandPayload | StopBotCommandPayload | StatusRequestCommandPayload;

export type BotCommand = ProtocolMessage<BotCommandPayload>;

// ===========================================
// COMMAND FACTORY
// ===========================================

/**
 * Generate a unique message id (UUID v4 via Web Crypto, available in Node >= 19).
 */
export function generateMessageId(): string {
    return globalThis.crypto.randomUUID();
}

/**
 * Build a protocol command envelope.
 */
export function createBotCommand<P extends BotCommandPayload>(
  type: BotCommandType,
  payload: P,
  correlationId?: string
): ProtocolMessage<P> {
    return {
        version: PROTOCOL_VERSION,
        messageId: generateMessageId(),
        correlationId: correlationId ?? generateMessageId(),
        timestamp: new Date().toISOString(),
        type,
        payload,
    };
}

// ===========================================
// TYPE GUARDS
// ===========================================

export function isProtocolMessage(
  obj: unknown
): obj is ProtocolMessage<unknown> {
    return (
        typeof obj === "object" &&
        obj !== null &&
        (obj as ProtocolMessage<unknown>).version === PROTOCOL_VERSION &&
        typeof (obj as ProtocolMessage<unknown>).messageId === "string" &&
        typeof (obj as ProtocolMessage<unknown>).correlationId === "string" &&
        typeof (obj as ProtocolMessage<unknown>).timestamp === "string" &&
        typeof (obj as ProtocolMessage<unknown>).type === "string" &&
        "payload" in obj
    );
}

export function isBotCommand(obj: unknown): obj is BotCommand {
  return (
    isProtocolMessage(obj) &&
    (["BOT_START", "BOT_STOP", "BOT_STATUS_REQUEST"] as string[]).includes(
      obj.type
    )
  );
}

export function isBotStartCommand(
  obj: unknown
): obj is ProtocolMessage<StartBotCommandPayload> {
  return (
    isProtocolMessage(obj) &&
    obj.type === "BOT_START" &&
    typeof (obj.payload as StartBotCommandPayload)?.botId === "string"
  );
}

export function isBotStopCommand(
  obj: unknown
): obj is ProtocolMessage<StopBotCommandPayload> {
  return (
    isProtocolMessage(obj) &&
    obj.type === "BOT_STOP" &&
    typeof (obj.payload as StopBotCommandPayload)?.botId === "string"
  );
}

export function isStatusRequestCommand(
  obj: unknown
): obj is ProtocolMessage<StatusRequestCommandPayload> {
  return (
    isProtocolMessage(obj) &&
    obj.type === "BOT_STATUS_REQUEST" &&
    typeof (obj.payload as StatusRequestCommandPayload)?.botId === "string"
  );
}

// ===========================================
// STATUS SNAPSHOT (reply to BOT_STATUS_REQUEST)
// ===========================================

/**
 * Snapshot of a bot's lifecycle state as seen by the engine.
 */
export interface BotStateSnapshot {
    botId: string;
    engineId: string;
    actualState: BotActualState;
    desiredState?: BotDesiredState;
    lastCycleAt?: string;
}
