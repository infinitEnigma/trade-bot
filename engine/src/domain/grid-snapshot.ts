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
}

/** Persisted snapshot for one bot's grid. */
export interface GridSnapshot {
  /** Format version - reject/ignore unknown versions on load. */
  version: 1;
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

export const GRID_SNAPSHOT_VERSION = 1;

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
