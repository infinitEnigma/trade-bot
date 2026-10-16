/**
 * Engine Registry Repository PORT — engine liveness & authoritative identity
 * (migration 009 `engine_registry` table).
 *
 * Consumes ENGINE_REGISTER / ENGINE_HEARTBEAT events and maintains the
 * registry: upsert on register, heartbeat refresh with journal-integrity
 * signalling, authority checks for command routing, and the supervision
 * sweep that marks timed-out engines OFFLINE.
 *
 * The PostgreSQL implementation lives in
 * `infrastructure/adapters/repositories/engine-registry-repository.adapter.ts`;
 * core never imports it (dependency inversion — external review P1,
 * 2026-10-15). Wiring happens at startup (index.ts
 * `setEngineRegistryRepository`), fail-fast when unwired so authority checks
 * never silently pass.
 *
 * @format
 */

export interface EngineRegistryRow {
  engine_id: string;
  /** `engine_registry.epoch` is BIGINT; node-postgres returns int8 as STRING. */
  epoch: number | string;
  status: string;
  version: string | null;
  last_seen_at: Date;
  journal_integrity?: string;
  journal_integrity_alert?: boolean;
  pending_fills?: number | string;
  journal_unknown_since?: Date | null;
  last_hb_epoch?: number | string;
  last_hb_seq?: number | string;
}

/** How long an engine may go without a heartbeat before it is OFFLINE. */
export const ENGINE_HEARTBEAT_TIMEOUT_MS = Number(
  process.env.ENGINE_HEARTBEAT_TIMEOUT_MS ?? 30_000
);
/** How long a dead (OFFLINE) engine row is kept for operator forensics. */
export const ENGINE_DEAD_ROW_RETENTION_MS = Number(
  process.env.ENGINE_DEAD_ROW_RETENTION_MS ?? 7 * 24 * 60 * 60 * 1000
);
export const SWEEP_INTERVAL_MS = Number(
  process.env.ENGINE_SWEEP_INTERVAL_MS ?? 10_000
);

/**
 * Parse a registry/wire epoch into a comparable integer.
 *
 * L21: `engine_registry.epoch` is BIGINT and node-postgres hands BIGINT back
 * as a string ("19"), while the engine publishes `engineEpoch` as a JSON
 * number (19). A strict `!==` between the two rejected EVERY runtime event.
 * Epochs must always be normalised before comparing.
 *
 * Returns null for absent/unparsable values so callers fail closed.
 */
export function normalizeEpoch(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * True when a registered epoch and an event epoch denote the same engine
 * process. A type mismatch (BIGINT string vs JSON number) is a match; an
 * unknown/unparsable value never matches (fail closed).
 */
export function epochsMatch(registered: unknown, eventEpoch: unknown): boolean {
  const registeredValue = normalizeEpoch(registered);
  const eventValue = normalizeEpoch(eventEpoch);
  return (
    registeredValue !== null &&
    eventValue !== null &&
    registeredValue === eventValue
  );
}

declare const EngineRegistryTxBrand: unique symbol;
export interface EngineRegistryTx {
  readonly [EngineRegistryTxBrand]: true;
}

export interface IEngineRegistryRepository {
  /** Upsert an engine on ENGINE_REGISTER (or re-register). */
  upsertEngine(params: {
    engineId: string;
    epoch: number;
    version: string;
    startedAt: string;
  }): Promise<{ rowCount: number }>;

  /** Refresh `last_seen_at` on a heartbeat (self-healing insert if absent). */
  refreshEngineHeartbeat(params: {
    engineId: string;
    epoch: number;
    version: string;
  }): Promise<boolean>;

  /**
   * Transactional composition for journal-integrity signalling (F4).
   * The tx handle is the port's opaque `EngineRegistryTx`.
   */
  inTransaction<T>(fn: (tx: EngineRegistryTx) => Promise<T>): Promise<T>;

  /**
   * Lock the engine row FOR UPDATE so the prior-state read and the journal
   * integrity transition form one critical section.
   */
  lockEngineRow(
    tx: EngineRegistryTx,
    engineId: string
  ): Promise<{
    journal_integrity_alert: boolean;
    last_hb_epoch: number | string;
    last_hb_seq: number | string;
  } | null>;

  /** Persist the journal-integrity signal transition inside the tx. */
  updateJournalIntegrity(
    tx: EngineRegistryTx,
    params: {
      engineId: string;
      isUnknown: boolean;
      isOk: boolean;
      pending: number | null;
      nextEpoch: number | string;
      nextSeq: number | string;
    }
  ): Promise<void>;

  /** Select one engine by id (authority check). */
  selectEngineById(engineId: string): Promise<EngineRegistryRow | null>;

  /** Operator-attested recovery of a sticky journal-integrity alert. */
  recoverJournalIntegrity(params: {
    engineId: string;
    operatorUserId: string;
    reconciliationRef: string;
  }): Promise<{ recovered: boolean; reason?: string }>;

  /** Select all engines ordered by last_seen_at DESC (liveness query). */
  selectAllEngines(): Promise<EngineRegistryRow[]>;

  /** Select ONLINE engines whose heartbeat has timed out (sweep). */
  selectExpiredOnlineEngines(
    olderThanSeconds: number
  ): Promise<EngineRegistryRow[]>;

  /** Mark one engine OFFLINE (claim, so concurrent sweeps don't double-process). */
  markEngineOffline(engineId: string): Promise<boolean>;

  /** Prune dead OFFLINE rows past retention. */
  pruneDeadEngines(olderThanSeconds: number): Promise<{ rowCount: number }>;

  /**
   * Hot liveness gate (EngineManager.ensureEngineRunning): true when at least
   * one ONLINE engine beat within `olderThanSeconds`. Kept on the port so core
   * never queries `engine_registry` directly.
   */
  hasLiveEngines(olderThanSeconds: number): Promise<boolean>;
}
