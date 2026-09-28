/**
 * Log-hygiene helpers (L6).
 *
 * Log files are the long-lived, widely-read artifact; the audit trail is the
 * record that keeps the real identity. Registration/login logs therefore carry
 * a masked address instead of the raw one, while `logAuditEvent(...)` rows and
 * API responses (the caller's own data) are untouched.
 *
 * @format
 */

/**
 * Mask the local part of an email address, keeping the domain readable:
 * `john.doe@example.com` → `j***e@example.com`.
 *
 * Deliberately lossy and never reversible:
 * - no `@` (or nothing before it): `***`
 * - one- or two-character local part: `a***@domain`
 * - empty/whitespace input: `""`
 */
export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim();
  if (!value) return "";

  const at = value.lastIndexOf("@");
  if (at <= 0) return "***";

  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length <= 2) return `${local[0]}***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}
