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
  /**
   * Fills journaled but not yet accepted by the ledger stream (F1). Lets the
   * backend alert on a journal that never drains. Absent = unknown (older
   * engines); present and > 0 = degraded delivery in progress.
   */
  pendingFills?: number;
  /**
   * Journal integrity could not be verified (files exist but no trustworthy
   * copy recovered). Distinct from pendingFills: 0 — the backend must alert
   * and refuse auto-recovery, never treat it as "drained".
   */
  pendingFillsUnknown?: boolean;
  /**
   * Monotonically increasing within ONE engine process, +1 each heartbeat,
   * resetting to 1 on restart. The backend orders journal-integrity writes by
   * the composite (epoch, heartbeatSeq) so a stale/redelivered heartbeat can
   * never overwrite a newer one — including across a process restart (epoch
   * advances, seq resets) or a delayed message from a superseded epoch.
   *
   * Required for journal-integrity persistence: the backend REJECTS a
   * heartbeat that lacks a valid sequence for that purpose (liveness still
   * updates regardless). Deployment note — `pendingFillsUnknown` and
   * `heartbeatSeq` must ship together with backend migration 025; the
   * coordinated monorepo deploy restarts every engine, so no pre-025 engine
   * (which omits this field) remains active against a 025 backend.
   */
  heartbeatSeq?: number;
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
