/**
 * Grid Snapshot Types
 *
 * On-disk representation of a grid strategy's slot state, so an engine restart
 * does not rebuild the grid from scratch (which would forget fills and re-place
 * levels whose orders already live on the exchange).
 *
 * @format
 */

import { createHash } from "crypto";

/** A single grid level's persisted slot state. */
export interface GridSnapshotLevel {
  price: number;
  buyOrderId?: string;
  sellOrderId?: string;
  filled: boolean;
  /**
   * Executed entry price of this level's open long (Phase 5 accounting).
   * Optional so pre-accounting snapshots still load (the strategy then falls
   * back to `price`); always written by current builds.
   */
  entryPrice?: number;
  /**
   * Slot id generations (G1) — see `GridLevel.buyGen`. Both fields are always
   * written by current builds; `undefined` marks a legacy (pre-G1) snapshot,
   * whose handle-less sides must start at generation 1 on restore so their
   * spent generation-0 ids are never re-queried (Gate 1 report §3.1).
   */
  buyGen?: number;
  sellGen?: number;
  /**
   * Long quantity this level holds (Phase 4 quantity accounting): booked BUY
   * segments minus booked SELL segments. Written only by `OrderManager`.
   * Absent on legacy snapshots, where restore derives it from `filled`
   * (`orderQuantity` when set, else 0). `filled` itself is the projection
   * `heldQty ≥ orderQuantity − ε` — the arming rules read `heldQty`.
   */
  heldQty?: number;
  /**
   * Booked cumulative of the *resting BUY instance* (Phase 4, risk A4).
   * Seeded into `OrderManager.adopt` after a restart so re-observing the
   * same venue cumulative books only the delta — without it the level's
   * `heldQty` would double while the ledger correctly deduped. Reset to 0
   * when a new instance is submitted. Ignored when `buyOrderId` is absent.
   */
  buyFilledQty?: number;
  /** Booked cumulative of the resting SELL instance — see `buyFilledQty`. */
  sellFilledQty?: number;
  /**
   * Exit-only state (Phase 3, risk C2) — see `GridLevel.exitOnly`. Persisted so
   * the "cannot top up, must exit real inventory" decision survives a restart
   * with `heldQty` still meaning confirmed fills only.
   */
  exitOnly?: boolean;
}

/** Persisted snapshot for one bot's grid. */
export interface GridSnapshot {
  /**
   * Format version. `2` (GRID_SNAPSHOT_VERSION) is the only version that
   * authorizes restore; `1` (LEGACY_SNAPSHOT_VERSION) is a known-legacy schema
   * that loads for diagnostics but is never trusted to restore a grid (the
   * execution-config compatibility set, incl. `orderQuantity`, is not recorded
   * there). Any other value is unknown and treated as corruption.
   */
  version: number;
  botId: string;
  /**
   * D3 sessions: the run this snapshot belongs to. Optional so pre-D
   * `<botId>.json` files still load (migration-on-read); always written now.
   */
  runId?: string;
  symbol: string;
  gridSize: number;
  gridRangePercent: number;
  /**
   * Size per order the grid was built with (Phase 1 remediation). Restored
   * `heldQty` and fill cumulatives are only meaningful under the slot size they
   * were booked at, so this is part of the compatibility set: a snapshot whose
   * `orderQuantity` differs from the running config is not trusted to restore.
   * Absent on legacy (v1) snapshots, which are never trusted to restore.
   */
  orderQuantity?: number;
  /**
   * Market-rules fingerprint (Phase B/D): the `priceTickSize` every level
   * was quantized against. Part of the restore compatibility set — a
   * snapshot whose tick differs from the live rules (or predates the
   * fingerprint) routes to the untrusted path. Optional so pre-fingerprint
   * v2 snapshots still load (they just never authorize a restore).
   */
  priceTickSize?: string;
  /**
   * Price the grid was built around. Restoring at this baseline keeps level
   * prices stable so saved order IDs map back onto the right levels.
   */
  baselinePrice: number;
  levels: GridSnapshotLevel[];
  savedAt: string;
  /**
   * sha256 (hex) of the canonical payload **excluding this field**. Optional on
   * read so snapshots written before Phase 3 still load; always written now and
   * verified whenever present (a mismatch is treated as corruption).
   */
  checksum?: string;
}

/**
 * The only snapshot version that authorizes restore. Version 2 added the
 * execution-config compatibility set (notably `orderQuantity`) so a slot-size
 * change can never silently restore inventory booked under the old size.
 */
export const GRID_SNAPSHOT_VERSION = 2;

/**
 * A known-legacy schema: it loads (and round-trips) for diagnostics, but the
 * strategy never trusts it to restore a grid — it lacks the compatibility set
 * — so a v1 snapshot routes through the same safe reconciliation gate as an
 * untrusted/missing snapshot. Distinct from an *unknown* version, which is
 * treated as corruption.
 */
export const LEGACY_SNAPSHOT_VERSION = 1;

/**
 * Deterministic JSON with object keys sorted, so the same logical snapshot
 * always hashes to the same checksum regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}

/** sha256 over the snapshot payload, excluding the checksum field itself. */
export function computeSnapshotChecksum(
  snapshot: Omit<GridSnapshot, "checksum">
): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}
