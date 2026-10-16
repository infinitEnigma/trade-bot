/** @format */

/**
 * Engine Registry Service - engine liveness & authoritative identity
 *
 * Consumes ENGINE_REGISTER / ENGINE_HEARTBEAT events from the engine and
 * maintains the `engine_registry` table through the `IEngineRegistryRepository`
 * port (dependency inversion — external review P1, 2026-10-15).
 *
 * - ENGINE_REGISTER:  upserts the engine with its restart epoch, marks it ONLINE.
 * - ENGINE_HEARTBEAT: refreshes last_seen_at; heartbeat timeout -> OFFLINE.
 *
 * The supervision sweep transitions RUNNING bots of OFFLINE engines to
 * UNKNOWN via an injected marker (BotLifecycleService in prod) so
 * state-machine policy stays in one place. Epochs reject events from
 * superseded engine processes.
 *
 * The PostgreSQL repository adapter lives in
 * `infrastructure/adapters/repositories/engine-registry-repository.adapter.ts`
 * and is wired at startup (index.ts `setEngineRegistryRepository`), fail-fast
 * when unwired so authority checks never silently pass.
 *
 * @format
 */

import {
  EngineHeartbeatEventPayload,
  isEngineHeartbeatEvent,
  isEngineRegisterEvent,
  BotEvent,
} from "@trade-bot/shared";
import { contextLogger as logger } from "../logging";
/** Transition an OFFLINE engine's RUNNING bots to UNKNOWN (BotLifecycleService). */
export type UnknownMarker = (engineId: string) => Promise<unknown>;
/** Reconcile an engine's runtime inventory against backend state. */
export type InventoryReconciler = (
  engineId: string,
  activeBotIds: string[]
) => Promise<unknown>;
import {
  IEngineRegistryRepository,
  EngineRegistryRow,
  EngineRegistryTx,
  ENGINE_HEARTBEAT_TIMEOUT_MS,
  ENGINE_DEAD_ROW_RETENTION_MS,
  SWEEP_INTERVAL_MS,
  normalizeEpoch as normalizeEpochCore,
  epochsMatch as epochsMatchCore,
} from "./lifecycle/engine-registry.repository.port";

export class EngineRegistryService {
  private repositoryImpl?: IEngineRegistryRepository;
  private unknownMarkerImpl?: UnknownMarker;
  private inventoryReconcilerImpl?: InventoryReconciler;
  private sweepIntervalId: NodeJS.Timeout | null = null;

  /** Fail-fast accessor — unwired port must never silently pass authority checks. */
  private get repository(): IEngineRegistryRepository {
    if (!this.repositoryImpl) {
      throw new Error(
        "Engine registry repository not wired — call setEngineRegistryRepository() at startup"
      );
    }
    return this.repositoryImpl;
  }

  private get unknownMarker(): UnknownMarker {
    if (!this.unknownMarkerImpl) {
      throw new Error(
        "Engine registry unknown-marker not wired — call setUnknownMarker() at startup"
      );
    }
    return this.unknownMarkerImpl;
  }

  private get inventoryReconciler(): InventoryReconciler {
    if (!this.inventoryReconcilerImpl) {
      throw new Error(
        "Engine registry inventory reconciler not wired — call setInventoryReconciler() at startup"
      );
    }
    return this.inventoryReconcilerImpl;
  }

  /** Composition-root wiring (index.ts). Tests inject a mock the same way. */
  setEngineRegistryRepository(repository: IEngineRegistryRepository): void {
    this.repositoryImpl = repository;
  }

  /**
   * Inject the OFFLINE-engine bot transition (BotLifecycleService in prod).
   * Setter-injected to avoid a core↔core singleton cycle with
   * BotLifecycleService (which receives this service's event handler).
   */
  setUnknownMarker(marker: UnknownMarker): void {
    this.unknownMarkerImpl = marker;
  }

  /** Inject the heartbeat inventory reconciler (BotLifecycleService in prod). */
  setInventoryReconciler(reconciler: InventoryReconciler): void {
    this.inventoryReconcilerImpl = reconciler;
  }

  // ===========================================
  // EVENT HANDLING
  // ===========================================

  /** Handle an engine lifecycle event. Returns true if consumed. */
  async handleEngineEvent(event: BotEvent): Promise<boolean> {
    if (isEngineRegisterEvent(event)) {
      await this.repository.upsertEngine({
        engineId: event.payload.engineId,
        epoch: event.payload.epoch,
        version: event.payload.version,
        startedAt: event.payload.startedAt,
      });
      return true;
    }
    if (isEngineHeartbeatEvent(event)) {
      await this.heartbeat(event.payload);
      return true;
    }
    return false;
  }

