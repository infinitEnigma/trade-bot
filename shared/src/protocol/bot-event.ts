/**
 * Bot Events - Engine → Backend (via Redis Streams)
 *
 * Every event is wrapped in the same ProtocolMessage envelope as commands.
 * The `correlationId` of an event always references the originating command.
 *
 * Event semantics:
 * - COMMAND_ACCEPTED: engine received and understood the command.
 *   This does NOT mean the bot is running.
 * - COMMAND_FAILED:   engine could not complete the command (after acceptance).
 * - STATE_CHANGED:    the authoritative lifecycle transition report.
 *   Only STATE_CHANGED to RUNNING means the bot is actually running.
 *
 * @format
 */

import { ProtocolMessage } from "./bot-command";
import { BotActualState } from "./bot-state";
import { EngineLifecycleEventPayload } from "./engine-lifecycle";

// ===========================================
// EVENT TYPES
// ===========================================

export type BotEventType =
    | "COMMAND_ACCEPTED"
    | "COMMAND_FAILED"
    | "STATE_CHANGED"
    // Engine lifecycle events (registration / heartbeat) - see engine-lifecycle.ts
    | "ENGINE_REGISTER"
    | "ENGINE_HEARTBEAT";

export interface CommandAcceptedEventPayload {
    botId: string;
    /** The command type that was accepted, e.g. "BOT_START". */
    commandType: string;
    engineId: string;
    /** Restart epoch of the emitting engine process (authority validation). */
    engineEpoch: number;
}

export interface CommandFailedEventPayload {
    botId: string;
    /** The command type that failed, e.g. "BOT_START". */
    commandType: string;
    engineId: string;
    /** Restart epoch of the emitting engine process (authority validation). */
    engineEpoch: number;
    /** Stable machine-readable error code, e.g. "CREDENTIAL_FETCH_FAILED". */
    errorCode: string;
    /** Human-readable error description. */
    message: string;
}

export interface StateChangedEventPayload {
    botId: string;
    engineId: string;
    /** Restart epoch of the emitting engine process (authority validation). */
    engineEpoch: number;
    from: BotActualState;
    to: BotActualState;
    /** Optional reason, e.g. "started", "normal_stop", "init_failed", "emergency_stop". */
    reason?: string;
}

export type BotEventPayload =
    | CommandAcceptedEventPayload
    | CommandFailedEventPayload
    | StateChangedEventPayload
    | EngineLifecycleEventPayload;

export type BotEvent = ProtocolMessage<BotEventPayload>;

// ===========================================
// EVENT FACTORY
// ===========================================

import { generateMessageId } from "./bot-command";

/**
 * Build a protocol event envelope.
 */
export function createBotEvent<P extends BotEventPayload>(
  type: BotEventType,
  payload: P,
  correlationId: string
): ProtocolMessage<P> {
    return {
        version: 1,
        messageId: generateMessageId(),
        correlationId,
        timestamp: new Date().toISOString(),
        type,
        payload,
    };
}

// ===========================================
// TYPE GUARDS
// ===========================================

import { isProtocolMessage } from "./bot-command";

export function isBotEvent(obj: unknown): obj is BotEvent {
    return (
        isProtocolMessage(obj) &&
    (
      [
        "COMMAND_ACCEPTED",
        "COMMAND_FAILED",
        "STATE_CHANGED",
        "ENGINE_REGISTER",
        "ENGINE_HEARTBEAT",
      ] as string[]
    ).includes(obj.type)
    );
}

export function isCommandAcceptedEvent(
  obj: unknown
): obj is ProtocolMessage<CommandAcceptedEventPayload> {
  return (
    isProtocolMessage(obj) &&
    obj.type === "COMMAND_ACCEPTED" &&
    typeof (obj.payload as CommandAcceptedEventPayload)?.botId === "string"
  );
}

export function isCommandFailedEvent(
  obj: unknown
): obj is ProtocolMessage<CommandFailedEventPayload> {
  return (
    isProtocolMessage(obj) &&
    obj.type === "COMMAND_FAILED" &&
    typeof (obj.payload as CommandFailedEventPayload)?.botId === "string"
  );
}

export function isStateChangedEvent(
  obj: unknown
): obj is ProtocolMessage<StateChangedEventPayload> {
  return (
    isProtocolMessage(obj) &&
    obj.type === "STATE_CHANGED" &&
    typeof (obj.payload as StateChangedEventPayload)?.botId === "string"
  );
}
