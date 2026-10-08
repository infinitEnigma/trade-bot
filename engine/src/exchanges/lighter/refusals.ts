/** @format */

/**
 * Refusal classifiers for Lighter create/cancel refusals (adapter-side).
 *
 * The engine has no typed venue-rejection vocabulary: a refusal reaches this
 * adapter as a `SignerError` or a string reason, so these are deliberately
 * narrow text classifiers rather than an invented contract — each keyed on a
 * code + wording pinned live, each keeping its own fate (a miss degrades to
 * the pre-existing mapping, never to a wrong one).
 */

/**
 * Does a refusal read as **nonce drift** (transient signer `21104`)?
 *
 * The Lighter signing sidecar self-heals on the next attempt (its SDK's
 * `process_api_key_and_nonce` owns the nonce), so a `21104` refusal is
 * retryable — never fatal, and never a size refusal (`21706`, classified
 * strategy-side by `isSizeRefusal`, where the grid's C2 consumes it) or an
 * unreachable sidecar (both keep their own fate). Matches the venue's proven
 * code `21104` plus its `invalid nonce` wording. Observed live 2026-10-01.
 */
const NONCE_DRIFT_PATTERN = /21104|invalid nonce/i;

/** See `NONCE_DRIFT_PATTERN`. */
export function isNonceDrift(reason: string): boolean {
  return NONCE_DRIFT_PATTERN.test(reason);
}
