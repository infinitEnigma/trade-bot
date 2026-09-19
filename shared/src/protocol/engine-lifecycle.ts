/**
 * Engine Lifecycle Events - Engine → Backend (via Redis Streams)
 *
 * Registration and heartbeat events that make the engine's liveness and
 * identity authoritative:
 *
 * - ENGINE_REGISTER:  sent once at engine startup. Carries the engine's
 *   persistent identity (engineId) and a monotonically increasing `epoch`
 *   that is incremented on every engine restart. The backend refuses
 *   lifecycle events from engines whose epoch is superseded.
 * - ENGINE_HEARTBEAT: sent periodically while the engine is healthy.
 *   The backend marks an engine OFFLINE after a heartbeat timeout and
 *   transitions the engine's RUNNING bots to UNKNOWN.
 *
 * Both use the standard ProtocolMessage envelope; the correlationId is a
 * fresh UUID (they do not reference a backend command).
 *
 * @format
 */

import { ProtocolMessage } from "./bot-command";

// ===========================================
// EVENT TYPES
// ===========================================

export type EngineLifecycleEventType = "ENGINE_REGISTER" | "ENGINE_HEARTBEAT";

export interface EngineRegisterEventPayload {
    engineId: string;
    /** Monotonically increasing on every engine restart. */
    epoch: number;
    /** Engine build/version string, e.g. "kodiak@1.2.0". */
    version: string;
    /** ISO-8601 timestamp of the engine process start. */
    startedAt: string;
}

export interface EngineHeartbeatEventPayload {
    engineId: string;
    epoch: number;
    /** Bot ids the engine currently considers active (STARTING/RUNNING/STOPPING). */
    activeBotIds: string[];
    version: string;
}

export type EngineLifecycleEventPayload =
  EngineRegisterEventPayload | EngineHeartbeatEventPayload;

export type EngineLifecycleEvent = ProtocolMessage<EngineLifecycleEventPayload>;

// ===========================================
// TYPE GUARDS
// ===========================================

export function isEngineRegisterEvent(
  obj: unknown
): obj is ProtocolMessage<EngineRegisterEventPayload> {
    const payload = (obj as { payload?: EngineRegisterEventPayload })?.payload;
    return (
        typeof obj === "object" &&
        obj !== null &&
        (obj as { type?: string }).type === "ENGINE_REGISTER" &&
        typeof payload?.engineId === "string" &&
        typeof payload.epoch === "number" &&
        typeof payload.version === "string"
    );
}

export function isEngineHeartbeatEvent(
  obj: unknown
): obj is ProtocolMessage<EngineHeartbeatEventPayload> {
    const payload = (obj as { payload?: EngineHeartbeatEventPayload })?.payload;
    return (
        typeof obj === "object" &&
        obj !== null &&
        (obj as { type?: string }).type === "ENGINE_HEARTBEAT" &&
        typeof payload?.engineId === "string" &&
        typeof payload.epoch === "number" &&
        Array.isArray(payload.activeBotIds)
    );
}
