-- Migration: 015_credentials_issued_unique.sql
-- Closes the P1 credential-issuance race (PROJECT_REVIEW_GAP_ANALYSIS §2
-- claim 2 / L27): `GET /api/bot/engine/credentials/:botId` issued credentials
-- check-then-insert style — SELECT the `CREDENTIALS_ISSUED` marker, then a
-- plain INSERT — so two concurrent engine fetches could both pass the check
-- and both receive the envelope.
--
-- Scope is deliberately narrower than a global unique
-- `bot_lifecycle_events(bot_id, event_type, correlation_id)`: the audit trail
-- legitimately repeats that triple for other event types. One BOT_STOP /
-- EMERGENCY_STOP command correlation drives TWO STATE_CHANGED rows —
-- `engine/src/application/bot-manager.ts` publishes RUNNING→STOPPING and
-- STOPPING→STOPPED under the same correlationId (:222/:240 and :288/:324) —
-- and `bot-event-processor.ts` records each with a plain INSERT
-- (no ON CONFLICT), so a global unique index would make the terminal
-- STOPPED insert fail, poison-cap the event, and strand the FORCE_STOPPING
-- badge. Scoping the index to the issuance marker fixes the race with zero
-- blast radius on the lifecycle trail.
--
-- Ordering is rerun-safe (the runner executes statements one by one, ledger
-- recorded only after the whole file succeeds): the guard only RAISEs on real
-- duplicates, and CREATE INDEX ... IF NOT EXISTS is a no-op on re-run.

-- 1. Refuse to create the index while duplicate issuance markers already
--    exist (they would have to be cleaned up by hand first — silently
--    deduplicating audit rows is not this migration's job).
DO $$
DECLARE dupes integer;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT 1
    FROM bot_lifecycle_events
    WHERE event_type = 'CREDENTIALS_ISSUED'
      AND correlation_id IS NOT NULL
    GROUP BY bot_id, correlation_id
    HAVING COUNT(*) > 1
  ) AS d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      '015: % duplicate CREDENTIALS_ISSUED marker(s) already exist (same bot_id, correlation_id) — deduplicate bot_lifecycle_events by hand, then re-run',
      dupes;
  END IF;
END $$;

-- 2. CONCURRENTLY: build the index without locking the audit table for writes.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  uq_bot_lifecycle_events_credentials_issued
  ON bot_lifecycle_events (bot_id, correlation_id)
  WHERE event_type = 'CREDENTIALS_ISSUED';
