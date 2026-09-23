-- ============================================================
-- Migration 007: Bot Lifecycle (desired/actual state + audit)
--
-- Introduces the desired_state / actual_state model replacing the
-- overloaded single `status` column, and adds a lifecycle event
-- audit trail used by the Backend ⇄ Engine control protocol.
--
-- The legacy `status` column is KEPT and kept in sync with
-- actual_state by the BotLifecycleService until all readers are
-- migrated. Existing CHECK constraint on `status` is preserved.
-- ============================================================

-- ===========================================
-- bot_instances: lifecycle columns
-- ===========================================

ALTER TABLE bot_instances
  ADD COLUMN IF NOT EXISTS desired_state VARCHAR(10) NOT NULL DEFAULT 'STOPPED'
    CHECK (desired_state IN ('RUNNING', 'STOPPED')),
  ADD COLUMN IF NOT EXISTS actual_state VARCHAR(10) NOT NULL DEFAULT 'STOPPED'
    CHECK (actual_state IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS engine_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

-- Backfill from the legacy status column.
-- FORCE_STOPPING maps to STOPPING.
UPDATE bot_instances
SET actual_state = CASE status
      WHEN 'FORCE_STOPPING' THEN 'STOPPING'
      WHEN 'STARTING' THEN 'STARTING'
      WHEN 'RUNNING' THEN 'RUNNING'
      WHEN 'STOPPING' THEN 'STOPPING'
      WHEN 'ERROR' THEN 'ERROR'
      ELSE 'STOPPED'
    END,
    desired_state = CASE
      WHEN status IN ('RUNNING', 'STARTING') THEN 'RUNNING'
      ELSE 'STOPPED'
    END;

ALTER TABLE bot_instances
  DROP CONSTRAINT IF EXISTS chk_bot_actual_state_valid;
ALTER TABLE bot_instances
  ADD CONSTRAINT chk_bot_actual_state_valid
    CHECK (actual_state IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR', 'UNKNOWN'));

ALTER TABLE bot_instances
  DROP CONSTRAINT IF EXISTS chk_bot_desired_state_valid;
ALTER TABLE bot_instances
  ADD CONSTRAINT chk_bot_desired_state_valid
    CHECK (desired_state IN ('RUNNING', 'STOPPED'));

-- Indexes for the reconciliation and monitoring queries.
CREATE INDEX IF NOT EXISTS idx_bot_instances_desired_state ON bot_instances(desired_state);
CREATE INDEX IF NOT EXISTS idx_bot_instances_actual_state ON bot_instances(actual_state);
CREATE INDEX IF NOT EXISTS idx_bot_instances_engine_id ON bot_instances(engine_id);

-- ===========================================
-- bot_lifecycle_events: audit trail
-- ===========================================

CREATE TABLE IF NOT EXISTS bot_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- START_REQUESTED, START_ACCEPTED, START_FAILED, STATE_CHANGED, STOP_REQUESTED, ...
  from_state VARCHAR(10),
  to_state VARCHAR(10),
  correlation_id VARCHAR(64),
  message_id VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bot_lifecycle_events_bot_id ON bot_lifecycle_events(bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bot_lifecycle_events_correlation ON bot_lifecycle_events(correlation_id);

COMMENT ON TABLE bot_lifecycle_events IS 'Audit trail of bot lifecycle transitions and protocol events';
