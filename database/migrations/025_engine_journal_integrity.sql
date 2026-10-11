-- Migration: 025_engine_journal_integrity.sql
--
-- Financial-plane finding F4 (backend consumption of the engine's fill-journal
-- integrity signal). The engine publishes `pendingFillsUnknown` on every
-- ENGINE_HEARTBEAT; this migration gives the backend somewhere durable to
-- record it, plus a STICKY operator alert that survives restarts and is
-- cleared ONLY by an explicit, admin-authorized, reconciliation-attested
-- recovery — never by a later heartbeat that merely reports healthy.
--
-- Two distinct notions (documented together, never conflated):
--  * `journal_integrity`  — the LIVE latest-known read from the engine
--    ('OK' | 'UNKNOWN' | 'UNVERIFIED'). Overwritten every sequenced heartbeat.
--  * `journal_integrity_alert` — the STICKY "operator action required" flag.
--    Raised on the ->UNKNOWN edge; cleared only by recoverJournalIntegrity().
-- The UI banner keys on the STICKY alert, not the live state, so a transient
-- healthy heartbeat can never make an unresolved financial-integrity gap vanish.
--
-- Ordering: journal-integrity writes are ordered by the composite
-- (epoch, heartbeatSeq). `last_hb_epoch`/`last_hb_seq` store the last ACCEPTED
-- pair so a stale/redelivered heartbeat (or one from a superseded epoch) is
-- rejected. Heartbeats lacking a valid sequence are rejected for integrity
-- purposes (liveness still updates via the separate upsert) — see the
-- coordinated-deploy note in shared/src/protocol/engine-lifecycle.ts.
--
-- `UNVERIFIED` default: a pre-025 row means "no unknown condition has been
-- recorded since this feature shipped", NOT "the journal has been verified
-- healthy". It is distinct from 'OK'.
--
-- Rerun-safe: every statement is idempotent (ADD COLUMN IF NOT EXISTS,
-- DROP-IF-EXISTS-then-ADD for the CHECK, COMMENT), and the runner records the
-- file only after every statement succeeded.

-- Live journal-integrity state. Pre-025 rows initialize to UNVERIFIED.
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS journal_integrity VARCHAR(10) NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE engine_registry
  DROP CONSTRAINT IF EXISTS engine_registry_journal_integrity_check;
ALTER TABLE engine_registry
  ADD CONSTRAINT engine_registry_journal_integrity_check
  CHECK (journal_integrity IN ('OK', 'UNKNOWN', 'UNVERIFIED'));

-- Sticky operator alert: raised on the ->UNKNOWN edge, cleared only by recovery.
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS journal_integrity_alert BOOLEAN NOT NULL DEFAULT false;

-- Latest journaled-but-undelivered fill count reported by the engine.
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS pending_fills INTEGER NOT NULL DEFAULT 0;

-- When the sticky alert was raised (auditability); nulled on recovery.
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS journal_unknown_since TIMESTAMP WITH TIME ZONE;

-- Ordering pair: last ACCEPTED (epoch, seq). Composite, restart-safe.
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS last_hb_epoch BIGINT NOT NULL DEFAULT 0;
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS last_hb_seq BIGINT NOT NULL DEFAULT 0;

-- Recovery audit: who attested, when, and against what reference.
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS journal_recovered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS journal_recovered_by VARCHAR(64);
ALTER TABLE engine_registry
  ADD COLUMN IF NOT EXISTS journal_recovery_ref VARCHAR(256);

COMMENT ON COLUMN engine_registry.journal_integrity IS
  'Live latest-known engine fill-journal integrity: OK | UNKNOWN | UNVERIFIED. UNVERIFIED = no signal recorded since migration 025 (not a claim of health).';
COMMENT ON COLUMN engine_registry.journal_integrity_alert IS
  'Sticky operator-action-required flag. Raised on the ->UNKNOWN edge; cleared only by admin-verified recovery, never by a later healthy heartbeat.';
COMMENT ON COLUMN engine_registry.pending_fills IS
  'Fills journaled but not yet accepted by the ledger stream, as last reported by the engine heartbeat.';
COMMENT ON COLUMN engine_registry.journal_unknown_since IS
  'When the sticky journal-integrity alert was raised. NULL when no alert is active.';
COMMENT ON COLUMN engine_registry.last_hb_epoch IS
  'Epoch of the last ACCEPTED journal-integrity heartbeat. Ordering key (with last_hb_seq) that rejects stale/redelivered writes.';
COMMENT ON COLUMN engine_registry.last_hb_seq IS
  'heartbeatSeq of the last ACCEPTED journal-integrity heartbeat. Moves together with last_hb_epoch as one composite pair.';
COMMENT ON COLUMN engine_registry.journal_recovered_at IS
  'When an admin last cleared the sticky alert after an attested reconciliation.';
COMMENT ON COLUMN engine_registry.journal_recovered_by IS
  'Admin user id (from the authenticated request) who attested the recovery.';
COMMENT ON COLUMN engine_registry.journal_recovery_ref IS
  'Operator-supplied reconciliation reference (ticket/incident id or short note). No venue credentials or trading data.';