  /** Heartbeat: refresh liveness, record journal integrity, reconcile inventory. */
  async heartbeat(payload: EngineHeartbeatEventPayload): Promise<void> {
    const applied = await this.repository.refreshEngineHeartbeat({
      engineId: payload.engineId,
      epoch: payload.epoch,
      version: payload.version,
    });
    if (!applied) {
      return; // stale epoch, nothing more to do
    }

    // F4: persist journal integrity signal.
    try {
      await this.recordJournalIntegrity(payload);
    } catch (error) {
      logger.error(
        "FAILED to persist engine journal-integrity signal",
        undefined,
        {
          engineId: payload.engineId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // Reconcile the engine's runtime inventory against backend state.
    try {
      await this.inventoryReconciler(payload.engineId, payload.activeBotIds);
    } catch (error) {
      logger.error("Heartbeat inventory reconciliation failed", undefined, {
        engineId: payload.engineId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Record journal-integrity signal transition inside a row-locked transaction. */
  private async recordJournalIntegrity(
    payload: EngineHeartbeatEventPayload
  ): Promise<void> {
    const isUnknown = payload.pendingFillsUnknown === true;
    const isOk = payload.pendingFillsUnknown === false;
    const pending =
      typeof payload.pendingFills === "number" &&
      Number.isInteger(payload.pendingFills) &&
      payload.pendingFills >= 0
        ? payload.pendingFills
        : null;

    if (
      typeof payload.epoch !== "number" ||
      !Number.isSafeInteger(payload.epoch) ||
      payload.epoch < 0
    ) {
      logger.warn("Engine heartbeat rejected for integrity: invalid epoch", {
        engineId: payload.engineId,
        epoch: payload.epoch,
      });
      return;
    }
    if (
      typeof payload.heartbeatSeq !== "number" ||
      !Number.isSafeInteger(payload.heartbeatSeq) ||
      payload.heartbeatSeq < 1
    ) {
      logger.warn(
        "Engine heartbeat rejected for integrity: missing/invalid heartbeatSeq",
        { engineId: payload.engineId, epoch: payload.epoch }
      );
      return;
    }
    const epoch = payload.epoch;
    const seq = payload.heartbeatSeq;

    await this.repository.inTransaction(async (tx: EngineRegistryTx) => {
      const row = await this.repository.lockEngineRow(tx, payload.engineId);
      if (!row) {
        throw new Error(`engine_registry row missing for ${payload.engineId}`);
      }

      const lastEpoch = normalizeEpochCore(row.last_hb_epoch) ?? 0;
      const lastSeq = normalizeEpochCore(row.last_hb_seq) ?? 0;

      let apply = false;
      let nextEpoch = lastEpoch;
      let nextSeq = lastSeq;
      if (epoch > lastEpoch) {
        apply = true;
        nextEpoch = epoch;
        nextSeq = seq;
      } else if (epoch === lastEpoch && seq > lastSeq) {
        apply = true;
        nextEpoch = epoch;
        nextSeq = seq;
      } else if (epoch === lastEpoch && seq === lastSeq) {
        return; // duplicate redelivery
      }

      if (!apply) {
        return;
      }

      const wasAlerted = row.journal_integrity_alert;

      await this.repository.updateJournalIntegrity(tx, {
        engineId: payload.engineId,
        isUnknown,
        isOk,
        pending,
        nextEpoch,
        nextSeq,
      });

      if (isUnknown && !wasAlerted) {
        logger.error(
          "Engine fill-journal integrity UNKNOWN - operator reconciliation required",
          undefined,
          { engineId: payload.engineId, epoch, pendingFills: pending }
        );
      }
    });
  }

  /** Operator-attested recovery of a sticky journal-integrity alert. */
  async recoverJournalIntegrity(
    engineId: string,
    operatorUserId: string,
    reconciliationRef: string
  ): Promise<{ recovered: boolean; reason?: string }> {
    const result = await this.repository.recoverJournalIntegrity({
      engineId,
      operatorUserId,
      reconciliationRef,
    });
    if (result.recovered) {
      logger.warn(
        "Engine fill-journal integrity recovered (operator-attested)",
        { engineId, operatorUserId, reconciliationRef }
      );
    }
    return result;
  }

  /** Fail-closed engine-authority check for runtime events. */
  async isEngineAuthoritative(
    engineId: string,
    epoch?: number
  ): Promise<boolean> {
    const row = await this.repository.selectEngineById(engineId);
    if (!row) {
      logger.warn("Engine authority check failed: unregistered engine", {
        engineId,
        epoch,
      });
      return false;
    }
    if (epoch !== undefined && !epochsMatchCore(row.epoch, epoch)) {
      logger.warn("Engine authority check failed: epoch mismatch", {
        engineId,
        eventEpoch: epoch,
        registeredEpoch: row.epoch,
        registeredEpochType: typeof row.epoch,
      });
      return false;
    }
    return row.status === "ONLINE";
  }

  /** Is any engine process currently alive? */
  async getEngineLiveness(): Promise<{
    running: boolean;
    engines: Array<{
      engineId: string;
      status: string;
      lastSeenAt: Date;
      live: boolean;
      journalIntegrity: "OK" | "UNKNOWN" | "UNVERIFIED";
      journalIntegrityAlert: boolean;
      pendingFills: number;
    }>;
  }> {
    const result = await this.repository.selectAllEngines();
    const freshnessCutoffMs = Date.now() - ENGINE_HEARTBEAT_TIMEOUT_MS * 2;
    const isLive = (row: EngineRegistryRow): boolean =>
      row.status === "ONLINE" &&
      new Date(row.last_seen_at).getTime() >= freshnessCutoffMs;
    const engines = result.map(row => ({
      engineId: row.engine_id,
      status: row.status,
      lastSeenAt: row.last_seen_at,
      live: isLive(row),
      journalIntegrity: (row.journal_integrity ?? "UNVERIFIED") as
        "OK" | "UNKNOWN" | "UNVERIFIED",
      journalIntegrityAlert: row.journal_integrity_alert ?? false,
      pendingFills:
        typeof row.pending_fills === "number"
          ? row.pending_fills
          : Number(row.pending_fills ?? 0) || 0,
    }));
    const running = result.some(isLive);
    return { running, engines };
  }

  /**
   * Supervision sweep: mark timed-out ONLINE engines OFFLINE (claiming so
   * concurrent sweeps cannot double-process), transition their RUNNING bots
   * to UNKNOWN via the injected marker, then prune dead rows past retention.
   * Prune failures are logged, never thrown — the marked count is kept.
   */
  async sweepOfflineEngines(): Promise<number> {
    const expired = await this.repository.selectExpiredOnlineEngines(
      ENGINE_HEARTBEAT_TIMEOUT_MS / 1000
    );
    let marked = 0;

    for (const engine of expired) {
      // Claim first so concurrent sweeps cannot double-process.
      const claimed = await this.repository.markEngineOffline(engine.engine_id);
      if (!claimed) {
        continue;
      }
      marked++;
      logger.error("Engine heartbeat lost - marked OFFLINE", undefined, {
        engineId: engine.engine_id,
        epoch: engine.epoch,
        lastSeenAt: engine.last_seen_at,
      });

      await this.unknownMarker(engine.engine_id);
    }

    // Prune dead rows past retention (ghost cleanup). Failures here must not
    // fail the sweep: log loudly, keep the marked count.
    try {
      const pruned = await this.repository.pruneDeadEngines(
        ENGINE_DEAD_ROW_RETENTION_MS / 1000
      );
      if (pruned.rowCount > 0) {
        logger.info("Pruned dead engine registry rows past retention", {
          pruned: pruned.rowCount,
          retentionMs: ENGINE_DEAD_ROW_RETENTION_MS,
        });
      }
    } catch (error) {
      logger.error("Dead engine registry prune failed", undefined, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return marked;
  }

  start(): void {
    if (this.sweepIntervalId) {
      return;
    }
    this.sweepIntervalId = setInterval(() => {
      void this.sweepOfflineEngines().catch((error: unknown) => {
        logger.error("Engine offline sweep failed", undefined, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, SWEEP_INTERVAL_MS);
    this.sweepIntervalId.unref();
    logger.info("Engine registry supervision started", {
      sweepIntervalMs: SWEEP_INTERVAL_MS,
      heartbeatTimeoutMs: ENGINE_HEARTBEAT_TIMEOUT_MS,
    });
  }

  stop(): void {
    if (this.sweepIntervalId) {
      clearInterval(this.sweepIntervalId);
      this.sweepIntervalId = null;
      logger.info("Engine registry supervision stopped");
    }
  }

  getStatus(): { isRunning: boolean } {
    return { isRunning: this.sweepIntervalId !== null };
  }
}

export const engineRegistryService = new EngineRegistryService();

// Re-export engine configuration constants from the port for API convenience.
export {
  ENGINE_HEARTBEAT_TIMEOUT_MS,
  ENGINE_DEAD_ROW_RETENTION_MS,
  SWEEP_INTERVAL_MS,
} from "./lifecycle/engine-registry.repository.port";

// Re-export port types for API convenience.
export type { IEngineRegistryRepository, EngineRegistryRow, EngineRegistryTx };
