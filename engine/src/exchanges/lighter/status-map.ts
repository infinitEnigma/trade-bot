/** @format */

/**
 * Lighter order-status vocabulary (workstream B3).
 *
 * Phase-0 probe facts (`scripts/lighter-probe/lighter_probe/steps_orders.py`):
 * - The Go SDK documents a uint8 enum (0 InProgress, 1 Pending, 2
 *   ActiveLimit, 3 Filled, 4+ Canceled variants), but the REST JSON renders
 *   statuses as lowercase strings (`open`, `filled`, `canceled`, ...).
 * - Reconciliation decisions collapse onto OPEN / FILLED / CANCELED /
 *   UNRESOLVED (look again — never treat as absent).
 *
 * Keep this module free of I/O so the vocabulary can be unit-tested.
 */

/** Canonical reconciliation buckets. */
export type LighterResolution = "OPEN" | "FILLED" | "CANCELED" | "UNRESOLVED";

const INT_NAMES: Record<number, string> = {
  0: "InProgress",
  1: "Pending",
  2: "ActiveLimit",
  3: "Filled",
  4: "Canceled",
};

const STR_MAP: Record<string, string> = {
  in_progress: "InProgress",
  pending: "Pending",
  open: "ActiveLimit",
  partially_filled: "PartiallyFilled",
  filled: "Filled",
  canceled: "Canceled",
  cancelled: "Canceled",
  expired: "Canceled_Expired",
  rejected: "Rejected",
};

const OPEN_LIKE = new Set([
  "InProgress",
  "Pending",
  "ActiveLimit",
  "PartiallyFilled",
]);
const FILLED_LIKE = new Set(["Filled"]);
const CANCELED_LIKE = new Set(["Canceled", "Canceled_Expired", "Rejected"]);

/**
 * Canonical-name spellings that must round-trip through the normaliser.
 * Keys are lowercased; values are the canonical names the rest of this
 * module and `canonicalLighterStatus` emit.
 */
const CANONICAL_BY_LOWER = new Map<string, string>(
  [...OPEN_LIKE, ...FILLED_LIKE, ...CANCELED_LIKE].map(name => [
    name.toLowerCase(),
    name,
  ])
);

/**
 * Normalize a raw exchange status (int enum or rendered string) to a
 * canonical name. Returns `null` when the value is outside the recorded
 * vocabulary — callers treat that as UNRESOLVED, never as absent.
 *
 * Canonical names themselves round-trip (`ActiveLimit` → `ActiveLimit`),
 * so a status already normalised by `canonicalLighterStatus` and fed back
 * (the lookup → re-resolve path in `LighterClient`) resolves instead of
 * degrading to UNRESOLVED.
 */
export function normalizeLighterStatus(status: unknown): string | null {
  if (status === null || status === undefined) return null;
  if (typeof status === "boolean") return null;
  if (typeof status === "number" && Number.isInteger(status)) {
    return INT_NAMES[status] ?? null;
  }
  const key = String(status).trim().toLowerCase();
  const canonical = CANONICAL_BY_LOWER.get(key);
  if (canonical) return canonical;
  if (key in STR_MAP) return STR_MAP[key];
  if (/^\d+$/.test(key)) return INT_NAMES[Number(key)] ?? null;
  return null;
}

/**
 * Canonical upper-case status string for a raw venue value, so every
 * `ExchangeOpenOrder.status` this adapter emits speaks the same vocabulary
 * as the rest of the contract (`OPEN` / `FILLED` / `CANCELED`). Values
 * outside the recorded vocabulary render as `UNRESOLVED` — the caller must
 * look again, never treat them as absent.
 */
export function canonicalLighterStatus(status: unknown): string {
  return (normalizeLighterStatus(status) ?? "UNRESOLVED").toUpperCase();
}

/**
 * Reconciliation decision for one raw exchange status: OPEN means a live
 * order exists, FILLED/CANCELED are terminal, UNRESOLVED means look again
 * (poll with bounded retries — cancel/query are eventually consistent).
 */
export function resolveLighterStatus(status: unknown): LighterResolution {
  const name = normalizeLighterStatus(status);
  if (name === null) return "UNRESOLVED";
  if (OPEN_LIKE.has(name)) return "OPEN";
  if (FILLED_LIKE.has(name)) return "FILLED";
  if (CANCELED_LIKE.has(name)) return "CANCELED";
  return "UNRESOLVED";
}
