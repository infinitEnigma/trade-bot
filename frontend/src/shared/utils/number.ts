/** @format */

/**
 * Fail-closed USD renderer for decimal-string notionals (e.g. '100',
 * '0.5', '0') coming straight out of the `runs[]` payload.
 *
 * - Valid zero   → '$0.00' (kept, never folded into '—')
 * - Missing/empty string → '—'
 * - Non-numeric / non-finite / negative → '—'
 * - Never shows a value the source data does not carry
 */
export function formatNotional(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const trimmed =
    typeof amount === "string" ? amount.trim() : String(amount).trim();
  if (trimmed === "") return "—";
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(parsed);
}
