/**
 * EngineJournalIntegrityNotice (F4)
 *
 * Single source of truth for how the engine fill-journal integrity signal is
 * surfaced in the UI. Two distinct notions, kept separate on purpose:
 *
 *  - `journalIntegrityAlert` (STICKY): an observed UNKNOWN condition that
 *    requires operator reconciliation. Shown as the severe (danger) state.
 *  - `journalIntegrity === "UNVERIFIED"`: the backend has not yet recorded a
 *    verified integrity signal for the engine (e.g. right after migration 025,
 *    or a heartbeat missing a valid sequence was rejected). This is NOT
 *    confirmed corruption — shown as a softer (warning) "not yet verified"
 *    state so it is neither alarming nor invisible.
 *
 * Precedence: the sticky reconciliation alert wins over verification-pending
 * (it is strictly more severe). "OK" renders nothing.
 *
 * `variant` matches the two call sites: a full-width banner (Strategies) or a
 * compact status row (Dashboard).
 */
import { AlertTriangle } from "lucide-react";

export type JournalIntegrityState = "OK" | "UNKNOWN" | "UNVERIFIED";

interface EngineJournalIntegrityNoticeProps {
  journalIntegrity?: JournalIntegrityState;
  journalIntegrityAlert?: boolean;
  variant?: "banner" | "row";
}

export function EngineJournalIntegrityNotice({
  journalIntegrity,
  journalIntegrityAlert,
  variant = "banner",
}: EngineJournalIntegrityNoticeProps) {
  const alert = journalIntegrityAlert === true;

  // Sticky reconciliation alert (observed UNKNOWN) takes precedence.
  if (alert) {
    return variant === "row" ? (
      <div className="flex items-center justify-between">
        <span className="text-sm text-text">Fill Journal</span>
        <span className="flex items-center gap-2 text-sm text-danger">
          <span className="w-2 h-2 rounded-full bg-danger" />
          Reconciliation required
        </span>
      </div>
    ) : (
      <div className="glass-card p-4 flex items-start gap-3 border-danger/20 bg-danger/5">
        <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-danger">
            Accounting reconciliation required
          </p>
          <p className="text-sm text-textMuted">
            An engine's fill journal could not be verified — some fills may be
            unaccounted for. Do not resume trading until the fills are
            reconciled from venue history. See docs/FINANCIAL_RECONCILIATION.md.
          </p>
        </div>
      </div>
    );
  }

  // Verification-pending: UNVERIFIED and no active alert.
  if (journalIntegrity === "UNVERIFIED") {
    return variant === "row" ? (
      <div className="flex items-center justify-between">
        <span className="text-sm text-text">Fill Journal</span>
        <span className="flex items-center gap-2 text-sm text-warning">
          <span className="w-2 h-2 rounded-full bg-warning" />
          Not yet verified
        </span>
      </div>
    ) : (
      <div className="glass-card p-4 flex items-start gap-3 border-warning/20 bg-warning/5">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-warning">
            Fill-journal integrity not yet verified
          </p>
          <p className="text-sm text-textMuted">
            The engine has not yet reported a verified fill-journal integrity
            signal, so fills cannot be confirmed accounted for yet. This is not
            a confirmed problem — it usually clears once the engine reports a
            verified state. See docs/FINANCIAL_RECONCILIATION.md.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
